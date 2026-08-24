import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { sequelize } from '../config/sequelize';
import { CrawlJob, CrawlCredential } from '../db/models';
import { authorizeAdmin } from '../middleware/authorize-admin';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { credentialsBodySchema } from '../validation/schemas/crawl.schemas';
import { ok } from '../utils/response-envelope';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/api-error';

/**
 * Read-only endpoints backing the admin backoffice at /admin.
 *
 * A "request" here is a row in crawl_jobs -- the unit a user actually submits. Everything
 * downstream (pages, entities, workflows, recordings) is keyed by that job's project_id,
 * so the detail endpoint takes a job id and fans out over its project. Note a project can
 * be crawled more than once (POST /api/crawl accepts an existing projectId), in which case
 * sibling jobs share the same downstream data; `sibling_job_count` surfaces that.
 */
export const adminRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/requests
 * Lists every crawl request, newest first, with per-project rollup counts and totals
 * for the dashboard header. Supports ?limit= (default 100, max 500) and ?status=.
 */
adminRouter.get(
  '/requests',
  authorizeAdmin('crawl.view'),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 500);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;

    const [requestsRes, totalsRes] = await Promise.all([
      query(
        `SELECT j.id, j.project_id, j.target_url, j.status, j.login_url,
                j.error_message, j.created_at, j.started_at, j.completed_at,
                (SELECT COUNT(*)::int FROM pages p          WHERE p.project_id = j.project_id) AS page_count,
                (SELECT COUNT(*)::int FROM entities e       WHERE e.project_id = j.project_id) AS entity_count,
                (SELECT COUNT(*)::int FROM workflows w      WHERE w.project_id = j.project_id) AS workflow_count,
                (SELECT COUNT(*)::int FROM workflow_runs r  WHERE r.project_id = j.project_id) AS run_count,
                (SELECT COUNT(*)::int FROM workflow_runs r  WHERE r.project_id = j.project_id
                                                             AND r.video_path IS NOT NULL)    AS video_count,
                (SELECT COUNT(*)::int FROM crawl_jobs s     WHERE s.project_id = j.project_id
                                                             AND s.id <> j.id)                AS sibling_job_count
         FROM crawl_jobs j
         WHERE ($1::text IS NULL OR j.status = $1)
         ORDER BY j.created_at DESC
         LIMIT $2`,
        [status, limit]
      ),
      query(
        `SELECT (SELECT COUNT(*)::int FROM crawl_jobs)                                  AS requests,
                (SELECT COUNT(*)::int FROM crawl_jobs WHERE status IN ('PENDING','RUNNING','AWAITING_CREDENTIALS','ENRICHING')) AS requests_active,
                (SELECT COUNT(*)::int FROM pages)                                       AS pages,
                (SELECT COUNT(*)::int FROM entities)                                    AS entities,
                (SELECT COUNT(*)::int FROM workflows)                                   AS workflows,
                (SELECT COUNT(*)::int FROM workflow_runs)                               AS runs,
                (SELECT COUNT(*)::int FROM workflow_runs WHERE video_path IS NOT NULL)  AS videos`
      )
    ]);

    return ok(res, { totals: totalsRes.rows[0], requests: requestsRes.rows });
  })
);

/**
 * GET /api/admin/requests/:id
 * Everything the backoffice shows for one request: the job itself plus the pages,
 * entities/actions, relationships, workflows (with resolved steps) and recording runs
 * belonging to its project. The knowledge graph itself is fetched separately from
 * GET /api/graph/:projectId, and videos from /recordings/{video_path}.
 */
adminRouter.get(
  '/requests/:id',
  authorizeAdmin('crawl.view'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw new BadRequestError('id must be a UUID');
    }

    const jobRes = await query(
      `SELECT id, project_id, target_url, status, login_url, error_message,
              created_at, started_at, completed_at
       FROM crawl_jobs WHERE id = $1`,
      [id]
    );
    if (jobRes.rowCount === 0) {
      throw new NotFoundError('Crawl request not found');
    }
    const job = jobRes.rows[0];
    const projectId = job.project_id;

    const [pagesRes, entitiesRes, relationshipsRes, workflowsRes, runsRes, summaryRes, credentialRes] = await Promise.all([
      query(
        `SELECT p.id, p.url, p.title, p.breadcrumb, p.via_label, p.parent_page_id,
                p.ai_summary, p.ai_description, p.created_at,
                (SELECT COUNT(*)::int FROM ui_elements u WHERE u.page_id = p.id) AS element_count,
                COALESCE(
                  (SELECT json_agg(
                     json_build_object(
                       'id', u.id,
                       'type', u.type,
                       'label', u.label,
                       'selector', u.selector,
                       'role', u.role,
                       'confidence', u.confidence,
                       'ai_description', u.ai_description,
                       'discovered_via', u.metadata -> 'discoveredVia'
                     ) ORDER BY u.type ASC, u.label ASC
                   )
                   FROM ui_elements u WHERE u.page_id = p.id),
                  '[]'
                ) AS elements
         FROM pages p
         WHERE p.project_id = $1
         ORDER BY p.created_at ASC
         LIMIT 500`,
        [projectId]
      ),
      query(
        `SELECT e.id, e.name, e.entity_type, e.confidence,
                COALESCE(
                  json_agg(
                    json_build_object('action_type', a.action_type, 'selector', a.selector, 'confidence', a.confidence)
                    ORDER BY a.action_type
                  ) FILTER (WHERE a.id IS NOT NULL),
                  '[]'
                ) AS actions
         FROM entities e
         LEFT JOIN actions a ON a.entity_id = e.id
         WHERE e.project_id = $1
         GROUP BY e.id
         ORDER BY e.name ASC`,
        [projectId]
      ),
      query(
        `SELECT r.relationship_type, r.confidence,
                src.name AS source_name, tgt.name AS target_name
         FROM relationships r
         JOIN entities src ON src.id = r.source_entity_id
         JOIN entities tgt ON tgt.id = r.target_entity_id
         WHERE src.project_id = $1
         ORDER BY src.name ASC, tgt.name ASC`,
        [projectId]
      ),
      query(
        `SELECT w.id, w.name, w.confidence, w.type,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'step_number', ws.step_number,
                      'page_url', p.url,
                      'page_title', p.title,
                      'action_type', a.action_type,
                      'entity_name', e.name
                    ) ORDER BY ws.step_number
                  ) FILTER (WHERE ws.id IS NOT NULL),
                  '[]'
                ) AS steps
         FROM workflows w
         LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
         LEFT JOIN pages p    ON p.id = ws.page_id
         LEFT JOIN actions a  ON a.id = ws.action_id
         LEFT JOIN entities e ON e.id = ws.entity_id
         WHERE w.project_id = $1
         GROUP BY w.id
         ORDER BY (w.type = 'TOUR') DESC, w.confidence DESC, w.name ASC`,
        [projectId]
      ),
      query(
        `SELECT r.id, r.workflow_id, w.name AS workflow_name, r.status,
                r.video_path, r.captions_path, r.error_message,
                r.created_at, r.started_at, r.completed_at
         FROM workflow_runs r
         LEFT JOIN workflows w ON w.id = r.workflow_id
         WHERE r.project_id = $1
         ORDER BY r.created_at DESC`,
        [projectId]
      ),
      query(`SELECT domain, summary_data, created_at FROM knowledge_summaries WHERE project_id = $1`, [projectId]),
      query(`SELECT username, created_at, updated_at FROM project_credentials WHERE project_id = $1`, [projectId])
    ]);

    return ok(res, {
      job,
      summary: summaryRes.rows[0] || null,
      pages: pagesRes.rows,
      entities: entitiesRes.rows,
      relationships: relationshipsRes.rows,
      workflows: workflowsRes.rows,
      runs: runsRes.rows,
      // Never exposes the password -- just enough for an operator to see a working login is
      // already on file for this project before triggering a re-crawl.
      savedCredential: credentialRes.rows[0] || null
    });
  })
);

/**
 * POST /api/admin/requests/:id/credentials
 * Lets an operator unblock a job paused at AWAITING_CREDENTIALS from the backoffice
 * itself, instead of having to script a call to the end-user-authenticated
 * POST /api/crawl/:id/credentials (unreachable from here -- the admin backoffice runs on
 * its own server/port with admin auth, not the end-user auth that route requires). Mirrors
 * that handler's logic exactly; see its comment in routes.ts for the transaction rationale.
 */
adminRouter.post(
  '/requests/:id/credentials',
  authorizeAdmin('crawl.manage'),
  validate({ body: credentialsBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw new BadRequestError('id must be a UUID');
    }
    const { username, password, autoRegister } = req.body as { username: string; password: string; autoRegister?: boolean };

    const job = await CrawlJob.findByPk(id);
    if (!job) {
      throw new NotFoundError('Crawl request not found');
    }
    if (job.status !== 'AWAITING_CREDENTIALS') {
      throw new ConflictError(`Job is not awaiting credentials (current status: ${job.status})`);
    }

    await sequelize.transaction(async t => {
      await CrawlCredential.destroy({ where: { crawlJobId: id }, transaction: t });
      await CrawlCredential.create({ crawlJobId: id, username, password }, { transaction: t });
      const updates: { status: 'PENDING'; errorMessage: null; autoRegister?: boolean } = { status: 'PENDING', errorMessage: null };
      if (autoRegister !== undefined) {
        updates.autoRegister = autoRegister;
      }
      await job.update(updates, { transaction: t });
    });

    return ok(res, { message: 'Credentials submitted; crawl will resume shortly.' });
  })
);
