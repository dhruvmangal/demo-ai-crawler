import Anthropic from '@anthropic-ai/sdk';
import { Page } from 'playwright';
import { BROWSER_TOOLS, executeBrowserTool } from './browser-tools';
import { SafetyEngine } from '../safety/safety-engine';
import { WorkflowRunStep } from '../types/workflow-runs';

const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ITERATIONS = 6;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Constructed lazily so a missing ANTHROPIC_API_KEY only surfaces when a
  // workflow run actually needs it, not at process startup.
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface OrchestratedStepResult {
  narration: string;
  actionSkipped: boolean;
}

/**
 * The orchestrating agent: given one step of a recorded workflow, asks Claude to
 * carry it out in a live browser using the Playwright tool surface (browser-tools.ts),
 * then narrate what it did. Replaces the old hardcoded goto/click replay -- the agent
 * can inspect the page and adapt if the recorded selector no longer matches, and
 * produces its own narration instead of a static template.
 */
export class WorkflowOrchestrator {
  public static async runStep(page: Page, step: WorkflowRunStep): Promise<OrchestratedStepResult> {
    const context = [
      step.pageUrl ? `Target page: ${step.pageUrl}` : null,
      step.pageTitle ? `Page title: ${step.pageTitle}` : null,
      (step.pageAiDescription || step.pageAiSummary) ? `Page description: ${step.pageAiDescription || step.pageAiSummary}` : null,
      step.actionType ? `Action to perform: ${step.actionType}${step.entityName ? ` on ${step.entityName}` : ''}` : null,
      step.actionSelector ? `Known selector for this action (from the original recording -- may be stale): ${step.actionSelector}` : null
    ].filter(Boolean).join('\n');

    const systemPrompt = 'You are a browser automation agent replaying one step of a previously recorded ' +
      'user workflow, for a demo video. Use the provided browser tools to carry out this step in the live ' +
      'browser. Prefer the given selector when one is provided, but use read_page_elements to find the right ' +
      'element if it no longer matches. If the step only involves viewing a page (no action to perform), do ' +
      "not click anything else -- just call finish. When the step is complete, call \"finish\" with a short, " +
      'one-sentence, present-tense narration suitable as a video caption.';

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Step ${step.stepNumber}:\n${context || '(no further context)'}` }
    ];

    let actionSkipped = false;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await getClient().messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: BROWSER_TOOLS,
        messages
      });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      const finishCall = toolUseBlocks.find(b => b.name === 'finish');

      if (finishCall) {
        const narration = typeof (finishCall.input as any)?.narration === 'string'
          ? (finishCall.input as any).narration
          : `Step ${step.stepNumber} completed.`;
        return { narration, actionSkipped };
      }

      if (toolUseBlocks.length === 0) {
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        return { narration: textBlock?.text?.trim() || `Step ${step.stepNumber} completed.`, actionSkipped };
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUseBlocks) {
        try {
          if (call.name === 'click') {
            const selector = (call.input as any)?.selector || '';
            const safety = SafetyEngine.checkAction(step.actionType || 'Click', selector, step.actionType || 'Click');
            if (!safety.safe) {
              actionSkipped = true;
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

    return { narration: `Step ${step.stepNumber} completed.`, actionSkipped };
  }
}
