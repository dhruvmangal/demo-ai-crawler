import { parentPort, workerData } from 'worker_threads';
import path from 'path';
import { query, pool } from '../config/database';
import { WorkflowKnowledge } from '../agent/workflow-knowledge';
import { DeterministicScriptEngine } from '../agent/deterministic-script-engine';
import { WorkflowRecorder, StepExecutionError } from '../recorder/workflow-recorder';
import {
  loadActiveScript,
  persistGeneratedScript,
  persistHealedSteps,
  recordHealFailure,
  markScriptOutcome
} from '../agent/workflow-scripts-repo';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', '..', 'recordings');
const recorder = new WorkflowRecorder(RECORDINGS_DIR);

interface RecordingWorkerData {
  runId: string;
  workflowId: string;
}

/**
 * Runs one workflow_run to completion: reuse the workflow's persisted script if it has
 * one, otherwise generate one (WorkflowKnowledge -> DeterministicScriptEngine, no LLM
 * call, no live browser -- the crawl-time knowledge base already has every page's
 * elements and each action's selector) and persist it, then record the video via
 * WorkflowRecorder -- which itself heals a step in place (via the LLM-based ScriptHealer)
 * if its compiled code throws against the live page. Spawned as its own
 * worker_threads Worker by workflow-agent-worker.ts so the poller isn't blocked while
 * this runs; gets its own pg Pool (module state isn't shared across threads) and closes
 * it before exiting so the thread actually terminates.
 */
async function main() {
  const { runId, workflowId } = workerData as RecordingWorkerData;
  let scriptId: string | null = null;

  try {
    let scriptRow = await loadActiveScript(workflowId);
    if (!scriptRow) {
      console.log(`[Recording Worker] No active script for workflow ${workflowId}, generating...`);
      const knowledgeSteps = await WorkflowKnowledge.gather(workflowId);
      const generated = DeterministicScriptEngine.generate(knowledgeSteps);
      scriptRow = await persistGeneratedScript(workflowId, generated);
    } else {
      console.log(`[Recording Worker] Reusing persisted script ${scriptRow.id} v${scriptRow.version} for workflow ${workflowId}`);
    }
    scriptId = scriptRow.id;

    const result = await recorder.record(runId, scriptRow);

    if (result.healed) {
      await persistHealedSteps(scriptRow.id, runId, result.stepMetadata, result.heals);
    }

    await query(
      `UPDATE workflow_runs
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, video_path = $1, captions_path = $2
       WHERE id = $3`,
      [path.basename(result.videoPath), path.basename(result.captionsPath), runId]
    );
    await markScriptOutcome(scriptRow.id, runId, 'SUCCEEDED');
    console.log(`[Recording Worker] Run ${runId} completed.`);
    parentPort?.postMessage({ ok: true });
  } catch (err: any) {
    console.error(`[Recording Worker] Run ${runId} failed:`, err);
    await query(
      `UPDATE workflow_runs
       SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = $1
       WHERE id = $2`,
      [err?.message || String(err), runId]
    ).catch(() => {});

    if (scriptId) {
      if (err instanceof StepExecutionError) {
        await recordHealFailure(scriptId, runId, err.stepNumber, err.message).catch(() => {});
      }
      await markScriptOutcome(scriptId, runId, 'FAILED').catch(() => {});
    }

    parentPort?.postMessage({ ok: false, error: err?.message || String(err) });
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
