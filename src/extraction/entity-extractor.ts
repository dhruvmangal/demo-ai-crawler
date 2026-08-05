import { UiElement } from '../types/pages';
import { Entity, Action } from '../types/entities';

export class EntityExtractor {
  private static ACTION_VERBS = [
    'create', 'add', 'new', 'edit', 'delete', 'remove', 'update', 'submit',
    'approve', 'reject', 'refund', 'download', 'import', 'export', 'view', 'cancel'
  ];

  /**
   * Plural-to-singular utility for entity normalization.
   */
  public static normalizeEntityName(name: string): string {
    let clean = name.trim().replace(/[-_]/g, ' ');
    // Title case
    clean = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    if (clean.endsWith('ies')) return clean.slice(0, -3) + 'y';
    if (clean.endsWith('s') && !clean.endsWith('ss')) return clean.slice(0, -1);
    return clean;
  }

  /**
   * Deterministically extract entities and actions from discovered UI Elements and Page title.
   */
  public static extract(projectId: string, elements: UiElement[], pageTitle: string): { entities: Entity[]; actions: Action[] } {
    const entityMap = new Map<string, Entity>();
    const actions: Action[] = [];

    const getOrAddEntity = (name: string, confidence: number = 0.9): Entity => {
      const normalized = this.normalizeEntityName(name);
      if (!entityMap.has(normalized)) {
        entityMap.set(normalized, {
          projectId,
          name: normalized,
          entityType: 'BusinessObject',
          confidence
        });
      }
      return entityMap.get(normalized)!;
    };

    // 1. Analyze page title (e.g., "Customer Directory" -> Entity: Customer, "Order Management" -> Entity: Order)
    const titleLower = pageTitle.toLowerCase();
    for (const verb of this.ACTION_VERBS) {
      if (titleLower.startsWith(verb)) {
        const potentialEntity = pageTitle.slice(verb.length).replace(/(list|table|management|directory|form)/gi, '').trim();
        if (potentialEntity.length > 2) {
          getOrAddEntity(potentialEntity, 0.85);
        }
      }
    }
    // General title heuristic
    const cleanTitle = pageTitle.replace(/(list|table|management|directory|form|details|overview)/gi, '').trim();
    if (cleanTitle.length > 2 && !this.ACTION_VERBS.includes(cleanTitle.toLowerCase())) {
      getOrAddEntity(cleanTitle, 0.8);
    }

    // 2. Analyze UI Elements
    for (const el of elements) {
      const labelLower = el.label.toLowerCase();

      // Heuristic: Check if label matches "Verb + Entity" or "Entity + Verb" (e.g. "Create Customer", "Submit Invoice")
      let matchedVerb: string | null = null;
      for (const verb of this.ACTION_VERBS) {
        if (labelLower.startsWith(verb)) {
          matchedVerb = verb;
          break;
        }
      }

      if (matchedVerb) {
        const entityPart = el.label.slice(matchedVerb.length).trim();
        if (entityPart.length > 1) {
          const entity = getOrAddEntity(entityPart, 0.95);
          // Capitalize verb
          const actionType = matchedVerb.charAt(0).toUpperCase() + matchedVerb.slice(1);
          actions.push({
            entityId: '', // Filled during database insertion
            actionType,
            selector: el.selector,
            confidence: 0.95
          });
        }
      } else {
        // If it's a form or table, infer the entity from the label (e.g., "Product Table" -> Entity: Product)
        if (el.type === 'form' || el.type === 'table') {
          const cleanLabel = el.label.replace(/(form|table|list|grid|details)/gi, '').trim();
          if (cleanLabel.length > 2) {
            getOrAddEntity(cleanLabel, 0.90);
          }
        }
      }
    }

    return {
      entities: Array.from(entityMap.values()),
      actions
    };
  }
}
