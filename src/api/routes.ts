import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { getNeo4jDriver } from '../config/neo4j';
import { v4 as uuidv4 } from 'uuid';

export const router = Router();

/**
 * POST /api/crawl
 * Triggers a website discovery crawl.
 */
router.post('/crawl', async (req: Request, res: Response) => {
  const { targetUrl, projectId } = req.body;

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl is required' });
  }

  const projId = projectId || uuidv4();

  try {
    const jobRes = await query(
      `INSERT INTO crawl_jobs (project_id, target_url, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id, project_id, target_url, status, created_at`,
      [projId, targetUrl]
    );

    return res.status(201).json({
      message: 'Crawl job queued successfully',
      job: jobRes.rows[0]
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/crawl/:id
 * Fetches status of a crawl job.
 */
router.get('/crawl/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const jobRes = await query(
      `SELECT id, project_id, target_url, status, started_at, completed_at, error_message
       FROM crawl_jobs WHERE id = $1`,
      [id]
    );

    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    return res.json(jobRes.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/graph/:projectId
 * Returns Neo4j nodes and edges projection for visualization.
 */
router.get('/graph/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const driver = getNeo4jDriver();
  const session = driver.session();

  try {
    // Retrieve pages, actions, workflows, entities and their relationships
    const result = await session.run(
      `MATCH (n) WHERE n.projectId = $projectId
       OPTIONAL MATCH (n)-[r]->(m)
       RETURN n, r, m`,
      { projectId }
    );

    const nodes = new Map<string, any>();
    const edges: any[] = [];

    result.records.forEach(record => {
      const nodeA = record.get('n');
      const edge = record.get('r');
      const nodeB = record.get('m');

      if (nodeA) {
        nodes.set(nodeA.properties.id || nodeA.elementId, {
          labels: nodeA.labels,
          properties: nodeA.properties
        });
      }
      if (nodeB) {
        nodes.set(nodeB.properties.id || nodeB.elementId, {
          labels: nodeB.labels,
          properties: nodeB.properties
        });
      }
      if (edge) {
        edges.push({
          type: edge.type,
          source: edge.startNodeId || nodeA.properties.id || nodeA.elementId,
          target: edge.endNodeId || nodeB.properties.id || nodeB.elementId,
          properties: edge.properties
        });
      }
    });

    return res.json({
      nodes: Array.from(nodes.values()),
      edges
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  } finally {
    await session.close();
  }
});

/**
 * GET /api/summary/:projectId
 * Returns high-level domain summary to save AI token usage.
 */
router.get('/summary/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const summaryRes = await query(
      `SELECT domain, summary_data, created_at FROM knowledge_summaries WHERE project_id = $1`,
      [projectId]
    );

    if (summaryRes.rowCount === 0) {
      return res.status(404).json({ error: 'Summary not found for this project' });
    }

    return res.json(summaryRes.rows[0]);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
