import { Router, Request, Response } from 'express';
import { getNeo4jDriver } from '../config/neo4j';
import { asyncHandler } from '../middleware/async-handler';
import { ok } from '../utils/response-envelope';

/**
 * GET /:projectId (mounted at /api/graph in crawler-app, and again in the standalone
 * admin server so the admin backoffice's knowledge-graph tab works on its own port).
 * Returns Neo4j nodes and edges projection for visualization.
 */
export const graphRouter = Router();

graphRouter.get(
  '/:projectId',
  asyncHandler(async (req: Request, res: Response) => {
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

      return ok(res, { nodes: Array.from(nodes.values()), edges });
    } finally {
      await session.close();
    }
  })
);
