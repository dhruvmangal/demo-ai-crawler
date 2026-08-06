import path from 'path';
import { query } from '../config/database';
import { WorkflowRecorder } from '../recorder/workflow-recorder';
import { WorkflowRunStep } from '../types/workflow-runs';

const POLL_INTERVAL_MS = 5000;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', '..', 'recordings');

const recorder = new WorkflowRecorder(RECORDINGS_DIR);

async function processNextRun() {
  const selectRes = await query(
    `UPDATE workflow_runs
     SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM workflow_runs
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, workflow_id`
  );

  if (selectRes.rowCount === 0) {
    return;
  }

  const run = selectRes.rows[0];
  console.log(`[Workflow Agent] Recording run ${run.id} for workflow ${run.workflow_id}`);

  try {
    const stepsRes = await query(
      `SELECT ws.step_number   AS "stepNumber",
              p.url            AS "pageUrl",
              p.title          AS "pageTitle",
              p.ai_summary     AS "pageAiSummary",
              p.ai_description AS "pageAiDescription",
              a.action_type    AS "actionType",
              a.selector       AS "actionSelector",
              e.name           AS "entityName"
       FROM workflow_steps ws
       LEFT JOIN pages p ON p.id = ws.page_id
       LEFT JOIN actions a ON a.id = ws.action_id
       LEFT JOIN entities e ON e.id = ws.entity_id
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_number ASC`,
      [run.workflow_id]
    );

    const steps: WorkflowRunStep[] = stepsRes.rows;
    if (steps.length === 0) {
      throw new Error('Workflow has no steps to record.');
    }

    const result = await recorder.record(run.id, steps);

    await query(
      `UPDATE workflow_runs
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, video_path = $1, captions_path = $2
       WHERE id = $3`,
      [path.basename(result.videoPath), path.basename(result.captionsPath), run.id]
    );
    console.log(`[Workflow Agent] Run ${run.id} completed.`);
  } catch (err: any) {
    console.error(`[Workflow Agent] Run ${run.id} failed:`, err);
    await query(
      `UPDATE workflow_runs
       SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = $1
       WHERE id = $2`,
      [err?.message || String(err), run.id]
    );
  }
}

async function run() {
  console.log('[Workflow Agent] Starting background worker polling loop...');
  while (true) {
    try {
      await processNextRun();
    } catch (e) {
      console.error('[Workflow Agent] Polling error:', e);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

run();
