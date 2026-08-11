import { WorkflowKnowledge } from './agent/workflow-knowledge';
import { DeterministicScriptEngine } from './agent/deterministic-script-engine';
import { query, pool } from './config/database';

/**
 * Exercises DeterministicScriptEngine against real, already-crawled workflow_steps rows
 * -- no LLM, no browser, no mock server, unlike test-crawler.ts. Run with:
 *   npx tsx src/test-script-engine.ts [workflowId]
 * If no workflowId is given, runs against every workflow currently in the DB.
 */
async function runOne(workflowId: string, name: string) {
  console.log(`\n=== Workflow ${workflowId} (${name}) ===`);
  const knowledgeSteps = await WorkflowKnowledge.gather(workflowId);
  const generated = DeterministicScriptEngine.generate(knowledgeSteps);

  for (const step of generated.stepMetadata) {
    const flag = step.skipped ? '  [SKIPPED]' : '';
    console.log(`\n-- Step ${step.stepNumber}${flag}: ${step.narration}`);
    console.log(step.code);
  }

  const skippedCount = generated.stepMetadata.filter(s => s.skipped).length;
  console.log(`\n(${generated.stepMetadata.length} steps, ${skippedCount} skipped, model=${generated.model})`);
}

async function main() {
  const explicitId = process.argv[2];

  try {
    if (explicitId) {
      await runOne(explicitId, '(explicit)');
      return;
    }

    const res = await query(`SELECT id, name FROM workflows ORDER BY created_at ASC`);
    if (res.rowCount === 0) {
      console.log('No workflows found in the DB -- crawl a project first.');
      return;
    }
    for (const row of res.rows) {
      try {
        await runOne(row.id, row.name);
      } catch (err: any) {
        console.error(`Workflow ${row.id} (${row.name}) failed: ${err?.message || err}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main();
