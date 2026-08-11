import { Page } from 'playwright';
import { OllamaClient } from '../llm/ollama-client';
import { UiDiscovery } from '../discovery/ui-discovery';
import { buildActionForElement, ActionContext } from './deterministic-script-engine';
import { KnowledgeUiElement, StepMetadata } from '../types/workflow-scripts';

const MAX_ELEMENTS = 40;
const MAX_ERROR_CHARS = 600;

export interface HealResult {
  code: string;
  narration: string;
  diffSummary: string;
}

function normalize(elements: Awaited<ReturnType<typeof UiDiscovery.discover>>): KnowledgeUiElement[] {
  return elements.map((el, i) => ({
    id: el.id || String(i),
    type: el.type,
    label: el.label ?? null,
    selector: el.selector,
    role: el.role ?? null,
    aiDescription: el.aiDescription ?? null
  }));
}

/**
 * Repairs one failing step of an already-persisted script, in place, using the same
 * live `page` from the in-progress recording run -- never a second browser context, so
 * the one-browser-per-run video stays continuous. Runs entirely against the local Ollama
 * model (same one crawl-time summarization uses, see src/llm/ollama-client.ts) rather
 * than Anthropic: no API key, no per-call cost, consistent with
 * DeterministicScriptEngine's no-LLM-for-generation design -- the only thing genuinely
 * LLM-shaped left in this pipeline is "which of these live elements is the one the
 * original step meant", so that's the only thing asked of the model. It answers with an
 * index into the live element list (never freeform selector text), which
 * buildActionForElement (shared with DeterministicScriptEngine) then turns into
 * deterministic, SafetyEngine-checked code exactly the same way generation does --
 * keeping the LLM's job narrowly "point at the right element", not "write code".
 * Returns null if the model can't confidently match anything -- the caller
 * (WorkflowRecorder) then lets the original error propagate and the run fails.
 */
export class ScriptHealer {
  public static async heal(step: StepMetadata, error: Error, page: Page): Promise<HealResult | null> {
    const rawElements = await UiDiscovery.discover(page);
    if (rawElements.length === 0) {
      return null;
    }
    // form/table/dialog are containers buildActionForElement will never click directly
    // (see its own comment) -- excluding them here means the model spends its one pick
    // on an element that could actually resolve the step, instead of one it's guaranteed
    // to end up skipping.
    const candidates = normalize(rawElements)
      .filter(el => el.type === 'button' || el.type === 'input')
      .slice(0, MAX_ELEMENTS);

    // UiDiscovery.discover() finds every matching DOM node regardless of whether it's
    // currently shown (e.g. one "Done" button per collapsed filter dropdown, all sharing
    // the same class) -- offering a hidden one as a candidate is worse than not offering
    // it: the model can "successfully" match it and we'd retry the exact same
    // element-not-visible failure. One isVisible() check per candidate, run in parallel;
    // a selector that no longer resolves at all (page moved on) counts as not visible too.
    const visibility = await Promise.all(
      candidates.map(el => page.locator(el.selector).first().isVisible().catch(() => false))
    );
    const elements = candidates.filter((_, i) => visibility[i]);
    if (elements.length === 0) {
      return null;
    }

    const elementsList = elements
      .map((el, i) => `${i}: [${el.type}] "${el.label || ''}"${el.role ? ` role=${el.role}` : ''} selector=${el.selector}`)
      .join('\n');

    const knowledgeLine = step.knowledgeContext.actionType
      ? `Action type: ${step.knowledgeContext.actionType}${step.knowledgeContext.entityName ? ` on ${step.knowledgeContext.entityName}` : ''}`
      : null;

    const prompt = [
      'A Playwright automation step just failed while replaying a recorded browser workflow, most likely because the page changed since it was recorded.',
      '',
      `Original intent: ${step.narration}`,
      knowledgeLine,
      `Original code that failed:\n${step.code}`,
      `Error:\n${(error.message || String(error)).slice(0, MAX_ERROR_CHARS)}`,
      `Interactive elements currently on the live page:\n${elementsList}`,
      '',
      'Pick the index of the ONE element above that best matches the original intent, or -1 if none of them do.',
      'Respond with ONLY a JSON object matching this exact shape, no other text:',
      '{ "elementIndex": <integer index from the list above, or -1> }'
    ]
      .filter(Boolean)
      .join('\n');

    const result = await OllamaClient.generateJson(prompt, { numCtx: 2048 });
    const index = result && typeof result.elementIndex === 'number' ? Math.trunc(result.elementIndex) : -1;
    if (index < 0 || index >= elements.length) {
      return null;
    }

    const ctx: ActionContext = {
      actionType: step.knowledgeContext.actionType ?? null,
      entityName: step.knowledgeContext.entityName ?? null
    };
    const outcome = buildActionForElement(elements[index], ctx);
    const narration = `${outcome.narrationPart}.`;
    const diffSummary = outcome.skipped
      ? 'Re-matched element was blocked by SafetyEngine; replaced with a no-op.'
      : `Live-repaired via Ollama: re-matched to "${elements[index].label}" (${elements[index].selector}) after the original selector failed.`;

    return { code: outcome.lines.join('\n'), narration, diffSummary };
  }
}
