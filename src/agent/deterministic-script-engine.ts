import { SafetyEngine } from '../safety/safety-engine';
import { GeneratedScript, KnowledgeUiElement, StepMetadata, WorkflowKnowledgeStep } from '../types/workflow-scripts';

const MODEL_LABEL = 'deterministic-v1';

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function elementText(el: KnowledgeUiElement): string {
  return `${el.label || ''} ${el.aiDescription || ''} ${el.role || ''} ${el.type}`;
}

const MAX_SUMMARY_NARRATION_CHARS = 160;

// Crawl-time page summaries are written as full paragraphs, not captions -- take just the
// first sentence (falling back to a hard truncation for a summary with no sentence break)
// so it reads as one caption-length beat rather than a wall of text.
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
  const sentence = match ? match[0] : trimmed;
  return sentence.length > MAX_SUMMARY_NARRATION_CHARS
    ? `${sentence.slice(0, MAX_SUMMARY_NARRATION_CHARS - 1).trimEnd()}…`
    : sentence;
}

function scoreElement(el: KnowledgeUiElement, queryTokens: string[]): number {
  const elTokens = new Set(tokenize(elementText(el)));
  return queryTokens.reduce((score, t) => score + (elTokens.has(t) ? 1 : 0), 0);
}

interface ResolvedTarget {
  element: KnowledgeUiElement | null;
  selector: string | null;
}

function resolveTarget(step: WorkflowKnowledgeStep): ResolvedTarget {
  // The hint resolves to one selector per (entity, actionType) globally, not per page --
  // if it happens to match a known element on *this* page, prefer that element (so we
  // still get its type/label for fill-vs-click and value inference); otherwise fall back
  // to using the hint selector directly, unmatched.
  if (step.actionSelectorHint) {
    const hintMatch = step.pageElements.find(el => el.selector === step.actionSelectorHint);
    if (hintMatch) {
      return { element: hintMatch, selector: hintMatch.selector };
    }
  }

  const queryTokens = tokenize(`${step.actionType || ''} ${step.entityName || ''}`);
  if (queryTokens.length > 0 && step.pageElements.length > 0) {
    const ranked = [...step.pageElements].sort((a, b) => scoreElement(b, queryTokens) - scoreElement(a, queryTokens));
    if (scoreElement(ranked[0], queryTokens) > 0) {
      return { element: ranked[0], selector: ranked[0].selector };
    }
  }

  if (step.actionSelectorHint) {
    return { element: null, selector: step.actionSelectorHint };
  }
  return { element: null, selector: null };
}

export interface ActionContext {
  actionType: string | null;
  entityName: string | null;
}

function inferInputValue(el: KnowledgeUiElement, ctx: ActionContext): string {
  const text = `${el.label || ''} ${el.aiDescription || ''} ${el.role || ''} ${ctx.actionType || ''} ${ctx.entityName || ''}`.toLowerCase();
  if (text.includes('email')) return 'demo@example.com';
  if (text.includes('password')) return 'Demo1234!';
  if (text.includes('phone')) return '555-0100';
  if (text.includes('date')) return new Date().toISOString().slice(0, 10);
  if (text.includes('search') || text.includes('filter') || text.includes('query')) return 'demo';
  if (/\b(number|amount|qty|quantity|price)\b/.test(text)) return '1';
  if (text.includes('name')) return 'Demo User';
  return 'Test value';
}

function looksLikeSearch(el: KnowledgeUiElement, ctx: ActionContext): boolean {
  const text = `${el.label || ''} ${el.role || ''} ${ctx.actionType || ''}`.toLowerCase();
  return text.includes('search') || text.includes('filter');
}

// Guards against actionSelectorHint values that are descriptive text rather than a real
// selector (a known knowledge-extractor artifact, e.g. `[/path] button "Go to file"
// (selector: ...)`) -- with no live browser to catch this at generation time the way the
// old LLM pipeline did, this is the only check standing between bad DB data and a
// guaranteed-broken page.click()/page.fill() call. Deliberately a plain character
// whitelist (rather than a full CSS grammar) so it only rejects strings no real selector
// would ever contain (e.g. "/", unescaped quotes-around-phrases), not unusual-but-valid
// selectors.
function looksLikeCssSelector(selector: string): boolean {
  const s = selector.trim();
  if (!s || s.length > 300 || s.includes('\n')) return false;
  return /^[a-zA-Z0-9_\-.#\[\]="':,>~+()*^$| \t]+$/.test(s);
}

export interface ActionOutcome {
  lines: string[];
  narrationPart: string;
  skipped: boolean;
}

/**
 * Given a UI element that's confirmed to exist (either from the crawl-time knowledge base
 * or freshly rediscovered on the live page), decide fill-vs-click, infer a fill value, and
 * run it past SafetyEngine -- the one piece of "what code do we emit for this element"
 * logic, shared by DeterministicScriptEngine's DB-driven generation and ScriptHealer's
 * live-page re-matching (src/agent/script-healer.ts) so both paths stay in sync.
 */
export function buildActionForElement(el: KnowledgeUiElement, ctx: ActionContext): ActionOutcome {
  const label = el.label || ctx.entityName || ctx.actionType || 'element';
  const safetyLabel = [ctx.actionType, ctx.entityName, label].filter(Boolean).join(' ');
  const safety = SafetyEngine.checkAction(safetyLabel, el.selector, ctx.actionType || undefined);

  if (!safety.safe) {
    return {
      lines: [`  // Skipped for safety: ${safety.reason}`],
      narrationPart: `${ctx.actionType || 'Act on'}${ctx.entityName ? ` ${ctx.entityName}` : ''}`,
      skipped: true
    };
  }

  if (el.type === 'input') {
    const value = inferInputValue(el, ctx);
    const lines = [`  await page.fill(${JSON.stringify(el.selector)}, ${JSON.stringify(value)});`];
    if (looksLikeSearch(el, ctx)) {
      lines.push(`  await page.press(${JSON.stringify(el.selector)}, 'Enter');`);
    }
    return { lines, narrationPart: `Enter "${value}" into "${label}"`, skipped: false };
  }

  // form/table/dialog are containers, not clickable targets -- a <form> in particular is
  // routinely present-but-invisible (e.g. a hidden SSO auto-submit form), so clicking it
  // directly just times out waiting for visibility. The actual actionable thing (a submit
  // button, a row action, a close button) is a *descendant* we have no specific selector
  // for, so the safe move is to skip rather than guess a container-wide click.
  if (el.type === 'form' || el.type === 'table' || el.type === 'dialog') {
    return {
      lines: [`  // Skipped: "${label}" is a ${el.type} container, not a clickable element -- no specific descendant selector known.`],
      narrationPart: `${ctx.actionType || 'Act on'}${ctx.entityName ? ` ${ctx.entityName}` : ''}`,
      skipped: true
    };
  }

  return {
    lines: [`  await page.click(${JSON.stringify(el.selector)}, { timeout: 10000 });`],
    narrationPart: `Click "${label}"`,
    skipped: false
  };
}

interface BuiltStep {
  code: string;
  narration: string;
  skipped: boolean;
  nextUrl: string | null;
}

function buildStep(step: WorkflowKnowledgeStep, currentUrl: string | null): BuiltStep {
  const lines: string[] = [];
  const narrationParts: string[] = [];
  let skipped = false;

  if (step.pageUrl && step.pageUrl !== currentUrl) {
    lines.push(`  await page.goto(${JSON.stringify(step.pageUrl)}, { waitUntil: 'domcontentloaded' });`);
    narrationParts.push(`Navigate to ${step.pageTitle || step.pageUrl}`);
  }

  if (step.actionType) {
    const target = resolveTarget(step);
    const ctx: ActionContext = { actionType: step.actionType, entityName: step.entityName };

    if (!target.selector || !looksLikeCssSelector(target.selector)) {
      skipped = true;
      const reason = !target.selector
        ? `no known selector for ${step.actionType}${step.entityName ? ` on ${step.entityName}` : ''}`
        : `stored selector doesn't look like valid CSS: ${JSON.stringify(target.selector)}`;
      lines.push(`  // Skipped: ${reason}.`);
      narrationParts.push(`${step.actionType}${step.entityName ? ` ${step.entityName}` : ''}`);
    } else if (target.element) {
      const outcome = buildActionForElement(target.element, ctx);
      lines.push(...outcome.lines);
      narrationParts.push(outcome.narrationPart);
      skipped = outcome.skipped;
    } else {
      // A raw actionSelectorHint with no matching ui_elements row -- no element `type`
      // to decide fill-vs-click from, so assume click (the far more common case).
      lines.push(`  await page.click(${JSON.stringify(target.selector)}, { timeout: 10000 });`);
      narrationParts.push(`Click "${step.entityName || step.actionType}"`);
    }
  } else if (step.pageAiSummary) {
    // Pure page-view step -- every Full Site Tour step is one of these. Prefer the
    // crawl-time AI summary over the generic "Navigate to X"/"View the X page" text
    // pushed above/below so the tour's narration actually says something about each
    // page, not just its title.
    narrationParts.length = 0;
    // Strip the sentence's own trailing punctuation -- the caller always appends one
    // final "." when joining narrationParts, so keeping it here would double it up.
    narrationParts.push(firstSentence(step.pageAiSummary).replace(/[.!?]+$/, ''));
  }

  if (lines.length === 0) {
    lines.push('  // View step: no action to perform.');
    if (narrationParts.length === 0) {
      narrationParts.push(`View the ${step.pageTitle || step.pageUrl || 'page'} page`);
    }
  }

  return {
    code: lines.join('\n'),
    narration: `${narrationParts.join('. ')}.`,
    skipped,
    nextUrl: step.pageUrl || currentUrl
  };
}

function buildSourceCode(stepMetadata: StepMetadata[]): string {
  const header = '// GENERATED by DeterministicScriptEngine (workflow_scripts) -- do not hand-edit, healer/regen will overwrite.\n';
  const functions = stepMetadata
    .map(step => {
      const comment = `// Step ${step.stepNumber}: ${step.narration}${step.skipped ? ' (skipped)' : ''}`;
      return `${comment}\nasync function step${step.stepNumber}(page, ctx) {\n${step.code}\n}`;
    })
    .join('\n\n');
  const exportsList = stepMetadata
    .map(step => `  { stepNumber: ${step.stepNumber}, narration: ${JSON.stringify(step.narration)}, run: step${step.stepNumber} }`)
    .join(',\n');
  return `${header}\n${functions}\n\nmodule.exports = {\n  steps: [\n${exportsList}\n  ]\n};\n`;
}

/**
 * Turns a workflow's crawled knowledge (pages, ui_elements, actions, entities -- see
 * WorkflowKnowledge.gather) directly into a persisted, reusable Playwright script, with
 * no LLM call and no live browser: the crawl already recorded every page's element
 * vocabulary and each action's selector hint, so generation is just resolving that into
 * code. Replaces ScriptPlanner+ScriptGenerator as the primary generation path (see
 * recording-worker-thread.ts) -- ScriptHealer is unrelated and untouched, since it repairs
 * a step live mid-recording against the real page, after generation, when a selector has
 * actually gone stale.
 *
 * Per step: emit a `page.goto` if the step's page differs from the page the previous step
 * left off on, then resolve the step's action (if any) to a known ui_elements row by
 * token-overlap between actionType/entityName and the element's label/description/role/
 * type (falling back to the raw actionSelectorHint if no element matches). `input`-typed
 * targets get a `page.fill` with a value inferred from the field's label/type; everything
 * else gets a `page.click`. SafetyEngine filters destructive actions exactly as the LLM
 * pipeline did, so behavior there is unchanged.
 */
export class DeterministicScriptEngine {
  public static generate(knowledgeSteps: WorkflowKnowledgeStep[]): GeneratedScript {
    if (knowledgeSteps.length === 0) {
      throw new Error('Cannot generate a script with no knowledge steps.');
    }

    let currentUrl: string | null = null;
    const stepMetadata: StepMetadata[] = [];

    for (const step of knowledgeSteps) {
      const built = buildStep(step, currentUrl);
      currentUrl = built.nextUrl;
      stepMetadata.push({
        stepNumber: step.stepNumber,
        narration: built.narration,
        code: built.code,
        skipped: built.skipped,
        knowledgeContext: {
          pageUrl: step.pageUrl,
          actionType: step.actionType,
          entityName: step.entityName
        }
      });
    }

    return { sourceCode: buildSourceCode(stepMetadata), stepMetadata, model: MODEL_LABEL };
  }
}
