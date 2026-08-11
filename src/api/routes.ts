import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { sequelize } from '../config/sequelize';
import { CrawlJob, CrawlCredential, WorkflowRun, KnowledgeSummary } from '../db/models';
import { graphRouter } from './graph-routes';
import { workflowRunRouter } from './workflow-run-routes';
import { authRouter } from './auth-routes';
import { userRouter } from './user-routes';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { ok } from '../utils/response-envelope';
import { ConflictError, NotFoundError } from '../errors/api-error';
import { crawlHeavy, readLoose } from '../middleware/rate-limiters';
import { authenticate } from '../middleware/authenticate';
import { assertSafeUrl } from '../security/ssrf-guard';
import { crawlBodySchema, credentialsBodySchema } from '../validation/schemas/crawl.schemas';

export const router = Router();

// extension/src/api.ts's CrawlJob/WorkflowRun types (and this API's own long-standing
// wire format) are snake_case -- Sequelize model instances serialize their JS attribute
// names (camelCase) by default, so responses are explicitly re-shaped back to snake_case
// here to avoid a silent breaking change for existing API consumers.
function crawlJobJson(job: CrawlJob) {
  return {
    id: job.id,
    project_id: job.projectId,
    target_url: job.targetUrl,
    status: job.status,
    login_url: job.loginUrl,
    started_at: job.startedAt,
    completed_at: job.completedAt,
    error_message: job.errorMessage,
    created_at: job.createdAt
  };
}

function summaryJson(summary: KnowledgeSummary) {
  return { domain: summary.domain, summary_data: summary.summaryData, created_at: summary.createdAt };
}

function workflowRunJson(run: WorkflowRun) {
  return {
    id: run.id,
    workflow_id: run.workflowId,
    project_id: run.projectId,
    status: run.status,
    video_path: run.videoPath,
    captions_path: run.captionsPath,
    error_message: run.errorMessage,
    started_at: run.startedAt,
    completed_at: run.completedAt,
    created_at: run.createdAt
  };
}

// How long a completed crawl for a given target URL is considered fresh. A new
// POST /api/crawl for the same URL within this window reuses that result instead of
// re-crawling (re-navigating every page, re-running AI summarization/extraction).
const CRAWL_TTL_HOURS = Math.max(0, Number(process.env.CRAWL_TTL_HOURS) || 24);

/**
 * Authentication and User Tracking routes (email/password, Google, GitHub)
 */
router.use('/auth', authRouter);

// Every route below requires a valid access token -- the "no signup, no access" cutover.
// The extension (extension/src/api.ts) has been verified end-to-end against this already.
router.use(authenticate);

/**
 * The logged-in user's own profile + post-signup onboarding.
 */
router.use('/users', userRouter);

/**
 * POST /api/crawl
 * Triggers a website discovery crawl. If this exact target URL was already crawled
 * to completion within CRAWL_TTL_HOURS, returns that existing job/project instead of
 * queuing a new crawl.
 */
router.post(
  '/crawl',
  crawlHeavy,
  validate({ body: crawlBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { targetUrl, projectId } = req.body as { targetUrl: string; projectId?: string };

    // Fast, fail-early rejection. Not sufficient alone (TOCTOU + redirects) -- re-checked
    // in crawl-worker.ts before the crawl actually starts, and enforced per-navigation
    // inside playwright-crawler.ts itself.
    await assertSafeUrl(targetUrl);

    if (CRAWL_TTL_HOURS > 0) {
      const cutoff = new Date(Date.now() - CRAWL_TTL_HOURS * 60 * 60 * 1000);
      const recent = await CrawlJob.findOne({
        where: { targetUrl, status: 'COMPLETED', completedAt: { [Op.gt]: cutoff } },
        order: [['completedAt', 'DESC']]
      });

      if (recent) {
        return ok(res, {
          message: `Reusing crawl completed within the last ${CRAWL_TTL_HOURS}h; not re-crawling.`,
          cached: true,
          job: crawlJobJson(recent)
        });
      }
    }

    const job = await CrawlJob.create({ projectId: projectId || uuidv4(), targetUrl, status: 'PENDING' });

    return ok(res, { message: 'Crawl job queued successfully', cached: false, job: crawlJobJson(job) }, 201);
  })
);

/**
 * GET /api/crawl/:id
 * Fetches status of a crawl job.
 */
router.get(
  '/crawl/:id',
  readLoose,
  asyncHandler(async (req: Request, res: Response) => {
    const job = await CrawlJob.findByPk(req.params.id);
    if (!job) {
      throw new NotFoundError('Crawl job not found');
    }
    return ok(res, crawlJobJson(job));
  })
);

/**
 * POST /api/crawl/:id/credentials
 * Submits login credentials for a job that is paused awaiting them (status AWAITING_CREDENTIALS).
 * Credentials are held in crawl_credentials only transiently -- the worker deletes the row
 * as soon as it reads it, whether or not the login attempt succeeds.
 */
router.post(
  '/crawl/:id/credentials',
  crawlHeavy,
  validate({ body: credentialsBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { username, password } = req.body as { username: string; password: string };

    const job = await CrawlJob.findByPk(id);
    if (!job) {
      throw new NotFoundError('Crawl job not found');
    }
    if (job.status !== 'AWAITING_CREDENTIALS') {
      throw new ConflictError(`Job is not awaiting credentials (current status: ${job.status})`);
    }

    // Replace any prior submission for this job, then hand it back to the worker -- one
    // atomic unit so a crash mid-way never leaves stale credentials alongside a job
    // that's already flipped back to PENDING (or vice versa).
    await sequelize.transaction(async t => {
      await CrawlCredential.destroy({ where: { crawlJobId: id }, transaction: t });
      await CrawlCredential.create({ crawlJobId: id, username, password }, { transaction: t });
      await job.update({ status: 'PENDING', errorMessage: null }, { transaction: t });
    });

    return ok(res, { message: 'Credentials submitted; crawl will resume shortly.' });
  })
);

/**
 * GET /api/graph/:projectId
 * Returns Neo4j nodes and edges projection for visualization. Handler lives in
 * graph-routes.ts so the standalone admin server can mount it too.
 */
router.use('/graph', readLoose, graphRouter);

/**
 * POST /api/workflows/:workflowId/run
 * Queues a Playwright recording of a workflow: a worker replays its steps in a fresh
 * headless browser, records video, and generates captions from the AI summaries/
 * descriptions and entities already collected for those steps. Handler lives in
 * workflow-run-routes.ts so the standalone admin server can mount it too.
 */
router.use('/workflows', crawlHeavy, workflowRunRouter);

/**
 * GET /api/workflow-runs/:id
 * Fetches status of a workflow recording run. Once COMPLETED, video_path/captions_path
 * are filenames servable under /recordings/*.
 */
router.get(
  '/workflow-runs/:id',
  readLoose,
  asyncHandler(async (req: Request, res: Response) => {
    const run = await WorkflowRun.findByPk(req.params.id);
    if (!run) {
      throw new NotFoundError('Workflow run not found');
    }
    return ok(res, workflowRunJson(run));
  })
);

/**
 * GET /api/summary/:projectId
 * Returns high-level domain summary to save AI token usage.
 */
router.get(
  '/summary/:projectId',
  readLoose,
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await KnowledgeSummary.findOne({ where: { projectId: req.params.projectId } });
    if (!summary) {
      throw new NotFoundError('Summary not found for this project');
    }
    return ok(res, summaryJson(summary));
  })
);
