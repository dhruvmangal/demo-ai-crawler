import path from 'path';
import { Worker } from 'worker_threads';
import { sequelize } from '../config/sequelize';
import { WorkflowRun } from '../db/models';

const POLL_INTERVAL_MS = 5000;

// Bounds how many recording runs execute concurrently. Each unit of work is a real
// worker_threads Worker driving its own headless Chromium (recording-worker-thread.ts),
// not bounded async concurrency, so the *claim* itself is gated on this counter --
// unlike crawl-worker.ts's ENRICH_CONCURRENCY (which bounds a later phase, never the
// claim), claiming a PENDING run with no worker free to run it would leave it stuck
// RUNNING with nothing processing it.
const RECORDING_CONCURRENCY = Math.max(1, Number(process.env.RECORDING_CONCURRENCY) || 2);
let activeWorkers = 0;

function recordRun(run: { id: string; workflowId: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'recording-worker-thread.js'), {
      workerData: { runId: run.id, workflowId: run.workflowId }
    });
    worker.once('message', (msg: { ok: boolean; error?: string }) => {
      if (msg.ok) resolve();
      else reject(new Error(msg.error || 'Recording worker reported failure.'));
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`Recording worker exited with code ${code}`));
    });
  });
}

/**
 * Atomically claims the oldest PENDING run (Sequelize's lock+skipLocked, the ORM
 * equivalent of `SELECT ... FOR UPDATE SKIP LOCKED`) so multiple worker replicas never
 * grab the same run.
 */
async function claimNextRun(): Promise<WorkflowRun | null> {
  return sequelize.transaction(async t => {
    const run = await WorkflowRun.findOne({
      where: { status: 'PENDING' },
      order: [['createdAt', 'ASC']],
      lock: t.LOCK.UPDATE,
      skipLocked: true,
      transaction: t
    });
    if (!run) {
      return null;
    }
    await run.update({ status: 'RUNNING', startedAt: new Date() }, { transaction: t });
    return run;
  });
}

async function processNextRun() {
  if (activeWorkers >= RECORDING_CONCURRENCY) {
    return; // no room this tick -- the poll loop retries in POLL_INTERVAL_MS
  }

  const run = await claimNextRun();
  if (!run) {
    return;
  }

  console.log(`[Workflow Agent] Recording run ${run.id} for workflow ${run.workflowId}`);

  activeWorkers++;
  recordRun(run)
    .catch(err => console.error(`[Workflow Agent] Run ${run.id} worker error:`, err))
    .finally(() => {
      activeWorkers--;
    });
  // Deliberately not awaited: the poll loop keeps claiming/looping immediately so up
  // to RECORDING_CONCURRENCY runs can be in flight at once.
}

async function run() {
  console.log('[Workflow Agent] Starting background worker polling loop...');
  while (true) {
    try {
      await processNextRun();
    } catch (e) {
      console.error('[Workflow Agent] Polling error:', e);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

run();
