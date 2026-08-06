export type WorkflowRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface WorkflowRun {
  id: string;
  workflowId: string;
  projectId: string;
  status: WorkflowRunStatus;
  videoPath?: string | null;
  captionsPath?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
}

/** One resolved workflow step, joined from workflow_steps + pages + actions + entities. */
export interface WorkflowRunStep {
  stepNumber: number;
  pageUrl?: string | null;
  pageTitle?: string | null;
  pageAiSummary?: string | null;
  pageAiDescription?: string | null;
  actionType?: string | null;
  actionSelector?: string | null;
  entityName?: string | null;
}
