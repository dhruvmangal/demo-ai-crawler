import { OllamaClient } from './ollama-client';
import { UiElement } from '../types/pages';

const MAX_HTML_CHARS = Number(process.env.AI_MAX_HTML_CHARS) || 1500;

export interface PageSummaryResult {
  summary: string;
  description: string;
  components: Array<{ selector: string; description: string }>;
}

export class PageSummarizer {
  /**
   * Asks the local LLM to describe a page's purpose/functionality and each of its
   * discovered UI elements. Feeding it the already-discovered element list (rather than
   * relying on the small model to parse raw HTML for selectors) makes the structured
   * output far more reliable. Uses trimmed semantic HTML and tailored KV-cache context.
   */
  public static async summarize(input: {
    title: string;
    breadcrumb?: string | null;
    html: string;
    elements: UiElement[];
  }): Promise<PageSummaryResult | null> {
    const cleanedHtml = this.cleanHtml(input.html).slice(0, MAX_HTML_CHARS);

    const elementsList = input.elements
      .map(el => `- selector: ${el.selector} | type: ${el.type} | label: ${el.label}`)
      .join('\n') || '(none discovered)';

    const prompt = `You are analyzing a web application page to build a knowledge base entry.

Page title: ${input.title}
Breadcrumb: ${input.breadcrumb || '(none)'}

Structural Context (truncated):
${cleanedHtml || '(none)'}

Discovered UI elements on this page:
${elementsList}

Respond with ONLY a JSON object matching this exact shape, no other text:
{
  "summary": "one paragraph describing what this page is for",
  "description": "a more detailed description of this page's functionality",
  "components": [
    { "selector": "<selector copied exactly from the list above>", "description": "what this specific component does and why a user would use it" }
  ]
}
Include one "components" entry for every element in the discovered UI elements list, using the exact selector value given.`;

    const result = await OllamaClient.generateJson(prompt, { numCtx: 2048 });
    if (!result || typeof result.summary !== 'string' || typeof result.description !== 'string') {
      return null;
    }

    return {
      summary: result.summary,
      description: result.description,
      components: Array.isArray(result.components)
        ? result.components.filter((c: any) => c && typeof c.selector === 'string' && typeof c.description === 'string')
        : []
    };
  }

  private static cleanHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/data:image\/[^;]+;base64,[^"'\s]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
