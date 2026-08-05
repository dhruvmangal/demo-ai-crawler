import { query } from '../config/database';
import { Page, UiElement } from '../types/pages';
import { Entity, Action, Relationship } from '../types/entities';
import { Workflow, WorkflowStep } from '../types/workflows';
import { EntityExtractor } from '../extraction/entity-extractor';
import { RelationshipExtractor } from '../extraction/relationship-extractor';
import { WorkflowDetector } from '../extraction/workflow-detector';
import { GraphProjection } from '../graph/graph-projection';
import { v4 as uuidv4 } from 'uuid';

export class KnowledgeBuilder {
  /**
   * Orchestrates SQL insertion, structural analysis, heuristics, and graphs projection.
   */
  public static async build(
    projectId: string,
    rawPages: Array<{
      url: string;
      title: string;
      breadcrumb: string;
      domHash: string;
      domJson: any;
      elements: UiElement[];
    }>
  ): Promise<void> {
    console.log(`Starting Knowledge Builder for Project: ${projectId}`);

    // 1. Insert/Update Pages
    const pagesList: Page[] = [];
    const elementsList: UiElement[] = [];

    // Clean old elements for the project (handled by cascades in pages)
    await query(`DELETE FROM pages WHERE project_id = $1`, [projectId]);

    // Insert pages first to obtain database IDs
    for (const rawPage of rawPages) {
      const pageId = uuidv4();
      const insertPageRes = await query(
        `INSERT INTO pages (id, project_id, url, title, breadcrumb, dom_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [pageId, projectId, rawPage.url, rawPage.title, rawPage.breadcrumb, rawPage.domHash]
      );

      const dbPageId = insertPageRes.rows[0].id;
      const pageRecord: Page = {
        id: dbPageId,
        projectId,
        url: rawPage.url,
        title: rawPage.title,
        breadcrumb: rawPage.breadcrumb,
        domHash: rawPage.domHash
      };
      pagesList.push(pageRecord);

      // Insert Page Snapshots
      await query(
        `INSERT INTO page_snapshots (page_id, dom_hash, dom_json)
         VALUES ($1, $2, $3)`,
        [dbPageId, rawPage.domHash, JSON.stringify(rawPage.domJson)]
      );

      // Map raw elements to DB structures
      for (const el of rawPage.elements) {
        const elId = uuidv4();
        const insertElRes = await query(
          `INSERT INTO ui_elements (id, page_id, type, label, selector, role, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [elId, dbPageId, el.type, el.label, el.selector, el.role || null, el.confidence]
        );
        elementsList.push({
          ...el,
          id: insertElRes.rows[0].id,
          pageId: dbPageId
        });
      }
    }

    // 2. Resolve Page parent-child relations based on URL sub-paths
    // E.g. /customers/new is child of /customers
    for (const page of pagesList) {
      const currentUrl = page.url;
      let parentPage: Page | undefined = undefined;

      // Split segments and search for potential parent page
      const segments = currentUrl.split('/').filter(Boolean);
      if (segments.length > 1) {
        const parentPath = '/' + segments.slice(0, -1).join('/');
        parentPage = pagesList.find(p => p.url === parentPath);
      }

      if (parentPage) {
        page.parentPageId = parentPage.id;
        await query(
          `UPDATE pages SET parent_page_id = $1 WHERE id = $2`,
          [parentPage.id, page.id]
        );
      }
    }

    // 3. Extract & Insert Entities
    const { entities: extractedEntities, actions: extractedActions } = EntityExtractor.extract(
      projectId,
      elementsList,
      pagesList.length > 0 ? pagesList[0].title : 'System'
    );

    const savedEntities: Entity[] = [];
    await query(`DELETE FROM entities WHERE project_id = $1`, [projectId]);

    for (const ent of extractedEntities) {
      const entId = uuidv4();
      const insertEntRes = await query(
        `INSERT INTO entities (id, project_id, name, entity_type, confidence)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [entId, projectId, ent.name, ent.entityType, ent.confidence]
      );
      savedEntities.push({
        ...ent,
        id: insertEntRes.rows[0].id
      });
    }

    // 4. Extract & Insert Actions (link to corresponding Entities)
    const savedActions: Action[] = [];
    for (const act of extractedActions) {
      // Find matching saved entity (best-guess matching label)
      const matchedEntity = savedEntities.find(
        e => act.selector?.toLowerCase().includes(e.name.toLowerCase()) || 
             act.actionType.toLowerCase().includes(e.name.toLowerCase())
      ) || savedEntities[0]; // fallback to first entity

      if (matchedEntity) {
        const actId = uuidv4();
        const insertActRes = await query(
          `INSERT INTO actions (id, entity_id, action_type, selector, confidence)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [actId, matchedEntity.id, act.actionType, act.selector || null, act.confidence]
        );
        savedActions.push({
          ...act,
          id: insertActRes.rows[0].id,
          entityId: matchedEntity.id!
        });
      }
    }

    // 5. Extract & Insert Entity Relationships
    const extractedRelationships = RelationshipExtractor.extract(
      pagesList,
      elementsList,
      savedEntities
    );

    const savedRelationships: Relationship[] = [];
    for (const rel of extractedRelationships) {
      const relId = uuidv4();
      const insertRelRes = await query(
        `INSERT INTO relationships (id, source_entity_id, target_entity_id, relationship_type, confidence)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_entity_id, target_entity_id, relationship_type) DO UPDATE 
         SET confidence = EXCLUDED.confidence
         RETURNING id`,
        [relId, rel.sourceEntityId, rel.targetEntityId, rel.relationshipType, rel.confidence]
      );
      savedRelationships.push({
        ...rel,
        id: insertRelRes.rows[0].id
      });
    }

    // 6. Detect & Insert Workflows
    const { workflows: extractedWorkflows, steps: extractedSteps } = WorkflowDetector.detect(
      projectId,
      pagesList,
      elementsList,
      savedEntities,
      savedActions
    );

    const savedWorkflows: Workflow[] = [];
    const savedSteps: WorkflowStep[] = [];

    await query(`DELETE FROM workflows WHERE project_id = $1`, [projectId]);

    for (const wf of extractedWorkflows) {
      const insertWfRes = await query(
        `INSERT INTO workflows (id, project_id, name, confidence)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [wf.id, projectId, wf.name, wf.confidence]
      );
      savedWorkflows.push({
        ...wf,
        id: insertWfRes.rows[0].id
      });
    }

    for (const step of extractedSteps) {
      const stepId = uuidv4();
      await query(
        `INSERT INTO workflow_steps (id, workflow_id, step_number, page_id, action_id, entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [stepId, step.workflowId, step.stepNumber, step.pageId || null, step.actionId || null, step.entityId || null]
      );
      savedSteps.push({
        ...step,
        id: stepId
      });
    }

    // 7. Project to Neo4j
    await GraphProjection.project(projectId, {
      pages: pagesList,
      entities: savedEntities,
      actions: savedActions,
      relationships: savedRelationships,
      workflows: savedWorkflows,
      workflowSteps: savedSteps
    });

    console.log(`Knowledge building and graph projection completed for project: ${projectId}`);
  }
}
