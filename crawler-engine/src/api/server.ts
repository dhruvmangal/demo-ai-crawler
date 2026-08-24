import express, { Request, Response, NextFunction } from 'express';
import { PlaywrightCrawler, LoginRequiredError, CrawlOptions } from '../crawler/playwright-crawler';

const PORT = Number(process.env.PORT) || 3010;

const app = express();
app.use(express.json({ limit: '5mb' }));

/**
 * POST /crawls -- long-lived, synchronous: blocks until the crawl finishes and returns the
 * raw pages array directly, exactly like the in-process `await new PlaywrightCrawler().crawl(options)`
 * call this replaces in crawl-worker.ts. There is deliberately no job-tracking state, no
 * GET /crawls/:id polling, and no resume endpoint here -- crawl-worker.ts owns the Postgres
 * job queue and today's actual behavior (see crawl-worker.ts / routes.ts) never resumes a
 * crawl mid-flight; a submitted credential just re-queues the job to run crawl() again from
 * startUrl. Adding async job semantics here would be scope creep past "move the code, keep
 * the behavior."
 */
app.post('/crawls', async (req: Request, res: Response) => {
  const options = req.body as CrawlOptions;

  if (!options || typeof options.startUrl !== 'string' || typeof options.projectId !== 'string') {
    res.status(400).json({ error: 'projectId and startUrl are required.' });
    return;
  }

  try {
    const crawler = new PlaywrightCrawler();
    const pages = await crawler.crawl(options);
    res.status(200).json(pages);
  } catch (err: any) {
    if (err instanceof LoginRequiredError) {
      // Distinguishable shape so crawl-worker.ts can reconstruct its existing
      // AWAITING_CREDENTIALS handling without importing this service's error class.
      res.status(422).json({ error: 'LOGIN_REQUIRED', loginUrl: err.loginUrl, reason: err.reason, message: err.message });
      return;
    }
    console.error('[crawler-engine] Crawl failed:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[crawler-engine] Unhandled error:', err);
  res.status(500).json({ error: err?.message || 'Internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`[crawler-engine] Listening on port ${PORT}`);
});

// Crawls can legitimately run for minutes (many pages x state-space exploration x login
// flow) -- Node's default 2-minute keep-alive/header timeouts would otherwise truncate a
// perfectly healthy long crawl out from under crawl-worker.ts. 0 disables the timeout;
// crawl-worker.ts's own HTTP client timeout (CRAWLER_ENGINE_TIMEOUT_MS) is the real bound.
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
