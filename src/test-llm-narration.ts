import { WorkflowKnowledge } from './agent/workflow-knowledge';
import { DeterministicScriptEngine } from './agent/deterministic-script-engine';
import { LlmNarrationEngine, NarrationContext } from './agent/llm-narration-engine';
import { pool } from './config/database';

/**
 * Compares today's deterministic narration against the new Ollama-based narration for a
 * real, already-crawled workflow -- no persistence, no recording, just text. Run with:
 *   npx tsx src/test-llm-narration.ts <workflowId> [jobRole] [targetAudience] [functionalityFocus]
 */
async function main() {
  const [workflowId, jobRole, targetAudience, functionalityFocus] = process.argv.slice(2);
  if (!workflowId) {
    console.log('Usage: npx tsx src/test-llm-narration.ts <workflowId> [jobRole] [targetAudience] [functionalityFocus]');
    process.exit(1);
  }

  const context: NarrationContext = { jobRole, targetAudience, functionalityFocus };

  try {
    const knowledgeSteps = await WorkflowKnowledge.gather(workflowId);
    if (knowledgeSteps.length === 0) {
      console.log(`No workflow_steps found for workflow ${workflowId}.`);
      return;
    }

    const deterministic = DeterministicScriptEngine.generate(knowledgeSteps);

    console.log(`\n=== Context ===`);
    console.log(JSON.stringify(context, null, 2));

    console.log(`\nCalling Ollama for narration (this can take a while on CPU)...`);
    const llmStepMetadata = await LlmNarrationEngine.narrate(knowledgeSteps, deterministic.stepMetadata, context);

    if (!llmStepMetadata) {
      console.log('\nLLM narration call failed or returned nothing usable -- see warnings above.');
      return;
    }

    const llmByStep = new Map(llmStepMetadata.map(s => [s.stepNumber, s.narration]));

    console.log(`\n=== Side-by-side (workflow ${workflowId}) ===`);
    for (const step of deterministic.stepMetadata) {
      console.log(`\n-- Step ${step.stepNumber}${step.skipped ? ' [SKIPPED]' : ''}`);
      console.log(`   deterministic: ${step.narration}`);
      console.log(`   llm:           ${llmByStep.get(step.stepNumber)}`);
    }
  } finally {
    await pool.end();
  }
}

main();
