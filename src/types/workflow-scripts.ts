/** One ui_elements row, as gathered for a workflow step's page. */
export interface KnowledgeUiElement {
  id: string;
  type: string;
  label: string | null;
  selector: string;
  role: string | null;
  aiDescription: string | null;
}

/**
 * One resolved workflow step, joined from workflow_steps + pages + actions + entities,
 * plus the full ui_elements vocabulary for that step's page -- not just the one
 * (entity, actionType) selector actionSelectorHint resolves to. See
 * src/agent/workflow-knowledge.ts.
 */
export interface WorkflowKnowledgeStep {
  stepNumber: number;
  pageId: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  pageAiSummary: string | null;
  pageAiDescription: string | null;
  actionType: string | null;
  actionSelectorHint: string | null;
  entityName: string | null;
  pageElements: KnowledgeUiElement[];
}

/** Carried in StepMetadata so the healer can re-ground itself without a DB round trip. */
export interface StepKnowledgeContext {
  pageUrl?: string | null;
  actionType?: string | null;
  entityName?: string | null;
}

/**
 * The executable representation of one generated/healed step -- `code` is the body of
 * an `async (page, ctx) => { ... }` function, compiled at run time via node:vm (see
 * src/recorder/workflow-recorder.ts). This is what's persisted in
 * workflow_scripts.step_metadata.
 */
export interface StepMetadata {
  stepNumber: number;
  narration: string;
  code: string;
  skipped: boolean;
  knowledgeContext: StepKnowledgeContext;
}

export interface GeneratedScript {
  sourceCode: string;
  stepMetadata: StepMetadata[];
  model: string;
}

/** One successful heal, as recorded to workflow_script_heals. */
export interface HealAudit {
  stepNumber: number;
  errorMessage: string;
  diffSummary: string;
}

export type WorkflowScriptStatus = 'ACTIVE' | 'NEEDS_REGENERATION';

/** A workflow_scripts row, as loaded/persisted by src/agent/workflow-scripts-repo.ts. */
export interface WorkflowScriptRow {
  id: string;
  workflowId: string;
  sourceCode: string;
  stepMetadata: StepMetadata[];
  status: WorkflowScriptStatus;
  version: number;
  model: string;
  healCount: number;
}
