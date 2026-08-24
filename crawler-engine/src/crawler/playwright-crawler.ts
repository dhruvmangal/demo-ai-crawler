import { chromium, Browser, Page as PlaywrightPage } from 'playwright';
import { PageDiscovery } from '../discovery/page-discovery';
import { NavigationDiscovery, DiscoveredLink } from '../discovery/navigation-discovery';
import { UiDiscovery } from '../discovery/ui-discovery';
import { StateExplorer } from '../discovery/state-explorer';
import { SafetyEngine } from '../safety/safety-engine';
import { UiElement } from '../types/pages';
import { assertSafeUrl, isRequestAllowed } from '../security/ssrf-guard';
import { LoginDetector } from './login-detector';

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
  // Playwright storage state (cookies + localStorage) captured from an already-authenticated
  // session, either inline (as returned by BrowserContext.storageState()) or a path to a
  // file containing it. When set, the crawl starts already logged in and never hits the
  // password-field login-wall check below.
  storageState?: PlaywrightStorageState;
  storageStatePath?: string;
  connectCdpUrl?: string;
  credentials?: CrawlCredentials;
  // If the login wall can't be passed with `credentials` (or none exist yet for this site),
  // fall back to heuristically filling and submitting a registration/signup form with the
  // same credentials to create a new account, then proceed logged in as that account.
  autoRegister?: boolean;
}

export interface PlaywrightStorageState {
  cookies?: any[];
  origins?: any[];
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

const SIGNUP_TOGGLE_SELECTORS = [
  'a:has-text("Sign up")',
  'a:has-text("Create account")',
  'a:has-text("Register")',
  'button:has-text("Sign up")',
  'button:has-text("Create account")',
  'button:has-text("Register")'
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
    // Whether to close the whole browser in the finally block below, or just the one page
    // we opened ourselves. Playwright's docs: for a CDP-attached browser, browser.close()
    // "clears all created contexts belonging to this browser" -- i.e. it can tear down the
    // caller's own tabs, not just disconnect. So for connectCdpUrl we must never call it;
    // at most close the single extra tab we opened, and leave the rest of their browser --
    // and whatever they're logged into in it -- untouched.
    let ownedPage = false;

    if (options.connectCdpUrl) {
      // Connect to an already-running, already-authenticated browser the caller controls
      // (e.g. their own Chrome with --remote-debugging-port, logged into a site by hand).
      console.log(`Connecting over CDP: ${options.connectCdpUrl}`);
      browser = await chromium.connectOverCDP(options.connectCdpUrl);
      context = browser.contexts()[0];
      await installSsrfGuard(context);
      const existingPages = context.pages();
      if (existingPages.length > 0) {
        page = existingPages[0];
      } else {
        page = await context.newPage();
        ownedPage = true;
      }
    } else {
      // Launch headless browser locally
      browser = await chromium.launch({ headless: true });
      // storageState (inline object) takes precedence over storageStatePath (file) if both
      // are somehow set; either seeds the new context with cookies + localStorage from an
      // already-authenticated session so the login-wall check below never triggers.
      const storageState: any = options.storageState || options.storageStatePath;
      context = await browser.newContext(storageState ? { storageState } : undefined);
      if (options.cookies) {
        await context.addCookies(options.cookies);
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
          if (this.visitedUrls.size === 1) {
            const loginCheck = await LoginDetector.detect(page);
            if (loginCheck.isLoginScreen) {
              console.log(`[Login] Login wall detected (score=${loginCheck.score}, signals=${loginCheck.signals.join(',')})`);
              if (loginCheck.ssoOnly) {
                throw new LoginRequiredError(currentUrl, 'sso_only');
              }
              if (!options.credentials) {
                throw new LoginRequiredError(currentUrl, 'no_credentials');
              }
              let loggedIn = await this.attemptLogin(page, options.credentials);
              if (!loggedIn && options.autoRegister) {
                console.log(`[Signup] Login failed, attempting to register a new account with the supplied credentials`);
                loggedIn = await this.attemptSignup(page, options.credentials);
              }
              if (!loggedIn) {
                throw new LoginRequiredError(currentUrl, 'invalid_credentials');
              }
              console.log(`[Login] Authenticated successfully, resuming crawl at ${currentUrl}`);
              await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
              await page.waitForTimeout(1000);
            }
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

          // 4. State-space exploration: tabs, accordions, modals, and infinite-scroll never
          // change the URL, so the BFS queue above would never visit them on its own. Each
          // element StateExplorer surfaces is tagged with metadata.discoveredVia recording
          // which interaction revealed it.
          const stateElements = await StateExplorer.explore(page, uiElements);
          uiElements.push(...stateElements);

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
        if (options.connectCdpUrl) {
          if (ownedPage) {
            await page!.close().catch(() => {});
          }
        } else {
          await browser.close();
        }
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
   * Best-effort login: fills LoginDetector's best-guess username/identifier and password
   * fields, then submits via LoginDetector's scoped submit target. Selectors are heuristic,
   * like the rest of discovery -- won't handle 2FA, CAPTCHAs, or OAuth redirects.
   *
   * Success is judged primarily by the HTTP status of the submission response (a 4xx/5xx,
   * e.g. a bare "401 Invalid credentials" page, is an unambiguous failure even if that page
   * happens not to re-render a password field). Only when the form submits without a full
   * page navigation (SPA-style fetch/XHR) do we fall back to "can LoginDetector still find a
   * password field" -- that fallback is inherently guessable and can be fooled by a failure
   * page that omits the form.
   */
  private async attemptLogin(page: PlaywrightPage, credentials: CrawlCredentials): Promise<boolean> {
    const fields = await LoginDetector.findCredentialFields(page);
    if (!fields.usernameSelector || !fields.passwordSelector) {
      return false;
    }

    const usernameField = page.locator(fields.usernameSelector).first();
    const passwordField = page.locator(fields.passwordSelector).first();
    await usernameField.fill(credentials.username);
    await passwordField.fill(credentials.password);

    const submitTarget = await LoginDetector.findSubmitTarget(page, fields.passwordSelector);

    let response;
    try {
      [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
        LoginDetector.submit(page, submitTarget, passwordField)
      ]);
    } catch {
      // A stuck/hidden/unclickable submit control is a failed login attempt, not a crawl
      // failure -- let the caller fall back to auto-register or pause for credentials
      // instead of the whole crawl aborting on this one page.
      return false;
    }

    await page.waitForTimeout(1000);

    if (response && !response.ok()) {
      return false;
    }

    // No full navigation (SPA-style submit), or a 2xx/3xx response: fall back to
    // checking whether LoginDetector can still find a password field.
    const stillOnLoginForm = await LoginDetector.findCredentialFields(page);
    return stillOnLoginForm.passwordSelector === null;
  }

  /**
   * Best-effort account creation: only tried when attemptLogin() has already failed and the
   * caller opted in via CrawlOptions.autoRegister. Some login walls show a signup form
   * directly; most require clicking a toggle link/button first ("Sign up" / "Create
   * account" / "Register") -- tried once, best-effort, before looking for the form fields.
   *
   * Registration forms commonly repeat the password field for confirmation. Unlike
   * attemptLogin, this still keys off native `input[type="password"]` for the confirm-field
   * ordinal (nth(0)/nth(1)) rather than LoginDetector's single best-guess password field --
   * a custom-masked confirm field with no native password type is a rarer case this
   * best-effort, opt-in fallback doesn't chase. Username field and submit target still go
   * through LoginDetector, so the same non-native-username cases attemptLogin handles work
   * here too. Success is judged the same way as attemptLogin: an unambiguous 4xx/5xx
   * response is a failure; otherwise fall back to checking whether LoginDetector can still
   * find a password field after submit.
   */
  private async attemptSignup(page: PlaywrightPage, credentials: CrawlCredentials): Promise<boolean> {
    for (const selector of SIGNUP_TOGGLE_SELECTORS) {
      const toggle = page.locator(selector).first();
      if ((await toggle.count()) > 0) {
        await toggle.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }

    const fields = await LoginDetector.findCredentialFields(page);
    const passwordFields = page.locator('input[type="password"]');
    const passwordCount = await passwordFields.count();
    if (!fields.usernameSelector || passwordCount === 0) {
      return false;
    }

    const usernameField = page.locator(fields.usernameSelector).first();
    await usernameField.fill(credentials.username);
    await passwordFields.nth(0).fill(credentials.password);
    if (passwordCount > 1) {
      // Confirm-password field, if the form has one.
      await passwordFields.nth(1).fill(credentials.password);
    }

    const submitTarget = await LoginDetector.findSubmitTarget(page, fields.passwordSelector);

    let response;
    try {
      [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
        LoginDetector.submit(page, submitTarget, passwordFields.nth(passwordCount - 1))
      ]);
    } catch {
      // A stuck/hidden/unclickable submit control is a failed signup attempt, not a crawl
      // failure -- let the caller propagate LoginRequiredError instead of the whole crawl
      // aborting on this one page.
      return false;
    }

    await page.waitForTimeout(1000);

    if (response && !response.ok()) {
      return false;
    }

    const stillOnSignupForm = await LoginDetector.findCredentialFields(page);
    return stillOnSignupForm.passwordSelector === null;
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
