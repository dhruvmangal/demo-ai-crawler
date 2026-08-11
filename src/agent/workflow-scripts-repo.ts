import { sequelize } from '../config/sequelize';
import { WorkflowScript, WorkflowScriptHeal } from '../db/models';
import { WorkflowScriptRow, GeneratedScript, StepMetadata, HealAudit } from '../types/workflow-scripts';

function mapRow(row: WorkflowScript): WorkflowScriptRow {
  return {
    id: row.id,
    workflowId: row.workflowId,
    sourceCode: row.sourceCode,
    stepMetadata: row.stepMetadata,
    status: row.status,
    version: row.version,
    model: row.model,
    healCount: row.healCount
  };
}

/** The one currently-usable script for a workflow, or null if none exists yet / it needs regeneration. */
export async function loadActiveScript(workflowId: string): Promise<WorkflowScriptRow | null> {
  const row = await WorkflowScript.findOne({ where: { workflowId, status: 'ACTIVE' } });
  return row ? mapRow(row) : null;
}

/** Inserts a freshly generated script, or overwrites/reactivates an existing (e.g. NEEDS_REGENERATION) one. */
export async function persistGeneratedScript(workflowId: string, generated: GeneratedScript): Promise<WorkflowScriptRow> {
  return sequelize.transaction(async t => {
    const existing = await WorkflowScript.findOne({ where: { workflowId }, transaction: t, lock: t.LOCK.UPDATE });

    if (existing) {
      await existing.update(
        {
          sourceCode: generated.sourceCode,
          stepMetadata: generated.stepMetadata,
          status: 'ACTIVE',
          version: existing.version + 1,
          model: generated.model,
          generatedAt: new Date(),
          healCount: 0
        },
        { transaction: t }
      );
      return mapRow(existing);
    }

    const created = await WorkflowScript.create(
      { workflowId, sourceCode: generated.sourceCode, stepMetadata: generated.stepMetadata, status: 'ACTIVE', version: 1, model: generated.model },
      { transaction: t }
    );
    return mapRow(created);
  });
}

/** Persists a run's successfully-healed steps back onto the script, plus one HEALED audit row per heal. */
export async function persistHealedSteps(scriptId: string, runId: string, stepMetadata: StepMetadata[], heals: HealAudit[]): Promise<void> {
  await sequelize.transaction(async t => {
    await WorkflowScript.increment(
      { healCount: heals.length },
      { where: { id: scriptId }, transaction: t }
    );
    await WorkflowScript.update({ stepMetadata }, { where: { id: scriptId }, transaction: t });

    for (const heal of heals) {
      await WorkflowScriptHeal.create(
        {
          workflowScriptId: scriptId,
          workflowRunId: runId,
          failedStepNumber: heal.stepNumber,
          errorMessage: heal.errorMessage,
          outcome: 'HEALED',
          diffSummary: heal.diffSummary
        },
        { transaction: t }
      );
    }
  });
}

/** Records a heal attempt that did not resolve the failure -- the run still fails. */
export async function recordHealFailure(scriptId: string, runId: string, stepNumber: number, errorMessage: string): Promise<void> {
  await WorkflowScriptHeal.create({
    workflowScriptId: scriptId,
    workflowRunId: runId,
    failedStepNumber: stepNumber,
    errorMessage,
    outcome: 'HEAL_FAILED',
    diffSummary: null
  });
}

/**
 * On success, keeps the script ACTIVE. On failure, flips it to NEEDS_REGENERATION so the
 * next run regenerates from scratch via Planner+Generator instead of retrying the same
 * broken script.
 */
export async function markScriptOutcome(scriptId: string, runId: string, outcome: 'SUCCEEDED' | 'FAILED'): Promise<void> {
  await WorkflowScript.update(
    { lastRunId: runId, lastRunStatus: outcome, status: outcome === 'FAILED' ? 'NEEDS_REGENERATION' : 'ACTIVE' },
    { where: { id: scriptId } }
  );
}
