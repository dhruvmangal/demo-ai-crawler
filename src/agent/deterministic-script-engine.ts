import { SafetyEngine } from '../safety/safety-engine';
import { GeneratedScript, KnowledgeUiElement, StepMetadata, WorkflowKnowledgeStep } from '../types/workflow-scripts';

const MODEL_LABEL = 'deterministic-v1';

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function elementText(el: KnowledgeUiElement): string {
  return `${el.label || ''} ${el.aiDescription || ''} ${el.role || ''} ${el.type}`;
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

function inferInputValue(el: KnowledgeUiElement, step: WorkflowKnowledgeStep): string {
  const text = `${el.label || ''} ${el.aiDescription || ''} ${el.role || ''} ${step.actionType || ''} ${step.entityName || ''}`.toLowerCase();
  if (text.includes('email')) return 'demo@example.com';
  if (text.includes('password')) return 'Demo1234!';
  if (text.includes('phone')) return '555-0100';
  if (text.includes('date')) return new Date().toISOString().slice(0, 10);
  if (text.includes('search') || text.includes('filter') || text.includes('query')) return 'demo';
  if (/\b(number|amount|qty|quantity|price)\b/.test(text)) return '1';
  if (text.includes('name')) return 'Demo User';
  return 'Test value';
}

function looksLikeSearch(el: KnowledgeUiElement, step: WorkflowKnowledgeStep): boolean {
  const text = `${el.label || ''} ${el.role || ''} ${step.actionType || ''}`.toLowerCase();
  return text.includes('search') || text.includes('filter');
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
    const label = target.element?.label || step.entityName || step.actionType;

    if (!target.selector) {
      skipped = true;
      lines.push(`  // Skipped: no known selector for ${step.actionType}${step.entityName ? ` on ${step.entityName}` : ''}.`);
      narrationParts.push(`${step.actionType}${step.entityName ? ` ${step.entityName}` : ''}`);
    } else {
      const safetyLabel = [step.actionType, step.entityName, label].filter(Boolean).join(' ');
      const safety = SafetyEngine.checkAction(safetyLabel, target.selector, step.actionType);

      if (!safety.safe) {
        skipped = true;
        lines.push(`  // Skipped for safety: ${safety.reason}`);
        narrationParts.push(`${step.actionType}${step.entityName ? ` ${step.entityName}` : ''}`);
      } else if (target.element?.type === 'input') {
        const value = inferInputValue(target.element, step);
        lines.push(`  await page.fill(${JSON.stringify(target.selector)}, ${JSON.stringify(value)});`);
        narrationParts.push(`Enter "${value}" into "${label}"`);
        if (looksLikeSearch(target.element, step)) {
          lines.push(`  await page.press(${JSON.stringify(target.selector)}, 'Enter');`);
        }
      } else {
        lines.push(`  await page.click(${JSON.stringify(target.selector)}, { timeout: 10000 });`);
        narrationParts.push(`Click "${label}"`);
      }
    }
  }

  if (lines.length === 0) {
    lines.push('  // View step: no action to perform.');
    narrationParts.push(`View the ${step.pageTitle || step.pageUrl || 'page'} page`);
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
