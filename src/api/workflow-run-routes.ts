import { Router, Request, Response } from 'express';
import { Workflow, WorkflowRun } from '../db/models';
import { asyncHandler } from '../middleware/async-handler';
import { ok } from '../utils/response-envelope';
import { NotFoundError } from '../errors/api-error';

/**
 * POST /:workflowId/run (mounted at /api/workflows in crawler-app, and again in the
 * standalone admin server so the admin backoffice's "Record video" button works on its
 * own port). Queues a Playwright recording of a workflow: workflow-agent-worker polls
 * workflow_runs directly, so queuing here is just the DB insert -- no cross-container
 * call needed regardless of which server handles the request.
 */
export const workflowRunRouter = Router();

workflowRunRouter.post(
  '/:workflowId/run',
  asyncHandler(async (req: Request, res: Response) => {
    const { workflowId } = req.params;

    const workflow = await Workflow.findByPk(workflowId);
    if (!workflow) {
      throw new NotFoundError('Workflow not found');
    }

    const run = await WorkflowRun.create({ workflowId, projectId: workflow.projectId, status: 'PENDING' });

    return ok(
      res,
      {
        message: 'Workflow recording queued successfully',
        run: { id: run.id, workflow_id: run.workflowId, project_id: run.projectId, status: run.status, created_at: run.createdAt }
      },
      201
    );
  })
);
