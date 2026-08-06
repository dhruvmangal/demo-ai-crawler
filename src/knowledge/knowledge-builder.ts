import { query } from '../config/database';
import { Page, UiElement } from '../types/pages';
import { Entity, Action, Relationship } from '../types/entities';
import { Workflow, WorkflowStep } from '../types/workflows';
import { GraphProjection } from '../graph/graph-projection';
import { PageSummarizer } from '../llm/page-summarizer';
import { KnowledgeExtractor } from '../llm/knowledge-extractor';
import { v4 as uuidv4 } from 'uuid';

const AI_SUMMARIZATION_ENABLED = process.env.AI_SUMMARIZATION_ENABLED !== 'false';

export class KnowledgeBuilder {
  /**
   * Orchestrates SQL insertion, AI-driven entity/action/relationship/workflow
   * extraction, and graph projection.
   */
  public static async build(
    projectId: string,
    rawPages: Array<{
      url: string;
      title: string;
      breadcrumb: string;
      domHash: string;
      domJson: any;
      html?: string;
      elements: UiElement[];
      parentUrl?: string | null;
      viaLabel?: string | null;
      viaSelector?: string | null;
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
        `INSERT INTO pages (id, project_id, url, title, breadcrumb, dom_hash, via_label, via_selector)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [pageId, projectId, rawPage.url, rawPage.title, rawPage.breadcrumb, rawPage.domHash, rawPage.viaLabel || null, rawPage.viaSelector || null]
      );

      const dbPageId = insertPageRes.rows[0].id;
      const pageRecord: Page = {
        id: dbPageId,
        projectId,
        url: rawPage.url,
        title: rawPage.title,
        breadcrumb: rawPage.breadcrumb,
        domHash: rawPage.domHash,
        viaLabel: rawPage.viaLabel,
        viaSelector: rawPage.viaSelector
      };
      pagesList.push(pageRecord);

      // Insert Page Snapshots
      await query(
        `INSERT INTO page_snapshots (page_id, dom_hash, dom_json)
         VALUES ($1, $2, $3)`,
        [dbPageId, rawPage.domHash, JSON.stringify(rawPage.domJson)]
      );

      // Map raw elements to DB structures
      const pageElements: UiElement[] = [];
      for (const el of rawPage.elements) {
        const elId = uuidv4();
        const insertElRes = await query(
          `INSERT INTO ui_elements (id, page_id, type, label, selector, role, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [elId, dbPageId, el.type, el.label, el.selector, el.role || null, el.confidence]
        );
        const elementRecord: UiElement = {
          ...el,
          id: insertElRes.rows[0].id,
          pageId: dbPageId
        };
        pageElements.push(elementRecord);
        elementsList.push(elementRecord);
      }

      // AI enrichment: ask the local LLM to summarize this page's purpose/functionality
      // and describe each discovered UI element. Best-effort -- a failure here (model
      // unreachable, timeout, bad output) must never fail the crawl job.
      if (AI_SUMMARIZATION_ENABLED && rawPage.html) {
        try {
          const aiResult = await PageSummarizer.summarize({
            title: rawPage.title,
            breadcrumb: rawPage.breadcrumb,
            html: rawPage.html,
            elements: pageElements
          });

          if (aiResult) {
            pageRecord.aiSummary = aiResult.summary;
            pageRecord.aiDescription = aiResult.description;
            await query(
              `UPDATE pages SET ai_summary = $1, ai_description = $2 WHERE id = $3`,
              [aiResult.summary, aiResult.description, dbPageId]
            );

            for (const comp of aiResult.components) {
              const matchedEl = pageElements.find(e => e.selector === comp.selector);
              if (matchedEl) {
                matchedEl.aiDescription = comp.description;
                await query(
                  `UPDATE ui_elements SET ai_description = $1 WHERE id = $2`,
                  [comp.description, matchedEl.id]
                );
              }
            }
          }
        } catch (err: any) {
          console.warn(`[KnowledgeBuilder] AI summarization failed for page ${rawPage.url}: ${err?.message || err}`);
        }
      }
    }

    // 2. Resolve Page parent-child relations.
    // Prefer the actual navigation link/button that was clicked to discover this page
    // during the crawl (rawPage.parentUrl); this reflects the real site structure/click-path
    // rather than guessing from URL shape. Fall back to URL sub-path nesting
    // (e.g. /customers/new is child of /customers) only when no click-path was recorded
    // (e.g. the start page, or a CDP-attached session).
    for (let i = 0; i < pagesList.length; i++) {
      const page = pagesList[i];
      const rawPage = rawPages[i];
      const currentUrl = page.url;
      let parentPage: Page | undefined = undefined;

      if (rawPage.parentUrl) {
        parentPage = pagesList.find(p => p.url === rawPage.parentUrl);
      }

      if (!parentPage) {
        // Split segments and search for potential parent page
        const segments = currentUrl.split('/').filter(Boolean);
        if (segments.length > 1) {
          const parentPath = '/' + segments.slice(0, -1).join('/');
          parentPage = pagesList.find(p => p.url === parentPath);
        }
      }

      if (parentPage) {
        page.parentPageId = parentPage.id;
        await query(
          `UPDATE pages SET parent_page_id = $1 WHERE id = $2`,
          [parentPage.id, page.id]
        );
      }
    }

    // 3. AI knowledge extraction: entities, actions, relationships, and workflows,
    // inferred by the LLM from the already-condensed page/component AI summaries
    // (not raw HTML) -- generalizes to arbitrary sites instead of matching against
    // hardcoded CRM-shaped templates. Best-effort: on failure/disabled, these stay
    // empty for this crawl rather than failing the job.
    const savedEntities: Entity[] = [];
    const savedActions: Action[] = [];
    const savedRelationships: Relationship[] = [];
    const savedWorkflows: Workflow[] = [];
    const savedSteps: WorkflowStep[] = [];

    await query(`DELETE FROM entities WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM workflows WHERE project_id = $1`, [projectId]);

    let aiKnowledge = null;
    if (AI_SUMMARIZATION_ENABLED) {
      try {
        aiKnowledge = await KnowledgeExtractor.extract({
          pages: pagesList.map(p => ({ url: p.url, title: p.title, aiSummary: p.aiSummary })),
          elements: elementsList.map(e => ({ pageUrl: pagesList.find(p => p.id === e.pageId)?.url || '', type: e.type, label: e.label, selector: e.selector, aiDescription: e.aiDescription, confidence: e.confidence }))
        });
      } catch (err: any) {
        console.warn(`[KnowledgeBuilder] AI knowledge extraction failed for project ${projectId}: ${err?.message || err}`);
      }
    }

    if (aiKnowledge) {
      // Entities
      for (const ent of aiKnowledge.entities) {
        const entId = uuidv4();
        const normalizedName = KnowledgeExtractor.normalizeEntityName(ent.name);
        const insertEntRes = await query(
          `INSERT INTO entities (id, project_id, name, entity_type, confidence)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (project_id, name) DO UPDATE SET entity_type = EXCLUDED.entity_type, confidence = EXCLUDED.confidence
           RETURNING id`,
          [entId, projectId, normalizedName, ent.entityType || 'BusinessObject', ent.confidence]
        );
        savedEntities.push({
          projectId,
          name: normalizedName,
          entityType: ent.entityType,
          confidence: ent.confidence,
          id: insertEntRes.rows[0].id
        });
      }

      const findEntity = (name: string) => savedEntities.find(e => e.name === KnowledgeExtractor.normalizeEntityName(name));

      // Actions
      for (const act of aiKnowledge.actions) {
        const matchedEntity = findEntity(act.entityName);
        if (matchedEntity) {
          const actId = uuidv4();
          const insertActRes = await query(
            `INSERT INTO actions (id, entity_id, action_type, selector, confidence)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [actId, matchedEntity.id, act.actionType, act.selector || null, act.confidence]
          );
          savedActions.push({
            entityId: matchedEntity.id!,
            actionType: act.actionType,
            selector: act.selector,
            confidence: act.confidence,
            id: insertActRes.rows[0].id
          });
        }
      }

      // Relationships
      for (const rel of aiKnowledge.relationships) {
        const sourceEntity = findEntity(rel.source);
        const targetEntity = findEntity(rel.target);
        if (sourceEntity && targetEntity && sourceEntity.id !== targetEntity.id) {
          const relId = uuidv4();
          const insertRelRes = await query(
            `INSERT INTO relationships (id, source_entity_id, target_entity_id, relationship_type, confidence)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (source_entity_id, target_entity_id, relationship_type) DO UPDATE
             SET confidence = EXCLUDED.confidence
             RETURNING id`,
            [relId, sourceEntity.id, targetEntity.id, rel.relationshipType, rel.confidence]
          );
          savedRelationships.push({
            sourceEntityId: sourceEntity.id!,
            targetEntityId: targetEntity.id!,
            relationshipType: rel.relationshipType,
            confidence: rel.confidence,
            id: insertRelRes.rows[0].id
          });
        }
      }

      // Workflows + steps
      for (const wf of aiKnowledge.workflows) {
        const workflowId = uuidv4();
        const insertWfRes = await query(
          `INSERT INTO workflows (id, project_id, name, confidence)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [workflowId, projectId, wf.name, wf.confidence]
        );
        savedWorkflows.push({ id: insertWfRes.rows[0].id, projectId, name: wf.name, confidence: wf.confidence });

        let stepNumber = 1;
        for (const step of wf.steps) {
          const stepPage = step.pageUrl ? pagesList.find(p => p.url === step.pageUrl) : undefined;
          const stepEntity = step.entityName ? findEntity(step.entityName) : undefined;
          const stepAction = stepEntity && step.actionType
            ? savedActions.find(a => a.entityId === stepEntity.id && a.actionType.toLowerCase() === step.actionType!.toLowerCase())
            : undefined;

          const stepId = uuidv4();
          await query(
            `INSERT INTO workflow_steps (id, workflow_id, step_number, page_id, action_id, entity_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [stepId, workflowId, stepNumber, stepPage?.id || null, stepAction?.id || null, stepEntity?.id || null]
          );
          savedSteps.push({
            id: stepId,
            workflowId,
            stepNumber: stepNumber++,
            pageId: stepPage?.id || null,
            actionId: stepAction?.id || null,
            entityId: stepEntity?.id || null
          });
        }
      }
    } else {
      console.warn(`[KnowledgeBuilder] No AI knowledge extracted for project ${projectId} -- entities/actions/relationships/workflows left empty.`);
    }

    // 4. Project to Neo4j
    await GraphProjection.project(projectId, {
      pages: pagesList,
      uiElements: elementsList,
      entities: savedEntities,
      actions: savedActions,
      relationships: savedRelationships,
      workflows: savedWorkflows,
      workflowSteps: savedSteps
    });

    console.log(`Knowledge building and graph projection completed for project: ${projectId}`);
  }
}
