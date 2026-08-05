import { query } from '../config/database';

export class KnowledgeSummarizer {
  /**
   * Generates a high-level lightweight summary JSON of the app for future LLM prompt injections.
   */
  public static async summarize(projectId: string): Promise<any> {
    console.log(`Summarizing knowledge for project: ${projectId}`);

    // 1. Fetch pages count
    const pagesRes = await query(`SELECT COUNT(*) FROM pages WHERE project_id = $1`, [projectId]);
    const pageCount = parseInt(pagesRes.rows[0].count, 10);

    // 2. Fetch all entities
    const entitiesRes = await query(
      `SELECT name, entity_type, confidence FROM entities WHERE project_id = $1 ORDER BY confidence DESC`,
      [projectId]
    );
    const entities = entitiesRes.rows.map(r => ({
      name: r.name,
      type: r.entity_type,
      confidence: r.confidence
    }));

    // 3. Fetch workflows and steps
    const workflowsRes = await query(
      `SELECT w.id, w.name, w.confidence, array_agg(e.name ORDER BY ws.step_number) as flow_entities
       FROM workflows w
       LEFT JOIN workflow_steps ws ON ws.workflow_id = w.id
       LEFT JOIN entities e ON e.id = ws.entity_id
       WHERE w.project_id = $1
       GROUP BY w.id, w.name, w.confidence`,
      [projectId]
    );

    const workflows = workflowsRes.rows.map(w => {
      const path = (w.flow_entities || []).filter(Boolean).join(' -> ');
      return {
        name: w.name,
        confidence: w.confidence,
        flowPattern: path || 'Undefined Flow'
      };
    });

    // 4. Infer Domain based on entities detected
    let domain = 'Generic Dashboard';
    const entityNames = entities.map(e => e.name.toLowerCase());
    
    if (entityNames.includes('customer') || entityNames.includes('lead') || entityNames.includes('opportunity')) {
      domain = 'Customer Relationship Management (CRM)';
    } else if (entityNames.includes('order') || entityNames.includes('product') || entityNames.includes('cart')) {
      domain = 'E-commerce Admin Panel';
    } else if (entityNames.includes('invoice') || entityNames.includes('payment') || entityNames.includes('billing')) {
      domain = 'Billing / Financial Dashboard';
    } else if (entityNames.includes('analytics') || entityNames.includes('metric') || entityNames.includes('report')) {
      domain = 'Analytics Platform';
    }

    const summaryData = {
      domain,
      discoveredPagesCount: pageCount,
      mainEntities: entities.slice(0, 10).map(e => e.name),
      mainWorkflows: workflows,
      timestamp: new Date().toISOString()
    };

    // Save summary permanently to DB
    await query(
      `INSERT INTO knowledge_summaries (project_id, domain, summary_data)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id) DO UPDATE
       SET domain = EXCLUDED.domain,
           summary_data = EXCLUDED.summary_data,
           created_at = CURRENT_TIMESTAMP`,
      [projectId, domain, JSON.stringify(summaryData)]
    );

    console.log(`Knowledge Summary stored successfully for project: ${projectId}`);
    return summaryData;
  }
}
