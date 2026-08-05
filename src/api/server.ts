import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { closeNeo4jDriver } from '../config/neo4j';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Main entry route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Mount modular routes
app.use('/api', router);

const server = app.listen(port, () => {
  console.log(`Website Discovery & Knowledge Graph Service running on http://localhost:${port}`);
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
