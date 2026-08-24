import { OllamaClient } from '../llm/ollama-client';
import { StepMetadata, WorkflowKnowledgeStep } from '../types/workflow-scripts';

export interface NarrationContext {
  jobRole?: string;
  targetAudience?: string;
  functionalityFocus?: string;
}

interface LlmNarrationResponse {
  narrations?: { stepNumber: number; narration: string }[];
}

function buildPrompt(knowledgeSteps: WorkflowKnowledgeStep[], stepMetadata: StepMetadata[], context: NarrationContext): string {
  const narrationByStep = new Map(stepMetadata.map(s => [s.stepNumber, s]));

  const stepLines = knowledgeSteps
    .map(step => {
      const meta = narrationByStep.get(step.stepNumber);
      const parts = [
        `Step ${step.stepNumber}:`,
        step.pageTitle || step.pageUrl ? `page="${step.pageTitle || step.pageUrl}"` : null,
        step.actionType ? `action=${step.actionType}${step.entityName ? ` on "${step.entityName}"` : ''}` : 'action=none (page view)',
        step.pageAiSummary ? `page_summary="${step.pageAiSummary}"` : null,
        `literal_action_taken="${meta?.narration || ''}"`
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');

  const audience = [
    context.jobRole ? `Job role of the viewer: ${context.jobRole}.` : null,
    context.targetAudience ? `Target audience: ${context.targetAudience}.` : null,
    context.functionalityFocus ? `Explain this functionality in more depth than the rest, since it's the point of the demo: ${context.functionalityFocus}.` : null
  ]
    .filter(Boolean)
    .join(' ');

  return `You are writing narration captions for a product demo video, one caption per recorded step.

${audience || 'No specific audience given -- write for a general business viewer.'}

Rules:
- One sentence per step (two only if functionality_focus requires more explanation for that step).
- Ground every sentence in that step's "literal_action_taken" -- never claim a click, entry, or navigation that isn't listed. You may rephrase it in the audience's language and add why it matters to them, but not invent new actions.
- No markdown, no step numbers inside the text itself.
- Return ONLY JSON matching: {"narrations": [{"stepNumber": <number>, "narration": "<text>"}, ...]}, one entry per step listed below, in order.

Steps:
${stepLines}`;
}

/**
 * Rewrites deterministic narration into audience-tailored captions via a local LLM call,
 * keeping every other part of StepMetadata (code, skipped, knowledgeContext) untouched --
 * this only ever changes what's said about a step, never what the step does. Returns null
 * if the LLM call fails outright or comes back with no usable narrations at all, so callers
 * can fall back to the deterministic narration already in stepMetadata (same null-on-failure
 * contract as OllamaClient itself). Falls back per-step to the deterministic narration for
 * any stepNumber the model omits or answers with junk, rather than failing the whole batch.
 */
export class LlmNarrationEngine {
  public static async narrate(
    knowledgeSteps: WorkflowKnowledgeStep[],
    stepMetadata: StepMetadata[],
    context: NarrationContext
  ): Promise<StepMetadata[] | null> {
    if (knowledgeSteps.length === 0) {
      return null;
    }

    const prompt = buildPrompt(knowledgeSteps, stepMetadata, context);
    const response = (await OllamaClient.generateJson(prompt, { temperature: 0.4 })) as LlmNarrationResponse | null;

    if (!response || !Array.isArray(response.narrations) || response.narrations.length === 0) {
      return null;
    }

    const narrationByStep = new Map(
      response.narrations
        .filter(n => typeof n?.stepNumber === 'number' && typeof n?.narration === 'string' && n.narration.trim().length > 0)
        .map(n => [n.stepNumber, n.narration.trim()])
    );

    if (narrationByStep.size === 0) {
      return null;
    }

    return stepMetadata.map(step => ({
      ...step,
      narration: narrationByStep.get(step.stepNumber) || step.narration
    }));
  }
}
