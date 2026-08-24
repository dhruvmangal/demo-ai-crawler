import { Router, Request, Response } from 'express';
import { Workflow, WorkflowRun } from '../db/models';
import { asyncHandler } from '../middleware/async-handler';
import { validate } from '../middleware/validate';
import { ok } from '../utils/response-envelope';
import { NotFoundError } from '../errors/api-error';
import { WorkflowKnowledge } from '../agent/workflow-knowledge';
import { DeterministicScriptEngine } from '../agent/deterministic-script-engine';
import { LlmNarrationEngine, NarrationContext } from '../agent/llm-narration-engine';
import { narrationPreviewBodySchema } from '../validation/schemas/workflow.schemas';

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

/**
 * POST /:workflowId/narration-preview (mounted alongside /:workflowId/run, same auth/rate
 * limiting). Compares today's deterministic narration against an experimental
 * Ollama-generated narration tailored to a job role/audience/functionality focus --
 * read-only, no video recording, no persistence to workflow_scripts. Exists so the prompt
 * can be tuned against real crawled workflows without paying for a full recording each
 * time; see LlmNarrationEngine for the fallback/failure contract.
 */
workflowRunRouter.post(
  '/:workflowId/narration-preview',
  validate({ body: narrationPreviewBodySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { workflowId } = req.params;
    const context = req.body as NarrationContext;

    const workflow = await Workflow.findByPk(workflowId);
    if (!workflow) {
      throw new NotFoundError('Workflow not found');
    }

    const knowledgeSteps = await WorkflowKnowledge.gather(workflowId);
    if (knowledgeSteps.length === 0) {
      throw new NotFoundError('No workflow_steps found for this workflow');
    }

    const deterministic = DeterministicScriptEngine.generate(knowledgeSteps);
    const llmStepMetadata = await LlmNarrationEngine.narrate(knowledgeSteps, deterministic.stepMetadata, context);
    const llmByStep = new Map((llmStepMetadata || []).map(s => [s.stepNumber, s.narration]));

    return ok(res, {
      workflowId,
      context,
      llmAvailable: llmStepMetadata !== null,
      steps: deterministic.stepMetadata.map(step => ({
        stepNumber: step.stepNumber,
        skipped: step.skipped,
        deterministicNarration: step.narration,
        llmNarration: llmByStep.get(step.stepNumber) || null
      }))
    });
  })
);
