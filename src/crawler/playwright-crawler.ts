import { chromium, Browser, Page as PlaywrightPage } from 'playwright';
import { PageDiscovery } from '../discovery/page-discovery';
import { NavigationDiscovery, DiscoveredLink } from '../discovery/navigation-discovery';
import { UiDiscovery } from '../discovery/ui-discovery';
import { SafetyEngine } from '../safety/safety-engine';
import { UiElement } from '../types/pages';
import { assertSafeUrl, isRequestAllowed } from '../security/ssrf-guard';

/**
 * The actual SSRF enforcement point: intercepts every request the context makes (not
 * just top-level navigations) so a redirect landing on a private/internal address is
 * caught too, not just the URL the caller originally asked for. Must be installed before
 * any navigation happens on the context.
 */
async function installSsrfGuard(context: any): Promise<void> {
  await context.route('**/*', async (route: any) => {
    const url = route.request().url();
    if (await isRequestAllowed(url)) {
      await route.continue();
    } else {
      console.warn(`[SSRF Guard] Blocked request to ${url}`);
      await route.abort('blockedbyclient');
    }
  });
}

export interface CrawlCredentials {
  username: string;
  password: string;
}

export interface CrawlOptions {
  projectId: string;
  startUrl: string;
  maxPages?: number;
  cookies?: any[];
  storageStatePath?: string;
  connectCdpUrl?: string;
  credentials?: CrawlCredentials;
}

interface QueueItem {
  url: string;
  fromUrl?: string;
  viaLabel?: string;
  viaSelector?: string;
}

/**
 * Thrown when the crawl hits a login wall it can't get past on its own.
 * The worker catches this specifically to pause the job (status = AWAITING_CREDENTIALS)
 * instead of failing it outright, so the caller can submit credentials and resume.
 */
export class LoginRequiredError extends Error {
  constructor(public loginUrl: string, public reason: 'no_credentials' | 'invalid_credentials') {
    super(
      reason === 'invalid_credentials'
        ? 'Login failed with the provided credentials.'
        : 'This page requires login to proceed.'
    );
    this.name = 'LoginRequiredError';
  }
}

const USERNAME_FIELD_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[autocomplete="username"]',
  'input[type="text"]'
];

export class PlaywrightCrawler {
  private visitedUrls = new Set<string>();
  private queue: QueueItem[] = [];
  private pagesData: any[] = [];
  // First page-load failure seen this crawl. Surfaced only if the crawl ends up
  // with zero usable pages -- typically the entry URL failing to load.
  private firstPageError: Error | null = null;

  /**
   * Runs the crawl workflow, attaching to / starting Playwright session, discovering and extracting UI.
   */
  public async crawl(options: CrawlOptions): Promise<any[]> {
    const maxPages = options.maxPages || 15;
    const projectId = options.projectId;

    console.log(`Initializing Playwright crawl for project ${projectId} at ${options.startUrl}`);
    
    let browser: Browser | null = null;
    let context: any = null;
    let page: PlaywrightPage;

    if (options.connectCdpUrl) {
      // Connect to existing running browser (Extension session sharing flow)
      console.log(`Connecting over CDP: ${options.connectCdpUrl}`);
      browser = await chromium.connectOverCDP(options.connectCdpUrl);
      context = browser.contexts()[0];
      await installSsrfGuard(context);
      page = context.pages()[0] || (await context.newPage());
    } else {
      // Launch headless browser locally
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      if (options.cookies) {
        await context.addCookies(options.cookies);
      }
      if (options.storageStatePath) {
        // Can reload state directly
        context = await browser.newContext({ storageState: options.storageStatePath });
      }
      await installSsrfGuard(context);
      page = await context.newPage();
    }

    // Set standard viewport and timeouts
    await page.setViewportSize({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(10000);

    // Cheap pre-check before seeding the queue -- the context.route() guard installed
    // above is the check that actually matters (it also catches redirects), this just
    // fails fast without spinning up navigation at all for an obviously-bad start URL.
    await assertSafeUrl(options.startUrl);

    // Seed the queue
    this.queue.push({ url: options.startUrl });
    const startOrigin = new URL(options.startUrl).origin;

    try {
      while (this.queue.length > 0 && this.visitedUrls.size < maxPages) {
        const currentItem = this.queue.shift()!;
        const currentUrl = currentItem.url;

        // Normalize URL path to prevent duplicate crawling of trailing slashes or search queries
        const normUrl = this.normalizeUrl(currentUrl);
        if (this.visitedUrls.has(normUrl)) {
          continue;
        }

        console.log(`[Crawl Queue] Visiting: ${currentUrl} (${this.visitedUrls.size}/${maxPages} visited)`);
        this.visitedUrls.add(normUrl);

        try {
          // Navigate with networkidle wait state
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(1000); // Wait for animations/renders

          // If the very first page of this crawl is behind a login wall, either log in
          // with the supplied credentials or pause the crawl for the caller to provide them.
          if (this.visitedUrls.size === 1 && (await page.locator('input[type="password"]').count()) > 0) {
            if (!options.credentials) {
              throw new LoginRequiredError(currentUrl, 'no_credentials');
            }
            const loggedIn = await this.attemptLogin(page, options.credentials);
            if (!loggedIn) {
              throw new LoginRequiredError(currentUrl, 'invalid_credentials');
            }
            console.log(`[Login] Authenticated successfully, resuming crawl at ${currentUrl}`);
            await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(1000);
          }

          // 1. Page Metadata
          const pageMeta = await PageDiscovery.discover(page);
          const html = await page.content();

          // 2. Navigation Discovery
          const navLinks = await NavigationDiscovery.discover(page);

          // Queue discovered internal links that share the same origin
          for (const link of navLinks) {
            try {
              const fullUrl = new URL(link.url, currentUrl).href;
              const linkUrlObj = new URL(fullUrl);
              const normLink = this.normalizeUrl(fullUrl);

              if (linkUrlObj.origin === startOrigin && !this.visitedUrls.has(normLink) && !this.queue.some(item => item.url === fullUrl)) {
                // Safety engine check on navigation
                const safetyCheck = SafetyEngine.checkAction(link.label, link.selector, 'Navigate');
                if (safetyCheck.safe) {
                  this.queue.push({ url: fullUrl, fromUrl: currentUrl, viaLabel: link.label, viaSelector: link.selector });
                } else {
                  console.log(`[Safety Warning] Prevented queuing of potentially dangerous navigation: ${link.label} (${link.url})`);
                }
              }
            } catch (err) {
              // Ignore invalid link URLs
            }
          }

          // 3. UI Element Discovery
          const uiElements = await UiDiscovery.discover(page);

          // Interactive checks (e.g. click non-destructive buttons to reveal dialogues/modals)
          const dialogElements = uiElements.filter(e => e.type === 'dialog');
          const buttonsToClick = uiElements.filter(e => e.type === 'button' && 
            (e.label.toLowerCase().includes('add') || e.label.toLowerCase().includes('create') || e.label.toLowerCase().includes('open') || e.label.toLowerCase().includes('view') || e.label.toLowerCase().includes('show'))
          );

          // Only attempt dialog revelation if no dialogs are already open
          if (dialogElements.length === 0) {
            for (const btn of buttonsToClick) {
              const safety = SafetyEngine.checkAction(btn.label, btn.selector, 'Click');
              if (safety.safe) {
                try {
                  console.log(`[Safety Allowed] Clicking button to discover modals: "${btn.label}"`);
                  await page.click(btn.selector, { timeout: 2000 });
                  await page.waitForTimeout(500);

                  // Re-evaluate UI elements once clicked to capture modal inputs/fields
                  const postClickElements = await UiDiscovery.discover(page);
                  for (const newEl of postClickElements) {
                    if (!uiElements.some(old => old.selector === newEl.selector)) {
                      uiElements.push(newEl);
                    }
                  }

                  // Escape back to normal page state (press Escape key)
                  await page.keyboard.press('Escape');
                  await page.waitForTimeout(300);
                } catch (e) {
                  // Button click failed/timed out, skip it
                }
              } else {
                console.log(`[Safety Intercepted] Blocked interaction: ${safety.reason}`);
              }
            }
          }

          // Store page extraction data, including how this page was reached (which link/button, from which page)
          this.pagesData.push({
            url: pageMeta.url,
            title: pageMeta.title,
            breadcrumb: pageMeta.breadcrumb,
            domHash: pageMeta.domHash,
            domJson: pageMeta.domJson,
            html,
            elements: uiElements,
            parentUrl: currentItem.fromUrl ? (new URL(currentItem.fromUrl).pathname + new URL(currentItem.fromUrl).search) : null,
            viaLabel: currentItem.viaLabel || null,
            viaSelector: currentItem.viaSelector || null
          });

        } catch (pageErr: any) {
          // A login wall is a crawl-level condition the caller must resolve (submit credentials
          // and resume), not a single bad page to skip over -- propagate it out of crawl().
          if (pageErr instanceof LoginRequiredError) {
            throw pageErr;
          }
          if (!this.firstPageError) this.firstPageError = pageErr;
          console.error(`Failed to crawl page ${currentUrl}: ${pageErr?.message || pageErr}`);
        }
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    // A crawl that reached no pages is a failure, not an empty success -- surface the
    // underlying navigation error (e.g. the entry URL not resolving) so the caller can
    // mark the job FAILED instead of projecting an empty graph that reads as "no results".
    if (this.pagesData.length === 0) {
      const detail = this.firstPageError?.message || 'no reachable pages were found';
      throw new Error(`Crawl reached no pages at ${options.startUrl}: ${detail}`);
    }

    return this.pagesData;
  }

  /**
   * Best-effort login: fills the first plausible username/email field and the password
   * field, then submits. Selectors are heuristic, like the rest of discovery -- won't
   * handle 2FA, CAPTCHAs, or OAuth redirects.
   *
   * Success is judged primarily by the HTTP status of the submission response (a 4xx/5xx,
   * e.g. a bare "401 Invalid credentials" page, is an unambiguous failure even if that page
   * happens not to re-render a password field). Only when the form submits without a full
   * page navigation (SPA-style fetch/XHR) do we fall back to "is a password field still
   * present" -- that fallback is inherently guessable and can be fooled by a failure page
   * that omits the form.
   */
  private async attemptLogin(page: PlaywrightPage, credentials: CrawlCredentials): Promise<boolean> {
    let usernameField = null;
    for (const selector of USERNAME_FIELD_SELECTORS) {
      const locator = page.locator(selector).first();
      if (await locator.count() > 0) {
        usernameField = locator;
        break;
      }
    }

    const passwordField = page.locator('input[type="password"]').first();
    if (!usernameField || (await passwordField.count()) === 0) {
      return false;
    }

    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);

    const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();

    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
      (async () => {
        if ((await submitButton.count()) > 0) {
          await submitButton.click();
        } else {
          await passwordField.press('Enter');
        }
      })()
    ]);

    await page.waitForTimeout(1000);

    if (response && !response.ok()) {
      return false;
    }

    // No full navigation (SPA-style submit), or a 2xx/3xx response: fall back to
    // checking whether a password field is still present.
    return (await page.locator('input[type="password"]').count()) === 0;
  }

  private normalizeUrl(urlStr: string): string {
    try {
      const u = new URL(urlStr);
      let pathname = u.pathname;
      if (pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      return u.protocol + '//' + u.host + pathname + u.search;
    } catch (e) {
      return urlStr;
    }
  }
}
