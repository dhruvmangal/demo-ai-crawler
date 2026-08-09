import { getNeo4jDriver } from '../config/neo4j';
import { Page, UiElement } from '../types/pages';
import { Entity, Action, Relationship } from '../types/entities';
import { Workflow, WorkflowStep } from '../types/workflows';

export class GraphProjection {
  /**
   * Wipes all nodes/relationships for a project. Called once, up front, so incremental
   * per-page writes made during AI enrichment (see upsertPage/upsertComponent) start from
   * a clean graph instead of layering on top of the previous crawl's stale nodes.
   */
  public static async clearProject(projectId: string): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run(
        `MATCH (n) WHERE n.projectId = $projectId DETACH DELETE n`,
        { projectId }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Upserts a single Page node. Called as soon as a page is known (structural fields)
   * and again whenever its AI summary/description resolves, so the graph reflects
   * enrichment progress instead of only appearing once the whole crawl finishes.
   * Uses its own session since callers may invoke this concurrently across pages
   * (Neo4j sessions aren't safe to share across overlapping concurrent queries).
   */
  public static async upsertPage(projectId: string, page: Page): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run(
        `MERGE (p:Page {id: $id})
         SET p.projectId = $projectId,
             p.url = $url,
             p.title = $title,
             p.breadcrumb = $breadcrumb,
             p.viaLabel = $viaLabel,
             p.viaSelector = $viaSelector,
             p.aiSummary = $aiSummary,
             p.aiDescription = $aiDescription`,
        {
          id: page.id,
          projectId,
          url: page.url,
          title: page.title,
          breadcrumb: page.breadcrumb || '',
          viaLabel: page.viaLabel || '',
          viaSelector: page.viaSelector || '',
          aiSummary: page.aiSummary || '',
          aiDescription: page.aiDescription || ''
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Upserts a single Component (UI element) node linked to its Page. Called as soon as
   * the element is discovered, and again once its AI-generated description resolves.
   */
  public static async upsertComponent(projectId: string, pageId: string, el: UiElement): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run(
        `MATCH (p:Page {id: $pageId})
         MERGE (c:Component {id: $id})
         SET c.projectId = $projectId,
             c.type = $type,
             c.label = $label,
             c.selector = $selector,
             c.aiDescription = $aiDescription
         MERGE (p)-[:HAS_COMPONENT]->(c)`,
        {
          id: el.id,
          projectId,
          pageId,
          type: el.type,
          label: el.label,
          selector: el.selector,
          aiDescription: el.aiDescription || ''
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Projects the remaining relational model (page hierarchy, entities, actions,
   * relationships, workflows) into Neo4j. Pages and Components are expected to already
   * exist via upsertPage/upsertComponent -- this only adds what depends on the
   * project-wide AI knowledge-extraction pass, which necessarily runs once at the end.
   */
  public static async project(
    projectId: string,
    data: {
      pages: Page[];
      uiElements: UiElement[];
      entities: Entity[];
      actions: Action[];
      relationships: Relationship[];
      workflows: Workflow[];
      workflowSteps: WorkflowStep[];
    }
  ): Promise<void> {
    const driver = getNeo4jDriver();
    const session = driver.session();

    try {
      // Establish Page parent-child relationships, carrying the label/selector of the
      // link or button that was clicked to navigate from parent to child (if known).
      for (const page of data.pages) {
        if (page.parentPageId) {
          await session.run(
            `MATCH (child:Page {id: $childId}), (parent:Page {id: $parentId})
             CREATE (parent)-[:HAS_PAGE {label: $label, selector: $selector}]->(child)
             CREATE (child)-[:CHILD_OF {label: $label, selector: $selector}]->(parent)`,
            {
              childId: page.id,
              parentId: page.parentPageId,
              label: page.viaLabel || '',
              selector: page.viaSelector || ''
            }
          );
        }
      }

      // 3. Insert Entities
      const entityIdMap = new Map<string, string>(); // maps Postgres entity ID to neo4j
      for (const entity of data.entities) {
        await session.run(
          `CREATE (e:Entity {
            id: $id,
            projectId: $projectId,
            name: $name,
            entityType: $entityType,
            confidence: $confidence
          })`,
          {
            id: entity.id,
            projectId,
            name: entity.name,
            entityType: entity.entityType || 'BusinessObject',
            confidence: entity.confidence
          }
        );
        entityIdMap.set(entity.id!, entity.id!);
      }

      // 4. Insert Entity-to-Entity Relationships
      for (const rel of data.relationships) {
        await session.run(
          `MATCH (source:Entity {id: $sourceId}), (target:Entity {id: $targetId})
           CREATE (source)-[:RELATED_TO {
             relationshipType: $relType,
             confidence: $confidence
           }]->(target)`,
          {
            sourceId: rel.sourceEntityId,
            targetId: rel.targetEntityId,
            relType: rel.relationshipType,
            confidence: rel.confidence
          }
        );
      }

      // 5. Insert Actions & link to Entities and Pages
      for (const action of data.actions) {
        await session.run(
          `MATCH (e:Entity {id: $entityId})
           CREATE (a:Action {
             id: $id,
             projectId: $projectId,
             actionType: $actionType,
             selector: $selector,
             confidence: $confidence
           })
           CREATE (e)-[:HAS_ACTION]->(a)`,
          {
            id: action.id,
            projectId,
            entityId: action.entityId,
            actionType: action.actionType,
            selector: action.selector || '',
            confidence: action.confidence
          }
        );
      }

      // 6. Insert Workflows & Workflow Steps
      for (const wf of data.workflows) {
        await session.run(
          `CREATE (w:Workflow {
            id: $id,
            projectId: $projectId,
            name: $name,
            confidence: $confidence
          })`,
          {
            id: wf.id,
            projectId,
            name: wf.name,
            confidence: wf.confidence
          }
        );
      }

      // Link workflow steps sequentially via NEXT_STEP
      const workflowStepsMap = new Map<string, WorkflowStep[]>();
      for (const step of data.workflowSteps) {
        if (!workflowStepsMap.has(step.workflowId)) {
          workflowStepsMap.set(step.workflowId, []);
        }
        workflowStepsMap.get(step.workflowId)!.push(step);
      }

      for (const [wfId, steps] of workflowStepsMap.entries()) {
        // Sort steps by step_number
        steps.sort((a, b) => a.stepNumber - b.stepNumber);

        for (let i = 0; i < steps.length; i++) {
          const currentStep = steps[i];
          const stepNodeId = `${wfId}_step_${currentStep.stepNumber}`;

          // Create the step node in Neo4j
          await session.run(
            `MATCH (w:Workflow {id: $wfId})
             CREATE (s:WorkflowStep {
               id: $stepNodeId,
               projectId: $projectId,
               stepNumber: $stepNumber
             })
             CREATE (w)-[:HAS_STEP]->(s)`,
            {
              wfId,
              stepNodeId,
              projectId,
              stepNumber: currentStep.stepNumber
            }
          );

          // Link step to Page, Action, and Entity if they exist
          if (currentStep.pageId) {
            await session.run(
              `MATCH (s:WorkflowStep {id: $stepNodeId}), (p:Page {id: $pageId})
               CREATE (s)-[:ON_PAGE]->(p)`,
              { stepNodeId, pageId: currentStep.pageId }
            );
          }
          if (currentStep.actionId) {
            await session.run(
              `MATCH (s:WorkflowStep {id: $stepNodeId}), (a:Action {id: $actionId})
               CREATE (s)-[:PERFORMS_ACTION]->(a)`,
              { stepNodeId, actionId: currentStep.actionId }
            );
          }
          if (currentStep.entityId) {
            await session.run(
              `MATCH (s:WorkflowStep {id: $stepNodeId}), (e:Entity {id: $entityId})
               CREATE (s)-[:TARGETS_ENTITY]->(e)`,
              { stepNodeId, entityId: currentStep.entityId }
            );
          }

          // Link to next step in workflow
          if (i > 0) {
            const prevStepNodeId = `${wfId}_step_${steps[i - 1].stepNumber}`;
            await session.run(
              `MATCH (prev:WorkflowStep {id: $prevId}), (curr:WorkflowStep {id: $currId})
               CREATE (prev)-[:NEXT_STEP]->(curr)`,
              { prevId: prevStepNodeId, currId: stepNodeId }
            );
          }
        }
      }

      console.log(`Successfully projected knowledge graph to Neo4j for project: ${projectId}`);
    } finally {
      await session.close();
    }
  }
}
