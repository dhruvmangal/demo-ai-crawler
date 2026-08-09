import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { graphRouter } from './graph-routes';
import { workflowRunRouter } from './workflow-run-routes';
import { authRouter } from './auth-routes';

export const router = Router();

// How long a completed crawl for a given target URL is considered fresh. A new
// POST /api/crawl for the same URL within this window reuses that result instead of
// re-crawling (re-navigating every page, re-running AI summarization/extraction).
const CRAWL_TTL_HOURS = Math.max(0, Number(process.env.CRAWL_TTL_HOURS) || 24);

/**
 * Authentication and User Tracking routes (Google, GitHub, and Demo logins/signups)
 */
router.use('/auth', authRouter);

/**
 * POST /api/crawl
 * Triggers a website discovery crawl. If this exact target URL was already crawled
 * to completion within CRAWL_TTL_HOURS, returns that existing job/project instead of
 * queuing a new crawl.
 */
router.post('/crawl', async (req: Request, res: Response) => {
  const { targetUrl, projectId } = req.body;

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  try {
    if (CRAWL_TTL_HOURS > 0) {
      const recentRes = await query(
        `SELECT id, project_id, target_url, status, created_at, completed_at
         FROM crawl_jobs
         WHERE target_url = $1
           AND status = 'COMPLETED'
           AND completed_at > NOW() - make_interval(hours => $2::int)
         ORDER BY completed_at DESC
         LIMIT 1`,
        [targetUrl, CRAWL_TTL_HOURS]
      );

      if ((recentRes.rowCount ?? 0) > 0) {
        return res.status(200).json({
          message: `Reusing crawl completed within the last ${CRAWL_TTL_HOURS}h; not re-crawling.`,
          cached: true,
          job: recentRes.rows[0]
        });
      }
    }

    const projId = projectId || uuidv4();
    const jobRes = await query(
      `INSERT INTO crawl_jobs (project_id, target_url, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id, project_id, target_url, status, created_at`,
      [projId, targetUrl]
    );

    return res.status(201).json({
      message: 'Crawl job queued successfully',
      cached: false,
      job: jobRes.rows[0]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/crawl/:id
 * Fetches status of a crawl job.
 */
router.get('/crawl/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const jobRes = await query(
      `SELECT id, project_id, target_url, status, login_url, started_at, completed_at, error_message
       FROM crawl_jobs WHERE id = $1`,
      [id]
    );

    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    return res.json(jobRes.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crawl/:id/credentials
 * Submits login credentials for a job that is paused awaiting them (status AWAITING_CREDENTIALS).
 * Credentials are held in crawl_credentials only transiently -- the worker deletes the row
 * as soon as it reads it, whether or not the login attempt succeeds.
 */
router.post('/crawl/:id/credentials', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const jobRes = await query(`SELECT id, status FROM crawl_jobs WHERE id = $1`, [id]);

    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }
    if (jobRes.rows[0].status !== 'AWAITING_CREDENTIALS') {
      return res.status(409).json({
        error: `Job is not awaiting credentials (current status: ${jobRes.rows[0].status})`
      });
    }

    // Replace any prior submission for this job, then hand it back to the worker.
    await query(`DELETE FROM crawl_credentials WHERE crawl_job_id = $1`, [id]);
    await query(
      `INSERT INTO crawl_credentials (crawl_job_id, username, password) VALUES ($1, $2, $3)`,
      [id, username, password]
    );
    await query(
      `UPDATE crawl_jobs SET status = 'PENDING', error_message = NULL WHERE id = $1`,
      [id]
    );

    return res.json({ message: 'Credentials submitted; crawl will resume shortly.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/graph/:projectId
 * Returns Neo4j nodes and edges projection for visualization. Handler lives in
 * graph-routes.ts so the standalone admin server can mount it too.
 */
router.use('/graph', graphRouter);

/**
 * POST /api/workflows/:workflowId/run
 * Queues a Playwright recording of a workflow: a worker replays its steps in a fresh
 * headless browser, records video, and generates captions from the AI summaries/
 * descriptions and entities already collected for those steps. Handler lives in
 * workflow-run-routes.ts so the standalone admin server can mount it too.
 */
router.use('/workflows', workflowRunRouter);

/**
 * GET /api/workflow-runs/:id
 * Fetches status of a workflow recording run. Once COMPLETED, video_path/captions_path
 * are filenames servable under /recordings/*.
 */
router.get('/workflow-runs/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const runRes = await query(
      `SELECT id, workflow_id, project_id, status, video_path, captions_path,
              error_message, started_at, completed_at
       FROM workflow_runs WHERE id = $1`,
      [id]
    );

    if (runRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }

    return res.json(runRes.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/summary/:projectId
 * Returns high-level domain summary to save AI token usage.
 */
router.get('/summary/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const summaryRes = await query(
      `SELECT domain, summary_data, created_at FROM knowledge_summaries WHERE project_id = $1`,
      [projectId]
    );

    if (summaryRes.rowCount === 0) {
      return res.status(404).json({ error: 'Summary not found for this project' });
    }

    return res.json(summaryRes.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
