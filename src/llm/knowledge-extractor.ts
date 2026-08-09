import { OllamaClient } from './ollama-client';

const MAX_ELEMENTS = 60;
const MAX_ELEMENT_DESC_CHARS = 120;
const PROJECT_LEVEL_TIMEOUT_MS = 180000;

export interface AiEntity {
  name: string;
  entityType: string;
  confidence: number;
}

export interface AiAction {
  entityName: string;
  actionType: string;
  selector?: string;
  confidence: number;
}

export interface AiRelationship {
  source: string;
  target: string;
  relationshipType: string;
  confidence: number;
}

export interface AiWorkflowStep {
  pageUrl?: string;
  entityName?: string;
  actionType?: string;
}

export interface AiWorkflow {
  name: string;
  confidence: number;
  steps: AiWorkflowStep[];
}

export interface AiKnowledgeResult {
  entities: AiEntity[];
  actions: AiAction[];
  relationships: AiRelationship[];
  workflows: AiWorkflow[];
}

export class KnowledgeExtractor {
  /**
   * Title-case + naive singularize, so the model's entity names dedupe
   * consistently (e.g. "customers" / "Customer" / "Customers" -> "Customer").
   */
  public static normalizeEntityName(name: string): string {
    let clean = name.trim().replace(/[-_]/g, ' ');
    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (clean.endsWith('ies')) return clean.slice(0, -3) + 'y';
    if (clean.endsWith('s') && !clean.endsWith('ss')) return clean.slice(0, -1);
    return clean;
  }

  /**
   * Project-level pass: reasons over already-condensed page/component AI
   * summaries (not raw HTML) to infer entities, actions, relationships, and
   * workflows generally -- unlike hardcoded template matching, this works for
   * arbitrary sites, not just CRM-shaped ones. Best-effort: returns null on
   * any failure so a bad/slow LLM call never fails the crawl.
   */
  public static async extract(input: {
    pages: Array<{ url: string; title: string; aiSummary?: string | null }>;
    elements: Array<{ pageUrl: string; type: string; label: string; selector: string; aiDescription?: string | null; confidence: number }>;
  }): Promise<AiKnowledgeResult | null> {
    const pagesList = input.pages
      .map(p => `- ${p.url} "${p.title}"${p.aiSummary ? ` - ${p.aiSummary}` : ''}`)
      .join('\n');

    // Deduplicate elements by (pageUrl, type, label) and rank by confidence to avoid
    // sending dozens of repetitive action buttons (e.g. table row delete buttons)
    const seenElementKeys = new Set<string>();
    const uniqueElements = [];
    const sortedElements = input.elements.slice().sort((a, b) => b.confidence - a.confidence);

    for (const el of sortedElements) {
      const key = `${el.pageUrl}::${el.type}::${el.label.trim().toLowerCase()}`;
      if (!seenElementKeys.has(key)) {
        seenElementKeys.add(key);
        uniqueElements.push(el);
      }
    }

    const elementsList = uniqueElements
      .slice(0, MAX_ELEMENTS)
      .map(e => {
        const desc = (e.aiDescription || '').slice(0, MAX_ELEMENT_DESC_CHARS);
        return `- [${e.pageUrl}] ${e.type} "${e.label}" (selector: ${e.selector})${desc ? ` - ${desc}` : ''}`;
      })
      .join('\n');

    const prompt = `You are analyzing a crawled website to build a knowledge graph.

Pages:
${pagesList || '(none)'}

Components:
${elementsList || '(none)'}

Based on the above, infer the business/domain entities, the actions users can take on them, the relationships between entities, and any multi-step workflows a user could complete on this site. Do not force-fit a CRM/e-commerce template -- infer whatever entities and workflows actually make sense for this specific site (which may be a marketing site, docs, a SaaS app, etc). If no meaningful workflow exists, return an empty "workflows" array rather than inventing one.

Respond with ONLY a JSON object matching this exact shape, no other text:
{
  "entities": [{ "name": "string", "entityType": "string", "confidence": 0.0-1.0 }],
  "actions": [{ "entityName": "string (must match an entities[].name)", "actionType": "string", "selector": "string (copy exactly from the components list, or omit)", "confidence": 0.0-1.0 }],
  "relationships": [{ "source": "string (entity name)", "target": "string (entity name)", "relationshipType": "string, e.g. HAS_ORDER", "confidence": 0.0-1.0 }],
  "workflows": [{ "name": "string", "confidence": 0.0-1.0, "steps": [{ "pageUrl": "string (copy exactly from the pages list)", "entityName": "string", "actionType": "string" }] }]
}`;

    const result = await OllamaClient.generateJson(prompt, {
      numCtx: 4096,
      timeoutMs: PROJECT_LEVEL_TIMEOUT_MS
    });
    if (!result || !Array.isArray(result.entities)) {
      return null;
    }

    // The model doesn't always include "confidence" -- default/clamp it rather than
    // letting `undefined` propagate to the Neo4j driver, which throws on missing params
    // (unlike Postgres, which just treats it as NULL).
    const conf = (v: any): number => (typeof v === 'number' && v >= 0 && v <= 1) ? v : 0.7;

    return {
      entities: result.entities
        .filter((e: any) => e && typeof e.name === 'string')
        .map((e: any) => ({ name: e.name, entityType: typeof e.entityType === 'string' ? e.entityType : 'BusinessObject', confidence: conf(e.confidence) })),
      actions: (Array.isArray(result.actions) ? result.actions : [])
        .filter((a: any) => a && typeof a.entityName === 'string' && typeof a.actionType === 'string')
        .map((a: any) => ({ entityName: a.entityName, actionType: a.actionType, selector: typeof a.selector === 'string' ? a.selector : undefined, confidence: conf(a.confidence) })),
      relationships: (Array.isArray(result.relationships) ? result.relationships : [])
        .filter((r: any) => r && typeof r.source === 'string' && typeof r.target === 'string' && typeof r.relationshipType === 'string')
        .map((r: any) => ({ source: r.source, target: r.target, relationshipType: r.relationshipType, confidence: conf(r.confidence) })),
      workflows: (Array.isArray(result.workflows) ? result.workflows : [])
        .filter((w: any) => w && typeof w.name === 'string' && Array.isArray(w.steps))
        .map((w: any) => ({ name: w.name, confidence: conf(w.confidence), steps: w.steps }))
    };
  }
}
