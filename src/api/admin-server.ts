import express from 'express';
import cors from 'cors';
import path from 'path';
import { adminRouter } from './admin-routes';
import { graphRouter } from './graph-routes';
import { workflowRunRouter } from './workflow-run-routes';
import { closeNeo4jDriver } from '../config/neo4j';

/**
 * Standalone server for the admin backoffice, kept off the main crawler-app process/port
 * on purpose: admin-routes.ts has no auth and exposes every crawl's data (see
 * admin-routes.ts's header comment), so it gets its own container and port rather than
 * riding on the publicly-reachable API in server.ts.
 *
 * public/admin/admin.js only ever calls relative paths (/api/admin/*, /api/graph/*,
 * POST /api/workflows/:id/run, /recordings/*), so it needs zero changes to run against
 * this server instead of crawler-app -- everything it depends on is mounted here at the
 * same paths. /api/graph and /api/workflows/:id/run are also mounted in crawler-app's
 * routes.ts (they're general API endpoints, not admin-only); the handlers are shared via
 * graph-routes.ts / workflow-run-routes.ts to avoid duplicating the Neo4j/DB logic.
 */

const app = express();
const port = process.env.ADMIN_PORT || process.env.PORT || 3001;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', '..', 'recordings');
// Static assets live outside dist/ (tsc only emits .js), so resolve from the project root.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Workflow recording videos/captions, shared with crawler-app via the `recordings` volume.
app.use('/recordings', express.static(RECORDINGS_DIR));

app.use('/api/admin', adminRouter);
app.use('/api/graph', graphRouter);
app.use('/api/workflows', workflowRunRouter);

// Admin backoffice: a static page that drives /api/admin/*, /api/graph/* and /recordings/*.
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));

const server = app.listen(port, () => {
  console.log(`Admin backoffice running on http://localhost:${port}/admin`);
});

// Graceful Shutdown
const shutdown = async () => {
  console.log('Shutting down admin server...');
  server.close(async () => {
    await closeNeo4jDriver();
    console.log('Admin server and Neo4j connections terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
export default app;
