import dns from 'dns';
import ipaddr from 'ipaddr.js';
import { env } from '../config/env';
import { BadRequestError } from '../errors/api-error';

export class SsrfBlockedError extends BadRequestError {
  constructor(message: string) {
    super(message);
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Small in-process cache so a single page's 50+ same-origin subresource requests don't
// each pay a fresh DNS lookup -- see the callers in playwright-crawler.ts/workflow-recorder.ts.
const RESOLUTION_CACHE_TTL_MS = 60 * 1000;
const resolutionCache = new Map<string, { safe: boolean; expiresAt: number }>();

function isPublicUnicast(ip: string): boolean {
  try {
    // 'unicast' is the only range that means "ordinary public internet address" -- this
    // rejects private (10/8, 192.168/16...), loopback (127/8, ::1), link-local
    // (169.254/16 -- includes the cloud metadata endpoint 169.254.169.254 -- and IPv6
    // fe80::/10), multicast, and other reserved ranges for both IPv4 and IPv6.
    return ipaddr.process(ip).range() === 'unicast';
  } catch {
    return false;
  }
}

/**
 * Resolves every A/AAAA record for `hostname` and rejects if ANY of them is
 * private/loopback/link-local/reserved -- not just the first one. Cached briefly per
 * hostname. Set ALLOW_PRIVATE_CRAWL_TARGETS=true (dev-only) to disable this check
 * entirely, e.g. for src/mock-crm-server.ts / other localhost dev targets.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  if (env.allowPrivateCrawlTargets) {
    return;
  }

  const cached = resolutionCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.safe) {
      throw new SsrfBlockedError(`Refusing to crawl "${hostname}": resolves to a non-public address.`);
    }
    return;
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    resolutionCache.set(hostname, { safe: false, expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS });
    throw new SsrfBlockedError(`Refusing to crawl "${hostname}": could not resolve.`);
  }

  const safe = records.length > 0 && records.every(r => isPublicUnicast(r.address));
  resolutionCache.set(hostname, { safe, expiresAt: Date.now() + RESOLUTION_CACHE_TTL_MS });

  if (!safe) {
    throw new SsrfBlockedError(`Refusing to crawl "${hostname}": resolves to a non-public address.`);
  }
}

/**
 * Full validation of a crawl target URL: scheme, no embedded credentials, and DNS
 * resolution to a public address. Call at every navigation chokepoint (see
 * src/crawler/playwright-crawler.ts and src/recorder/workflow-recorder.ts) -- a single
 * check at submission time is not enough, since a redirect can land somewhere else
 * entirely after the initial check passes.
 */
export async function assertSafeUrl(urlStr: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: "${urlStr}"`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfBlockedError(`Refusing to crawl "${urlStr}": only http/https URLs are allowed.`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError(`Refusing to crawl "${urlStr}": URLs with embedded credentials are not allowed.`);
  }

  await assertPublicHostname(url.hostname);
}

/** Non-throwing check, for filtering candidate links rather than hard-failing a whole crawl. */
export async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    await assertSafeUrl(urlStr);
    return true;
  } catch {
    return false;
  }
}

/**
 * For use with Playwright's context.route('**\/*', ...) request interception -- the actual
 * SSRF enforcement point, since it sees every request a browser context makes (including
 * ones a redirect lands on, which a one-time pre-navigation check never would). Only
 * http(s) requests are DNS-checked; data:/blob:/about:/chrome-extension: etc. never hit
 * the network in a way that matters for SSRF, and blocking them would break normal page
 * rendering (inline images, etc).
 */
export async function isRequestAllowed(urlStr: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return true;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return true;
  }
  return isSafeUrl(urlStr);
}
