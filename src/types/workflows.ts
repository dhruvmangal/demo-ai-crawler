export type WorkflowType = 'EXTRACTED' | 'TOUR';

export interface Workflow {
  id?: string;
  projectId: string;
  name: string;
  confidence: number;
  type?: WorkflowType;
  createdAt?: Date;
}

export interface WorkflowStep {
  id?: string;
  workflowId: string;
  stepNumber: number;
  pageId?: string | null;
  actionId?: string | null;
  entityId?: string | null;
  createdAt?: Date;
}
