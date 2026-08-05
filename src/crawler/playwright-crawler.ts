import { chromium, Browser, Page as PlaywrightPage } from 'playwright';
import { PageDiscovery } from '../discovery/page-discovery';
import { NavigationDiscovery, DiscoveredLink } from '../discovery/navigation-discovery';
import { UiDiscovery } from '../discovery/ui-discovery';
import { SafetyEngine } from '../safety/safety-engine';
import { UiElement } from '../types/pages';

export interface CrawlOptions {
  projectId: string;
  startUrl: string;
  maxPages?: number;
  cookies?: any[];
  storageStatePath?: string;
  connectCdpUrl?: string;
}

export class PlaywrightCrawler {
  private visitedUrls = new Set<string>();
  private queue: string[] = [];
  private pagesData: any[] = [];

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
      page = await context.newPage();
    }

    // Set standard viewport and timeouts
    await page.setViewportSize({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(10000);

    // Seed the queue
    this.queue.push(options.startUrl);
    const startOrigin = new URL(options.startUrl).origin;

    try {
      while (this.queue.length > 0 && this.visitedUrls.size < maxPages) {
        const currentUrl = this.queue.shift()!;
        
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

          // 1. Page Metadata
          const pageMeta = await PageDiscovery.discover(page);

          // 2. Navigation Discovery
          const navLinks = await NavigationDiscovery.discover(page);

          // Queue discovered internal links that share the same origin
          for (const link of navLinks) {
            try {
              const fullUrl = new URL(link.url, currentUrl).href;
              const linkUrlObj = new URL(fullUrl);
              const normLink = this.normalizeUrl(fullUrl);

              if (linkUrlObj.origin === startOrigin && !this.visitedUrls.has(normLink) && !this.queue.includes(fullUrl)) {
                // Safety engine check on navigation
                const safetyCheck = SafetyEngine.checkAction(link.label, link.selector, 'Navigate');
                if (safetyCheck.safe) {
                  this.queue.push(fullUrl);
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

          // Store page extraction data
          this.pagesData.push({
            url: pageMeta.url,
            title: pageMeta.title,
            breadcrumb: pageMeta.breadcrumb,
            domHash: pageMeta.domHash,
            domJson: pageMeta.domJson,
            elements: uiElements
          });

        } catch (pageErr: any) {
          console.error(`Failed to crawl page ${currentUrl}: ${pageErr?.message || pageErr}`);
        }
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }

    return this.pagesData;
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
