import { query } from '../config/database';
import { PlaywrightCrawler, LoginRequiredError, CrawlCredentials } from '../crawler/playwright-crawler';
import { KnowledgeBuilder } from '../knowledge/knowledge-builder';
import { KnowledgeSummarizer } from '../knowledge/knowledge-summarizer';

const POLL_INTERVAL_MS = 5000;

async function processNextJob() {
  // 1. Fetch next pending job
  const selectRes = await query(
    `UPDATE crawl_jobs
     SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM crawl_jobs
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, project_id, target_url`
  );

  if (selectRes.rowCount === 0) {
    return; // No jobs pending
  }

  const job = selectRes.rows[0];
  console.log(`[Crawl Worker] Processing Job ${job.id} for Project ${job.project_id} (Target: ${job.target_url})`);

  // Consume any credentials submitted for this job (one-time use: delete immediately, before
  // even attempting login, so they never linger regardless of how the crawl turns out).
  let credentials: CrawlCredentials | undefined;
  const credRes = await query(
    `SELECT username, password FROM crawl_credentials WHERE crawl_job_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [job.id]
  );
  if ((credRes.rowCount ?? 0) > 0) {
    credentials = { username: credRes.rows[0].username, password: credRes.rows[0].password };
    await query(`DELETE FROM crawl_credentials WHERE crawl_job_id = $1`, [job.id]);
  }

  try {
    const crawler = new PlaywrightCrawler();
    const rawPages = await crawler.crawl({
      projectId: job.project_id,
      startUrl: job.target_url,
      maxPages: 10,
      credentials
    });

    // Save outputs using KnowledgeBuilder (inserts SQL, pushes to Neo4j)
    await KnowledgeBuilder.build(job.project_id, rawPages);

    // Generate high-level lightweight summary
    await KnowledgeSummarizer.summarize(job.project_id);

    // Update job status to COMPLETED
    await query(
      `UPDATE crawl_jobs
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [job.id]
    );
    console.log(`[Crawl Worker] Job ${job.id} successfully finished!`);

  } catch (err: any) {
    if (err instanceof LoginRequiredError) {
      // Pause, don't fail: the caller can submit credentials via
      // POST /api/crawl/:id/credentials, which flips status back to PENDING for us to retry.
      await query(
        `UPDATE crawl_jobs
         SET status = 'AWAITING_CREDENTIALS', login_url = $1, error_message = $2
         WHERE id = $3`,
        [err.loginUrl, err.message, job.id]
      );
      console.log(`[Crawl Worker] Job ${job.id} awaiting credentials (${err.reason}) at ${err.loginUrl}`);
      return;
    }

    console.error(`[Crawl Worker] Job ${job.id} failed:`, err);
    await query(
      `UPDATE crawl_jobs
       SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = $1
       WHERE id = $2`,
      [err?.message || String(err), job.id]
    );
  }
}

async function run() {
  console.log('[Crawl Worker] Starting background worker polling loop...');
  while (true) {
    try {
      await processNextJob();
    } catch (e) {
      console.error('[Crawl Worker] Polling error:', e);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

run();
