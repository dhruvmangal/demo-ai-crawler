import { mockServer } from './mock-crm-server';
import { crawl as crawlViaEngine } from './crawler/crawler-engine-client';
import { KnowledgeBuilder } from './knowledge/knowledge-builder';
import { KnowledgeSummarizer } from './knowledge/knowledge-summarizer';
import { query } from './config/database';
import { closeNeo4jDriver } from './config/neo4j';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

async function runTest() {
  console.log('--- STARTING KNOWLEDGE GRAPH CRAWLER TEST ---');

  const projectId = uuidv4();
  // crawler-engine now runs in its own container, so the mock CRM this process starts
  // (below, on :4000) has to be reachable at the docker-network hostname, not localhost --
  // same hostname the Makefile's `crawl-mock` target already uses for the job-queue path.
  const startUrl = `http://${process.env.MOCK_CRM_HOST || 'localhost'}:4000/dashboard`;

  try {
    // 1. Initialize Postgres Tables
    console.log('Initializing Postgres Schema...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../init.sql'), 'utf-8');
    await query(schemaSql);
    console.log('Postgres Schema Initialized.');

    // 2. Execute a crawl against the local mock app, via crawler-engine over HTTP --
    // this used to be an in-process `new PlaywrightCrawler().crawl()` call; verifying it
    // now exercises the same HTTP path crawl-worker.ts uses, not the old in-process one.
    const rawPages = await crawlViaEngine({
      projectId,
      startUrl,
      maxPages: 10
    });

    console.log(`Discovered ${rawPages.length} pages.`);

    // 3. Build relational and Neo4j knowledge
    const builtKnowledge = await KnowledgeBuilder.build(projectId, rawPages);

    // 4. Summarize knowledge domain
    const summary = await KnowledgeSummarizer.summarize(projectId, builtKnowledge);
    console.log('\n--- KNOWLEDGE SUMMARY RESULT ---');
    console.log(JSON.stringify(summary, null, 2));

    // 5. Generate and verify output schema for each page
    console.log('\n--- OUTPUT PAGES SCHEMA VERIFICATION ---');
    const finalPagesOutput: any[] = [];

    // Query elements, actions, relationships back from Postgres to verify persistence
    const pagesRes = await query(
      `SELECT id, title, url, parent_page_id, via_label, via_selector FROM pages WHERE project_id = $1`,
      [projectId]
    );
    const pageIdToUrl = new Map(pagesRes.rows.map((p: any) => [p.id, p.url]));

    for (const page of pagesRes.rows) {
      // Get actions
      const elementsRes = await query(
        `SELECT type, label, selector FROM ui_elements WHERE page_id = $1`,
        [page.id]
      );
      
      const buttons = elementsRes.rows.filter(r => r.type === 'button').map(r => r.label);
      const forms = elementsRes.rows.filter(r => r.type === 'form').map(r => r.label);
      const tables = elementsRes.rows.filter(r => r.type === 'table').map(r => r.label);

      // Get page relationships
      const relsRes = await query(
        `SELECT e1.name as source, e2.name as target, r.relationship_type
         FROM relationships r
         JOIN entities e1 ON e1.id = r.source_entity_id
         JOIN entities e2 ON e2.id = r.target_entity_id
         WHERE e1.project_id = $1`,
        [projectId]
      );

      const relationships = relsRes.rows.map(r => `${r.source} -> ${r.target}`);

      const pageOutput = {
        page: page.title,
        url: page.url,
        reachedFrom: page.parent_page_id ? pageIdToUrl.get(page.parent_page_id) : null,
        navigateVia: page.via_label ? { label: page.via_label, selector: page.via_selector } : null,
        actions: buttons,
        forms,
        tables,
        relationships: Array.from(new Set(relationships)) // unique relationships
      };

      finalPagesOutput.push(pageOutput);
    }

    console.log(JSON.stringify(finalPagesOutput, null, 2));

    // Save outputs to file
    fs.writeFileSync(
      path.join(__dirname, '../output_schema.json'),
      JSON.stringify(finalPagesOutput, null, 2)
    );
    console.log(`\nSaved output pages schema to: ${path.join(__dirname, '../output_schema.json')}`);

  } catch (err) {
    console.error('Test run failed:', err);
  } finally {
    console.log('Shutting down servers...');
    mockServer.close();
    await closeNeo4jDriver();
    console.log('Test completed.');
    process.exit(0);
  }
}

runTest();
