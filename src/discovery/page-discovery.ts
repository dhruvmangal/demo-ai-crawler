import { Page } from 'playwright';
import * as crypto from 'crypto';

export interface DiscoveredPageMeta {
  url: string;
  title: string;
  breadcrumb: string;
  domHash: string;
  domJson: any;
}

export class PageDiscovery {
  /**
   * Discovers and parses the page metadata, generating layout representations.
   */
  public static async discover(page: Page): Promise<DiscoveredPageMeta> {
    const url = page.url();
    const title = await page.title();
    
    // Evaluate structure inside the page to produce DOM JSON and Breadcrumbs
    const { breadcrumb, domStructure } = await page.evaluate(() => {
      // 1. Breadcrumbs extraction
      let breadcrumbText = '';
      const breadcrumbContainer = document.querySelector('.breadcrumb, .breadcrumbs, [aria-label="breadcrumb"], .breadcrumb-list');
      if (breadcrumbContainer) {
        breadcrumbText = Array.from(breadcrumbContainer.querySelectorAll('li, span, a'))
          .map(el => (el.textContent || '').trim())
          .filter(t => t && t !== '/' && t !== '>')
          .join(' > ');
      }

      if (!breadcrumbText) {
        // Fallback: build breadcrumb from H1/headers or path segments
        const pathSegments = window.location.pathname.split('/').filter(Boolean);
        breadcrumbText = pathSegments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' > ');
      }

      // 2. Build a structural DOM JSON containing layout tags (ignoring text/scripts/styles)
      const buildStructure = (node: Element): any => {
        const children: any[] = [];
        node.querySelectorAll(':scope > *').forEach(child => {
          const tag = child.tagName.toLowerCase();
          if (['script', 'style', 'svg', 'path', 'noscript'].includes(tag)) {
            return;
          }
          children.push({
            tag,
            id: child.id || undefined,
            class: child.className ? child.className.toString().split(' ').filter(Boolean).join('.') : undefined,
            children: child.children.length > 0 ? buildStructure(child) : []
          });
        });
        return children;
      };

      const domStructure = document.body ? buildStructure(document.body) : [];

      return {
        breadcrumb: breadcrumbText,
        domStructure
      };
    });

    // Create a stable DOM hash from the DOM structure
    const domStr = JSON.stringify(domStructure);
    const domHash = crypto.createHash('sha256').update(domStr).digest('hex');

    return {
      url: new URL(url).pathname + new URL(url).search, // Store path + query parameter relative to host
      title,
      breadcrumb: breadcrumb || title,
      domHash,
      domJson: domStructure
    };
  }
}
