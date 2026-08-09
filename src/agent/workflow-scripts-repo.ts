import { query } from '../config/database';
import { WorkflowScriptRow, GeneratedScript, StepMetadata, HealAudit } from '../types/workflow-scripts';

function mapRow(row: any): WorkflowScriptRow {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    sourceCode: row.source_code,
    stepMetadata: row.step_metadata,
    status: row.status,
    version: row.version,
    model: row.model,
    healCount: row.heal_count
  };
}

/** The one currently-usable script for a workflow, or null if none exists yet / it needs regeneration. */
export async function loadActiveScript(workflowId: string): Promise<WorkflowScriptRow | null> {
  const res = await query(
    `SELECT id, workflow_id, source_code, step_metadata, status, version, model, heal_count
     FROM workflow_scripts
     WHERE workflow_id = $1 AND status = 'ACTIVE'`,
    [workflowId]
  );
  if (res.rowCount === 0) {
    return null;
  }
  return mapRow(res.rows[0]);
}

/** Inserts a freshly generated script, or overwrites/reactivates an existing (e.g. NEEDS_REGENERATION) one. */
export async function persistGeneratedScript(workflowId: string, generated: GeneratedScript): Promise<WorkflowScriptRow> {
  const res = await query(
    `INSERT INTO workflow_scripts (workflow_id, source_code, step_metadata, status, version, model)
     VALUES ($1, $2, $3, 'ACTIVE', 1, $4)
     ON CONFLICT (workflow_id) DO UPDATE SET
       source_code = EXCLUDED.source_code,
       step_metadata = EXCLUDED.step_metadata,
       status = 'ACTIVE',
       version = workflow_scripts.version + 1,
       model = EXCLUDED.model,
       generated_at = CURRENT_TIMESTAMP,
       heal_count = 0,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, workflow_id, source_code, step_metadata, status, version, model, heal_count`,
    [workflowId, generated.sourceCode, JSON.stringify(generated.stepMetadata), generated.model]
  );
  return mapRow(res.rows[0]);
}

/** Persists a run's successfully-healed steps back onto the script, plus one HEALED audit row per heal. */
export async function persistHealedSteps(
  scriptId: string,
  runId: string,
  stepMetadata: StepMetadata[],
  heals: HealAudit[]
): Promise<void> {
  await query(
    `UPDATE workflow_scripts
     SET step_metadata = $1, heal_count = heal_count + $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [JSON.stringify(stepMetadata), heals.length, scriptId]
  );
  for (const heal of heals) {
    await query(
      `INSERT INTO workflow_script_heals (workflow_script_id, workflow_run_id, failed_step_number, error_message, outcome, diff_summary)
       VALUES ($1, $2, $3, $4, 'HEALED', $5)`,
      [scriptId, runId, heal.stepNumber, heal.errorMessage, heal.diffSummary]
    );
  }
}

/** Records a heal attempt that did not resolve the failure -- the run still fails. */
export async function recordHealFailure(scriptId: string, runId: string, stepNumber: number, errorMessage: string): Promise<void> {
  await query(
    `INSERT INTO workflow_script_heals (workflow_script_id, workflow_run_id, failed_step_number, error_message, outcome)
     VALUES ($1, $2, $3, $4, 'HEAL_FAILED')`,
    [scriptId, runId, stepNumber, errorMessage]
  );
}

/**
 * On success, keeps the script ACTIVE. On failure, flips it to NEEDS_REGENERATION so the
 * next run regenerates from scratch via Planner+Generator instead of retrying the same
 * broken script.
 */
export async function markScriptOutcome(scriptId: string, runId: string, outcome: 'SUCCEEDED' | 'FAILED'): Promise<void> {
  await query(
    `UPDATE workflow_scripts
     SET last_run_id = $1, last_run_status = $2, status = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [runId, outcome, outcome === 'FAILED' ? 'NEEDS_REGENERATION' : 'ACTIVE', scriptId]
  );
}
