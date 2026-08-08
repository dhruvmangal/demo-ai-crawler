import express from 'express';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { router } from './routes';
import { adminRouter } from './admin-routes';
import { closeNeo4jDriver } from '../config/neo4j';
import openapiSpec from './openapi.json';

const app = express();
const port = process.env.PORT || 3000;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', '..', 'recordings');
// Static assets live outside dist/ (tsc only emits .js), so resolve from the project root.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

app.use(cors());
app.use(express.json());

// Workflow recording videos/captions written by workflow-agent-worker onto the shared volume.
app.use('/recordings', express.static(RECORDINGS_DIR));

// Main entry route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// Mount modular routes
app.use('/api', router);
app.use('/api/admin', adminRouter);

// Admin backoffice: a static page that drives /api/admin/*, /api/graph/* and /recordings/*.
// No auth -- it exposes every crawl's data, so keep this port off the public internet.
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));

const server = app.listen(port, () => {
  console.log(`Website Discovery & Knowledge Graph Service running on http://localhost:${port}`);
  console.log(`API docs (Swagger UI) available at http://localhost:${port}/api-docs`);
  console.log(`Admin backoffice available at http://localhost:${port}/admin`);
});

// Graceful Shutdown
const shutdown = async () => {
  console.log('Shutting down server...');
  server.close(async () => {
    await closeNeo4jDriver();
    console.log('Server and Neo4j connections terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
export default app;
