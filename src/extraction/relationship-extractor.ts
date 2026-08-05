import { Page, UiElement } from '../types/pages';
import { Entity, Relationship } from '../types/entities';
import { EntityExtractor } from './entity-extractor';

export class RelationshipExtractor {
  /**
   * Evaluates relationships between discovered entities based on layout context, fields, and URL design.
   */
  public static extract(
    pages: Page[],
    uiElements: UiElement[],
    entities: Entity[]
  ): Relationship[] {
    const relationships: Relationship[] = [];
    const entityNames = entities.map(e => e.name);

    const getEntityByName = (name: string): Entity | undefined => {
      const normalized = EntityExtractor.normalizeEntityName(name);
      return entities.find(e => e.name === normalized);
    };

    // Helper to add relationship safely
    const addRelation = (source: string, target: string, type: string, confidence: number) => {
      const sourceEnt = getEntityByName(source);
      const targetEnt = getEntityByName(target);
      if (sourceEnt && targetEnt && sourceEnt.name !== targetEnt.name) {
        // Ensure no duplicate relationships are pushed
        const exists = relationships.some(
          r => r.sourceEntityId === sourceEnt.id &&
               r.targetEntityId === targetEnt.id &&
               r.relationshipType === type
        );
        if (!exists) {
          relationships.push({
            sourceEntityId: sourceEnt.id!,
            targetEntityId: targetEnt.id!,
            relationshipType: type,
            confidence
          });
        }
      }
    };

    // 1. Analyze URL Hierarchy (e.g. /customers/123/orders -> Customer -> Order)
    for (const page of pages) {
      const pathSegments = page.url.split('/').filter(Boolean);
      for (let i = 0; i < pathSegments.length - 2; i++) {
        const parentCandidate = pathSegments[i];
        const childCandidate = pathSegments[i + 2]; // Skip ID parameter or intermediary subpath
        // Check if both correspond to entities
        const parentEntity = EntityExtractor.normalizeEntityName(parentCandidate);
        const childEntity = EntityExtractor.normalizeEntityName(childCandidate);
        if (entityNames.includes(parentEntity) && entityNames.includes(childEntity)) {
          addRelation(parentEntity, childEntity, `HAS_${childEntity.toUpperCase()}`, 0.90);
        }
      }
    }

    // 2. Form Field references (e.g., field name "customer_id" in a "Create Order" form)
    for (const el of uiElements) {
      if (el.type === 'form' && el.metadata?.fields) {
        const formEntity = EntityExtractor.normalizeEntityName(
          el.label.replace(/(form|create|new|edit)/gi, '')
        );

        const fields = el.metadata.fields as Array<{ name: string; label: string }>;
        for (const field of fields) {
          const fieldNameLower = field.name.toLowerCase();
          const labelLower = field.label.toLowerCase();

          for (const ent of entities) {
            const entLower = ent.name.toLowerCase();
            // Check if field name contains entity name + id/key (e.g., customer_id, customerId)
            const idPattern = new RegExp(`(${entLower})_?(id|key|select|ref)`, 'i');
            if (idPattern.test(fieldNameLower) || idPattern.test(labelLower)) {
              addRelation(formEntity, ent.name, `HAS_${ent.name.toUpperCase()}`, 0.85);
            }
          }
        }
      }
    }

    // 3. Navigation Hierarchy (Page parent-child relation maps to entity relationships)
    for (const page of pages) {
      if (page.parentPageId) {
        const parentPage = pages.find(p => p.id === page.parentPageId);
        if (parentPage) {
          const parentEntity = EntityExtractor.normalizeEntityName(
            parentPage.title.replace(/(management|list|overview)/gi, '')
          );
          const childEntity = EntityExtractor.normalizeEntityName(
            page.title.replace(/(management|list|overview)/gi, '')
          );
          if (entityNames.includes(parentEntity) && entityNames.includes(childEntity)) {
            addRelation(parentEntity, childEntity, `HAS_${childEntity.toUpperCase()}`, 0.80);
          }
        }
      }
    }

    // 4. Tables with column names of other entities (e.g., column "Customer" inside "Orders" table)
    for (const el of uiElements) {
      if (el.type === 'table' && el.metadata?.columns) {
        const tableEntity = EntityExtractor.normalizeEntityName(
          el.label.replace(/(table|list|grid|overview)/gi, '')
        );

        const columns = el.metadata.columns as string[];
        for (const col of columns) {
          const colNormalized = EntityExtractor.normalizeEntityName(col);
          if (entityNames.includes(colNormalized)) {
            addRelation(tableEntity, colNormalized, `RELATED_TO`, 0.75);
          }
        }
      }
    }

    return relationships;
  }
}
