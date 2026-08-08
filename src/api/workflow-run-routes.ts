import { Router, Request, Response } from 'express';
import { query } from '../config/database';

/**
 * POST /:workflowId/run (mounted at /api/workflows in crawler-app, and again in the
 * standalone admin server so the admin backoffice's "Record video" button works on its
 * own port). Queues a Playwright recording of a workflow: workflow-agent-worker polls
 * workflow_runs directly, so queuing here is just the DB insert -- no cross-container
 * call needed regardless of which server handles the request.
 */
export const workflowRunRouter = Router();

workflowRunRouter.post('/:workflowId/run', async (req: Request, res: Response) => {
  const { workflowId } = req.params;

  try {
    const workflowRes = await query(`SELECT id, project_id FROM workflows WHERE id = $1`, [workflowId]);
    if (workflowRes.rowCount === 0) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const runRes = await query(
      `INSERT INTO workflow_runs (workflow_id, project_id, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id, workflow_id, project_id, status, created_at`,
      [workflowId, workflowRes.rows[0].project_id]
    );

    return res.status(201).json({
      message: 'Workflow recording queued successfully',
      run: runRes.rows[0]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
