import Anthropic from '@anthropic-ai/sdk';
import { Page } from 'playwright';
import { BROWSER_TOOLS, executeBrowserTool } from './browser-tools';
import { SafetyEngine } from '../safety/safety-engine';
import { StepMetadata } from '../types/workflow-scripts';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 4096;
const MAX_HEAL_ITERATIONS = 6;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const FINISH_HEAL_TOOL: Anthropic.Tool = {
  name: 'finish_heal',
  description: 'Call this when you have either repaired the step or determined it should become a safe no-op.',
  input_schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Body of a fixed `async (page, ctx) => { ... }` function, or a no-op if the action can no longer be safely reproduced.' },
      narration: { type: 'string', description: 'One-sentence, present-tense narration suitable as a video caption.' },
      diffSummary: { type: 'string', description: 'One-sentence description of what changed and why, for the heal audit trail.' }
    },
    required: ['code', 'narration', 'diffSummary']
  }
};

export interface HealResult {
  code: string;
  narration: string;
  diffSummary: string;
}

/**
 * Repairs one failing step of an already-persisted script, in place, using the same
 * live `page` from the in-progress recording run -- never a second browser context,
 * so the one-browser-per-run video stays continuous. Scope is deliberately narrow:
 * one step, one bounded tool loop (mirrors the retired orchestrator's per-step budget),
 * patching just the failing step rather than regenerating the whole script. Returns
 * null if it can't produce a fix within the iteration budget -- the caller
 * (WorkflowRecorder) then lets the original error propagate and the run fails.
 */
export class ScriptHealer {
  public static async heal(step: StepMetadata, error: Error, page: Page): Promise<HealResult | null> {
    const contextText = [
      `Original intent: ${step.narration}`,
      step.knowledgeContext.pageUrl ? `Expected page: ${step.knowledgeContext.pageUrl}` : null,
      step.knowledgeContext.actionType
        ? `Action type: ${step.knowledgeContext.actionType}${step.knowledgeContext.entityName ? ` on ${step.knowledgeContext.entityName}` : ''}`
        : null,
      `Original code:\n${step.code}`,
      `Error when this code ran just now: ${error.message}`
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt =
      'This Playwright script step failed while replaying a recorded workflow, most likely because ' +
      'a selector went stale. Diagnose why by inspecting the live page (call read_page_elements), ' +
      'then either (a) find the corrected element and produce fixed code with the same signature ' +
      '`async (page, ctx) => { ... }`, preserving the original intent, or (b) if the underlying ' +
      'action now looks unsafe/destructive, produce a no-op with an explanatory narration. Call ' +
      'finish_heal when done, with a one-sentence diffSummary describing what you changed and why.';

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contextText }];
    let skipped = false;

    for (let i = 0; i < MAX_HEAL_ITERATIONS; i++) {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: [...BROWSER_TOOLS, FINISH_HEAL_TOOL],
        messages
      });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      const finishCall = toolUseBlocks.find(b => b.name === 'finish_heal');

      if (finishCall) {
        const input = finishCall.input as any;
        const code = skipped
          ? '// Skipped for safety: the healed action was blocked by SafetyEngine.'
          : typeof input?.code === 'string'
            ? input.code
            : step.code;
        const narration = typeof input?.narration === 'string' ? input.narration : step.narration;
        const diffSummary = typeof input?.diffSummary === 'string' ? input.diffSummary : 'Healed step.';
        return { code, narration, diffSummary };
      }

      if (toolUseBlocks.length === 0) {
        return null;
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUseBlocks) {
        try {
          if (call.name === 'click') {
            const selector = (call.input as any)?.selector || '';
            const safetyLabel = [step.knowledgeContext.actionType, step.knowledgeContext.entityName, step.narration]
              .filter(Boolean)
              .join(' ');
            const safety = SafetyEngine.checkAction(safetyLabel || 'Click', selector, step.knowledgeContext.actionType || undefined);
            if (!safety.safe) {
              skipped = true;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: call.id,
                content: `Blocked for safety: ${safety.reason}`,
                is_error: true
              });
              continue;
            }
          }
          const result = await executeBrowserTool(page, call.name, call.input);
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result });
        } catch (err: any) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: `Error: ${err?.message || err}`,
            is_error: true
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return null;
  }
}
