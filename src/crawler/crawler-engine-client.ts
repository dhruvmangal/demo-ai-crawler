/**
 * HTTP client for the crawler-engine service (crawler-engine/), which replaced this repo's
 * old in-process `new PlaywrightCrawler().crawl(options)` call. Deliberately mirrors the
 * shape of the class it replaced -- CrawlOptions/CrawlCredentials/PlaywrightStorageState and
 * a LoginRequiredError with the same `loginUrl`/`reason` fields -- so crawl-worker.ts's
 * calling code barely changes, just the import source.
 *
 * There is no polling, no resume endpoint, and no job-tracking state here, matching
 * crawler-engine's API: POST /crawls is a single long-lived request that blocks until the
 * crawl finishes (or fails) and returns the raw pages array directly.
 */

export interface CrawlCredentials {
  username: string;
  password: string;
}

export interface PlaywrightStorageState {
  cookies?: any[];
  origins?: any[];
}

export interface CrawlOptions {
  projectId: string;
  startUrl: string;
  maxPages?: number;
  cookies?: any[];
  storageState?: PlaywrightStorageState;
  storageStatePath?: string;
  connectCdpUrl?: string;
  credentials?: CrawlCredentials;
  autoRegister?: boolean;
}

/**
 * Thrown when crawler-engine reports a login wall it couldn't get past (its 422
 * `{ error: 'LOGIN_REQUIRED', ... }` response) -- same name/shape as the old in-process
 * LoginRequiredError so crawl-worker.ts's `err instanceof LoginRequiredError` check and
 * AWAITING_CREDENTIALS handling keep working unchanged.
 */
export class LoginRequiredError extends Error {
  constructor(public loginUrl: string, public reason: 'no_credentials' | 'invalid_credentials' | 'sso_only') {
    super(
      reason === 'invalid_credentials'
        ? 'Login failed with the provided credentials.'
        : reason === 'sso_only'
        ? 'This page only offers third-party SSO sign-in, which cannot be automated with a username/password.'
        : 'This page requires login to proceed.'
    );
    this.name = 'LoginRequiredError';
  }
}

const ENGINE_URL = process.env.CRAWLER_ENGINE_URL || 'http://localhost:3010';
// Crawls can legitimately run for minutes (many pages x state-space exploration x login
// flow) -- default fetch/HTTP timeouts would truncate a perfectly healthy crawl out from
// under the worker. Generous but finite, so a wedged/unreachable engine still resolves to
// FAILED instead of hanging the poll loop forever (Phase 1 pass criteria: killing
// crawler-engine mid-crawl must end the job FAILED, not hang).
const TIMEOUT_MS = Number(process.env.CRAWLER_ENGINE_TIMEOUT_MS) || 10 * 60 * 1000;

export async function crawl(options: CrawlOptions): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${ENGINE_URL}/crawls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`crawler-engine request timed out after ${TIMEOUT_MS}ms`);
    }
    throw new Error(`crawler-engine is unreachable at ${ENGINE_URL}: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 422) {
    const body = await response.json().catch(() => ({}) as any);
    if (body?.error === 'LOGIN_REQUIRED') {
      throw new LoginRequiredError(body.loginUrl, body.reason);
    }
    throw new Error(body?.error || `crawler-engine responded 422`);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as any);
    throw new Error(body?.error || `crawler-engine responded ${response.status}`);
  }

  return response.json();
}
