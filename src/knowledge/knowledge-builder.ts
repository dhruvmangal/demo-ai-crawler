import { query } from '../config/database';
import { Page, UiElement } from '../types/pages';
import { Entity, Action, Relationship } from '../types/entities';
import { Workflow, WorkflowStep } from '../types/workflows';
import { GraphProjection } from '../graph/graph-projection';
import { PageSummarizer, PageSummaryResult } from '../llm/page-summarizer';
import { KnowledgeExtractor } from '../llm/knowledge-extractor';
import { v4 as uuidv4 } from 'uuid';

const AI_SUMMARIZATION_ENABLED = process.env.AI_SUMMARIZATION_ENABLED !== 'false';
const AI_CONCURRENCY = Math.max(1, Number(process.env.AI_CONCURRENCY) || 3);
// Caps the synthetic "Full Site Tour" workflow so a large site doesn't produce an
// unwatchably long recording -- see the TOUR workflow synthesis below.
const MAX_TOUR_PAGES = 30;

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface BuiltKnowledgeResult {
  projectId: string;
  pageCount: number;
  entities: Entity[];
  workflows: Array<{ name: string; confidence: number; flowEntities: string[] }>;
}

export class KnowledgeBuilder {
  /**
   * Orchestrates SQL insertion, AI-driven entity/action/relationship/workflow
   * extraction, and graph projection. Includes DOM-hash deduplication, cross-crawl
   * caching, concurrent page summarization, and in-memory data return.
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
  ): Promise<BuiltKnowledgeResult> {
    console.log(`Starting Knowledge Builder for Project: ${projectId}`);

    // Check for existing AI summaries from previous crawls to reuse on matching domHash
    const domHashSummaryCache = new Map<
      string,
      { summary: string; description: string; components: Array<{ selector: string; description: string }> }
    >();
    try {
      const existingCacheRes = await query(
        `SELECT dom_hash, ai_summary, ai_description FROM pages WHERE project_id = $1 AND ai_summary IS NOT NULL`,
        [projectId]
      );
      for (const row of existingCacheRes.rows) {
        if (row.dom_hash && row.ai_summary) {
          domHashSummaryCache.set(row.dom_hash, {
            summary: row.ai_summary,
            description: row.ai_description || '',
            components: []
          });
        }
      }

      // Also pull cached per-component descriptions so a domHash cache hit can replay
      // element-level AI descriptions too, not just the page-level summary.
      if (domHashSummaryCache.size > 0) {
        const existingComponentsRes = await query(
          `SELECT p.dom_hash, u.selector, u.ai_description
           FROM ui_elements u
           JOIN pages p ON p.id = u.page_id
           WHERE p.project_id = $1 AND u.ai_description IS NOT NULL`,
          [projectId]
        );
        for (const row of existingComponentsRes.rows) {
          const cached = domHashSummaryCache.get(row.dom_hash);
          if (cached && row.selector && row.ai_description) {
            cached.components.push({ selector: row.selector, description: row.ai_description });
          }
        }
        console.log(`[KnowledgeBuilder] Reusing ${domHashSummaryCache.size} existing cached summaries from previous crawl.`);
      }
    } catch (e) {
      // Non-fatal cache lookup failure
    }

    // 1. Insert/Update Pages
    const pagesList: Page[] = [];
    const elementsList: UiElement[] = [];
    const pageElementsMap = new Map<string, UiElement[]>();

    // Clean old elements for the project (handled by cascades in pages)
    await query(`DELETE FROM pages WHERE project_id = $1`, [projectId]);

    // Clear the previous crawl's graph up front so incremental page/component writes
    // below build a fresh graph instead of layering on top of stale nodes.
    await GraphProjection.clearProject(projectId);

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
      pageElementsMap.set(dbPageId, pageElements);

      // Write the structural Page/Component nodes to Neo4j as soon as they're known,
      // rather than waiting for AI enrichment + graph projection to finish. AI fields
      // are added below via further upsertPage/upsertComponent calls once available.
      await GraphProjection.upsertPage(projectId, pageRecord);
      for (const elementRecord of pageElements) {
        await GraphProjection.upsertComponent(projectId, dbPageId, elementRecord);
      }
    }

    // AI Page Enrichment with DOM-hash deduplication and concurrency pool
    if (AI_SUMMARIZATION_ENABLED) {
      // Group pages by domHash to only call LLM once per unique DOM state
      const pagesToSummarize: Array<{
        pageRecord: Page;
        rawPage: (typeof rawPages)[0];
        pageElements: UiElement[];
      }> = [];

      for (let i = 0; i < rawPages.length; i++) {
        const rawPage = rawPages[i];
        const pageRecord = pagesList[i];
        const pageElements = pageElementsMap.get(pageRecord.id!) || [];

        // Check if we already have a cached summary for this domHash
        const cached = domHashSummaryCache.get(rawPage.domHash);
        if (cached) {
          console.log(`[KnowledgeBuilder] Reusing cached AI summary for DOM hash: ${rawPage.domHash} (${rawPage.url})`);
          pageRecord.aiSummary = cached.summary;
          pageRecord.aiDescription = cached.description;
          await query(
            `UPDATE pages SET ai_summary = $1, ai_description = $2 WHERE id = $3`,
            [cached.summary, cached.description, pageRecord.id]
          );
          await GraphProjection.upsertPage(projectId, pageRecord);

          // Replay cached per-component descriptions too, so a cache hit doesn't leave
          // this page's UI elements without AI descriptions.
          for (const comp of cached.components) {
            const matchedEl = pageElements.find(e => e.selector === comp.selector);
            if (matchedEl) {
              matchedEl.aiDescription = comp.description;
              await query(
                `UPDATE ui_elements SET ai_description = $1 WHERE id = $2`,
                [comp.description, matchedEl.id]
              );
              await GraphProjection.upsertComponent(projectId, pageRecord.id!, matchedEl);
            }
          }
        } else if (rawPage.html) {
          pagesToSummarize.push({ pageRecord, rawPage, pageElements });
        }
      }

      // Concurrently summarize distinct pages
      console.log(`[KnowledgeBuilder] Running page summarization for ${pagesToSummarize.length} pages (concurrency: ${AI_CONCURRENCY})...`);
      await runWithConcurrency(pagesToSummarize, AI_CONCURRENCY, async ({ pageRecord, rawPage, pageElements }) => {
        try {
          // Double-check cache in case an earlier page in this batch already resolved this domHash
          const cached = domHashSummaryCache.get(rawPage.domHash);
          let aiResult: PageSummaryResult | null = null;

          if (cached) {
            aiResult = {
              summary: cached.summary,
              description: cached.description,
              components: cached.components
            };
          } else {
            aiResult = await PageSummarizer.summarize({
              title: rawPage.title,
              breadcrumb: rawPage.breadcrumb,
              html: rawPage.html || '',
              elements: pageElements
            });

            if (aiResult) {
              domHashSummaryCache.set(rawPage.domHash, {
                summary: aiResult.summary,
                description: aiResult.description,
                components: aiResult.components.map(c => ({ selector: c.selector, description: c.description }))
              });
            }
          }

          if (aiResult) {
            pageRecord.aiSummary = aiResult.summary;
            pageRecord.aiDescription = aiResult.description;
            await query(
              `UPDATE pages SET ai_summary = $1, ai_description = $2 WHERE id = $3`,
              [aiResult.summary, aiResult.description, pageRecord.id]
            );
            // Push this page's AI summary into the graph as soon as it's ready, rather
            // than waiting for every other page in the batch plus knowledge extraction.
            await GraphProjection.upsertPage(projectId, pageRecord);

            for (const comp of aiResult.components) {
              const matchedEl = pageElements.find(e => e.selector === comp.selector);
              if (matchedEl) {
                matchedEl.aiDescription = comp.description;
                await query(
                  `UPDATE ui_elements SET ai_description = $1 WHERE id = $2`,
                  [comp.description, matchedEl.id]
                );
                await GraphProjection.upsertComponent(projectId, pageRecord.id!, matchedEl);
              }
            }
          }
        } catch (err: any) {
          console.warn(`[KnowledgeBuilder] AI summarization failed for page ${rawPage.url}: ${err?.message || err}`);
        }
      });
    }

    // 2. Resolve Page parent-child relations.
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

    // 3. AI knowledge extraction: entities, actions, relationships, and workflows
    const savedEntities: Entity[] = [];
    const savedActions: Action[] = [];
    const savedRelationships: Relationship[] = [];
    const savedWorkflows: Workflow[] = [];
    const savedSteps: WorkflowStep[] = [];
    const workflowSummaryList: Array<{ name: string; confidence: number; flowEntities: string[] }> = [];

    await query(`DELETE FROM entities WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM workflows WHERE project_id = $1`, [projectId]);

    // Always synthesize one TOUR workflow covering every crawled page, independent of
    // whether AI entity/action extraction below finds any real (EXTRACTED) workflows --
    // that extraction is CRUD-tuned and routinely finds none for marketing/docs sites,
    // which today left those projects with nothing recordable at all. Deliberately kept
    // out of savedWorkflows/workflowSummaryList/GraphProjection: those feed the
    // AI-facing business-flow summary and knowledge graph, where a page tour is noise,
    // not a business workflow.
    const tourPages = pagesList.slice(0, MAX_TOUR_PAGES);
    if (pagesList.length > MAX_TOUR_PAGES) {
      console.warn(`[KnowledgeBuilder] Project ${projectId} has ${pagesList.length} pages -- capping Full Site Tour at ${MAX_TOUR_PAGES}.`);
    }
    if (tourPages.length > 0) {
      const tourWorkflowId = uuidv4();
      await query(
        `INSERT INTO workflows (id, project_id, name, confidence, type)
         VALUES ($1, $2, 'Full Site Tour', 1.0, 'TOUR')`,
        [tourWorkflowId, projectId]
      );
      let tourStepNumber = 1;
      for (const page of tourPages) {
        await query(
          `INSERT INTO workflow_steps (id, workflow_id, step_number, page_id)
           VALUES ($1, $2, $3, $4)`,
          [uuidv4(), tourWorkflowId, tourStepNumber++, page.id]
        );
      }
    }

    let aiKnowledge = null;
    if (AI_SUMMARIZATION_ENABLED) {
      try {
        aiKnowledge = await KnowledgeExtractor.extract({
          pages: pagesList.map(p => ({ url: p.url, title: p.title, aiSummary: p.aiSummary })),
          elements: elementsList.map(e => ({
            pageUrl: pagesList.find(p => p.id === e.pageId)?.url || '',
            type: e.type,
            label: e.label,
            selector: e.selector,
            aiDescription: e.aiDescription,
            confidence: e.confidence
          }))
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
        const dbWfId = insertWfRes.rows[0].id;
        savedWorkflows.push({ id: dbWfId, projectId, name: wf.name, confidence: wf.confidence });

        const flowEntities: string[] = [];
        let stepNumber = 1;
        for (const step of wf.steps) {
          const stepPage = step.pageUrl ? pagesList.find(p => p.url === step.pageUrl) : undefined;
          const stepEntity = step.entityName ? findEntity(step.entityName) : undefined;
          if (stepEntity?.name) {
            flowEntities.push(stepEntity.name);
          }
          const stepAction = stepEntity && step.actionType
            ? savedActions.find(a => a.entityId === stepEntity.id && a.actionType.toLowerCase() === step.actionType!.toLowerCase())
            : undefined;

          const stepId = uuidv4();
          await query(
            `INSERT INTO workflow_steps (id, workflow_id, step_number, page_id, action_id, entity_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [stepId, dbWfId, stepNumber, stepPage?.id || null, stepAction?.id || null, stepEntity?.id || null]
          );
          savedSteps.push({
            id: stepId,
            workflowId: dbWfId,
            stepNumber: stepNumber++,
            pageId: stepPage?.id || null,
            actionId: stepAction?.id || null,
            entityId: stepEntity?.id || null
          });
        }

        workflowSummaryList.push({
          name: wf.name,
          confidence: wf.confidence,
          flowEntities
        });
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

    return {
      projectId,
      pageCount: pagesList.length,
      entities: savedEntities,
      workflows: workflowSummaryList
    };
  }
}
