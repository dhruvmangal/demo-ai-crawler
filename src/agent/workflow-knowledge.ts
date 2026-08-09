import { query } from '../config/database';
import { WorkflowKnowledgeStep } from '../types/workflow-scripts';

/**
 * Gathers everything the planner/generator pipeline needs to know about a workflow:
 * its ordered steps, each step's page/action/entity context, and -- unlike the old
 * per-run replay query it replaces -- every ui_elements row for that step's page, not
 * just the one selector attached to the matched action. actions.selector resolves to
 * one selector per (entity, actionType) globally, not per page, so it's kept only as
 * a hint alongside the page's full element vocabulary.
 */
export class WorkflowKnowledge {
  public static async gather(workflowId: string): Promise<WorkflowKnowledgeStep[]> {
    const res = await query(
      `SELECT ws.step_number   AS "stepNumber",
              p.id              AS "pageId",
              p.url             AS "pageUrl",
              p.title           AS "pageTitle",
              p.ai_summary      AS "pageAiSummary",
              p.ai_description  AS "pageAiDescription",
              a.action_type     AS "actionType",
              a.selector        AS "actionSelectorHint",
              e.name            AS "entityName",
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'id', u.id, 'type', u.type, 'label', u.label,
                    'selector', u.selector, 'role', u.role, 'aiDescription', u.ai_description
                  ) ORDER BY u.confidence DESC)
                 FROM ui_elements u WHERE u.page_id = p.id),
                '[]'
              ) AS "pageElements"
       FROM workflow_steps ws
       LEFT JOIN pages p ON p.id = ws.page_id
       LEFT JOIN actions a ON a.id = ws.action_id
       LEFT JOIN entities e ON e.id = ws.entity_id
       WHERE ws.workflow_id = $1
       ORDER BY ws.step_number ASC`,
      [workflowId]
    );

    const steps: WorkflowKnowledgeStep[] = res.rows;
    if (steps.length === 0) {
      throw new Error('Workflow has no steps to record.');
    }
    return steps;
  }
}
