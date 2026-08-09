import { query } from '../config/database';
import { PlaywrightCrawler, LoginRequiredError, CrawlCredentials } from '../crawler/playwright-crawler';
import { KnowledgeBuilder } from '../knowledge/knowledge-builder';
import { KnowledgeSummarizer } from '../knowledge/knowledge-summarizer';

const POLL_INTERVAL_MS = 5000;

// Bounds how many jobs' AI summarization/graph-projection phases run at once. Crawling
// itself is cheap and I/O bound; the LLM phase is what's slow, so it's capped and run
// off the polling loop instead of blocking the next job's crawl from starting.
const ENRICH_CONCURRENCY = Math.max(1, Number(process.env.ENRICH_CONCURRENCY) || 2);

class AsyncSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(count: number) {
    this.available = count;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    return new Promise(resolve => {
      this.waiters.push(() => {
        this.available--;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.available++;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const enrichSemaphore = new AsyncSemaphore(ENRICH_CONCURRENCY);

/**
 * Runs AI summarization, knowledge extraction, and graph projection for an already-crawled
 * job. Deliberately not awaited by the polling loop -- the next PENDING job's crawl should
 * be able to start as soon as this job's crawl finishes, without waiting on the LLM.
 */
async function enrichJob(job: { id: string; project_id: string }, rawPages: Awaited<ReturnType<PlaywrightCrawler['crawl']>>) {
  const release = await enrichSemaphore.acquire();
  try {
    const builtKnowledge = await KnowledgeBuilder.build(job.project_id, rawPages);
    await KnowledgeSummarizer.summarize(job.project_id, builtKnowledge);

    await query(
      `UPDATE crawl_jobs
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [job.id]
    );
    console.log(`[Crawl Worker] Job ${job.id} successfully finished!`);
  } catch (err: any) {
    console.error(`[Crawl Worker] Job ${job.id} enrichment failed:`, err);
    await query(
      `UPDATE crawl_jobs
       SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP, error_message = $1
       WHERE id = $2`,
      [err?.message || String(err), job.id]
    );
  } finally {
    release();
  }
}

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

    // Crawling is done. Hand off AI summarization/knowledge extraction/graph projection
    // to run in the background (bounded by ENRICH_CONCURRENCY) instead of awaiting it here
    // -- otherwise the next PENDING job's crawl would sit blocked behind this job's LLM calls.
    await query(`UPDATE crawl_jobs SET status = 'ENRICHING' WHERE id = $1`, [job.id]);
    enrichJob(job, rawPages).catch(err => console.error(`[Crawl Worker] Unhandled enrichment error for job ${job.id}:`, err));

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
