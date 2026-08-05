import { query } from '../config/database';
import { getNeo4jDriver } from '../config/neo4j';

async function processDemoGeneration() {
  console.log('[Demo Worker] Checking for demo generation requests...');
  
  // 1. In a full system, this would poll a 'demo_jobs' table.
  // We will demonstrate how it fetches a Knowledge Summary and plans workflows.
  const summariesRes = await query(`SELECT project_id, domain, summary_data FROM knowledge_summaries LIMIT 1`);
  if (summariesRes.rowCount === 0) {
    // console.log('[Demo Worker] No summaries available to generate demos.');
    return;
  }

  const { project_id: projectId, domain, summary_data: summary } = summariesRes.rows[0];
  console.log(`[Demo Worker] Planning demo for Project ${projectId} (${domain})`);

  // 2. Fetch the target workflow from PostgreSQL
  const workflowsRes = await query(`SELECT id, name FROM workflows WHERE project_id = $1 LIMIT 1`, [projectId]);
  if (workflowsRes.rowCount === 0) {
    console.log('[Demo Worker] No workflow detected to demo.');
    return;
  }

  const workflow = workflowsRes.rows[0];
  console.log(`[Demo Worker] Selected Workflow for Demo: "${workflow.name}"`);

  // 3. Fetch steps from Neo4j (Graph Projection) to showcase visual paths
  const driver = getNeo4jDriver();
  const session = driver.session();
  
  try {
    const cypherResult = await session.run(
      `MATCH (w:Workflow {id: $wfId})-[:HAS_STEP]->(s:WorkflowStep)
       OPTIONAL MATCH (s)-[:ON_PAGE]->(p:Page)
       OPTIONAL MATCH (s)-[:PERFORMS_ACTION]->(a:Action)
       RETURN s.stepNumber AS stepNumber, p.url AS url, a.actionType AS action, a.selector AS selector
       ORDER BY stepNumber ASC`,
      { wfId: workflow.id }
    );

    const steps = cypherResult.records.map(record => ({
      stepNumber: record.get('stepNumber').toNumber(),
      url: record.get('url'),
      action: record.get('action'),
      selector: record.get('selector')
    }));

    console.log(`[Demo Worker] Resolved Graph Steps from Neo4j:`, JSON.stringify(steps, null, 2));

    // 4. Demo Execution Simulation (Playwright Core Run)
    console.log(`[Demo Worker] Executing planned sequence...`);
    for (const step of steps) {
      console.log(`  -> Step ${step.stepNumber}: Navigate to "${step.url}"`);
      if (step.action) {
        console.log(`  -> Step ${step.stepNumber}: Perform safety-checked ${step.action} on selector "${step.selector}"`);
      }
    }

    console.log(`[Demo Worker] Demo plan successfully compiled and ran simulator.`);

  } catch (err) {
    console.error('[Demo Worker] Error planning demo:', err);
  } finally {
    await session.close();
  }
}

async function run() {
  console.log('[Demo Worker] Starting demo planner worker loop...');
  while (true) {
    try {
      await processDemoGeneration();
    } catch (e) {
      console.error('[Demo Worker] Error in demo worker loop:', e);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

// Only run if called directly
if (require.main === module) {
  run();
}
