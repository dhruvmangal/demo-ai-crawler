import { sequelize } from '../config/sequelize';
import { CrawlJob, CrawlCredential, CrawlSession, ProjectCredential } from '../db/models';
import { crawl as crawlViaEngine, LoginRequiredError, CrawlCredentials, PlaywrightStorageState } from '../crawler/crawler-engine-client';
import { KnowledgeBuilder } from '../knowledge/knowledge-builder';
import { KnowledgeSummarizer } from '../knowledge/knowledge-summarizer';
import { assertSafeUrl, assertAllowedCdpUrl } from '../security/ssrf-guard';

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
async function enrichJob(job: CrawlJob, rawPages: Awaited<ReturnType<typeof crawlViaEngine>>) {
  const release = await enrichSemaphore.acquire();
  try {
    const builtKnowledge = await KnowledgeBuilder.build(job.projectId, rawPages);
    await KnowledgeSummarizer.summarize(job.projectId, builtKnowledge);

    await job.update({ status: 'COMPLETED', completedAt: new Date() });
    console.log(`[Crawl Worker] Job ${job.id} successfully finished!`);
  } catch (err: any) {
    console.error(`[Crawl Worker] Job ${job.id} enrichment failed:`, err);
    await job.update({ status: 'FAILED', completedAt: new Date(), errorMessage: err?.message || String(err) });
  } finally {
    release();
  }
}

/**
 * Atomically claims the oldest PENDING job (Sequelize's lock+skipLocked, the ORM
 * equivalent of `SELECT ... FOR UPDATE SKIP LOCKED`) so multiple worker replicas never
 * grab the same job.
 */
async function claimNextJob(): Promise<CrawlJob | null> {
  return sequelize.transaction(async t => {
    const job = await CrawlJob.findOne({
      where: { status: 'PENDING' },
      order: [['createdAt', 'ASC']],
      lock: t.LOCK.UPDATE,
      skipLocked: true,
      transaction: t
    });
    if (!job) {
      return null;
    }
    await job.update({ status: 'RUNNING', startedAt: new Date() }, { transaction: t });
    return job;
  });
}

async function processNextJob() {
  const job = await claimNextJob();
  if (!job) {
    return; // No jobs pending
  }

  console.log(`[Crawl Worker] Processing Job ${job.id} for Project ${job.projectId} (Target: ${job.targetUrl})`);

  // Consume any credentials submitted for this job (one-time use: delete immediately, before
  // even attempting login, so they never linger regardless of how the crawl turns out).
  let credentials: CrawlCredentials | undefined;
  const credRow = await CrawlCredential.findOne({ where: { crawlJobId: job.id }, order: [['createdAt', 'DESC']] });
  if (credRow) {
    credentials = { username: credRow.username, password: credRow.password };
    await CrawlCredential.destroy({ where: { crawlJobId: job.id } });
  } else {
    // No credentials submitted for this specific job -- fall back to whatever previously
    // worked for this project (see the upsert after a successful crawl below), so the
    // caller doesn't have to resubmit them on every re-crawl.
    const saved = await ProjectCredential.findOne({ where: { projectId: job.projectId } });
    if (saved) {
      credentials = { username: saved.username, password: saved.password };
    }
  }

  // Same one-time-use handling for a submitted storageState (an already-authenticated
  // session), so the crawl starts logged in instead of hitting the login wall.
  let storageState: PlaywrightStorageState | undefined;
  const sessionRow = await CrawlSession.findOne({ where: { crawlJobId: job.id }, order: [['createdAt', 'DESC']] });
  if (sessionRow) {
    storageState = sessionRow.storageState as PlaywrightStorageState;
    await CrawlSession.destroy({ where: { crawlJobId: job.id } });
  }

  try {
    // Re-checked here (defense in depth -- POST /api/crawl already checked this at
    // submission time) since target_url could in principle be re-queued without going
    // back through that endpoint (e.g. the credentials-resubmission path).
    await assertSafeUrl(job.targetUrl);
    if (job.connectCdpUrl) {
      // Same defense-in-depth reasoning: re-validated against CDP_ALLOWED_HOSTS here since
      // this is what the crawl actually connects to, not just what passed validation at
      // submission time (the allowlist could have changed since).
      assertAllowedCdpUrl(job.connectCdpUrl);
    }

    const rawPages = await crawlViaEngine({
      projectId: job.projectId,
      startUrl: job.targetUrl,
      maxPages: 10,
      credentials,
      storageState,
      autoRegister: job.autoRegister,
      connectCdpUrl: job.connectCdpUrl || undefined
    });

    // The crawl didn't throw LoginRequiredError, so if credentials were in play they worked
    // (whether submitted, reused from the vault, or just freshly auto-registered) -- save
    // them for this project so future crawls skip straight past the login wall.
    if (credentials) {
      await ProjectCredential.upsert({ projectId: job.projectId, username: credentials.username, password: credentials.password });
    }

    // Crawling is done. Hand off AI summarization/knowledge extraction/graph projection
    // to run in the background (bounded by ENRICH_CONCURRENCY) instead of awaiting it here
    // -- otherwise the next PENDING job's crawl would sit blocked behind this job's LLM calls.
    await job.update({ status: 'ENRICHING' });
    enrichJob(job, rawPages).catch(err => console.error(`[Crawl Worker] Unhandled enrichment error for job ${job.id}:`, err));

  } catch (err: any) {
    if (err instanceof LoginRequiredError) {
      // Pause, don't fail: the caller can submit credentials via
      // POST /api/crawl/:id/credentials, which flips status back to PENDING for us to retry.
      await job.update({ status: 'AWAITING_CREDENTIALS', loginUrl: err.loginUrl, errorMessage: err.message });
      console.log(`[Crawl Worker] Job ${job.id} awaiting credentials (${err.reason}) at ${err.loginUrl}`);
      return;
    }

    console.error(`[Crawl Worker] Job ${job.id} failed:`, err);
    await job.update({ status: 'FAILED', completedAt: new Date(), errorMessage: err?.message || String(err) });
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
