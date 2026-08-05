import { Page } from 'playwright';

export interface DiscoveredLink {
  label: string;
  url: string;
  selector: string;
  location: 'sidebar' | 'header' | 'footer' | 'dropdown' | 'content';
  parentLabel?: string;
}

export class NavigationDiscovery {
  /**
   * Scans the active page for navigation menus, sidebars, links, etc.
   */
  public static async discover(page: Page): Promise<DiscoveredLink[]> {
    return page.evaluate(() => {
      const links: DiscoveredLink[] = [];
      
      // Selectors identifying navigation containers
      const navSelectors = [
        { selector: 'nav', location: 'header' as const },
        { selector: 'aside', location: 'sidebar' as const },
        { selector: '.sidebar', location: 'sidebar' as const },
        { selector: '#sidebar', location: 'sidebar' as const },
        { selector: '.menu', location: 'sidebar' as const },
        { selector: '.navigation', location: 'header' as const },
        { selector: 'header', location: 'header' as const },
        { selector: 'footer', location: 'footer' as const }
      ];

      // Track processed anchor elements to avoid duplicates within a specific block
      const processed = new Set<HTMLAnchorElement>();

      for (const rule of navSelectors) {
        const containers = document.querySelectorAll(rule.selector);
        containers.forEach(container => {
          const anchors = container.querySelectorAll('a');
          anchors.forEach(a => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
              const label = (a.innerText || a.textContent || '').trim();
              if (label && label.length > 0) {
                // Generate a stable selector path
                let path = '';
                let parent = a.parentElement;
                while (parent && parent !== document.body) {
                  const id = parent.id ? `#${parent.id}` : '';
                  const className = parent.className ? `.${parent.className.split(' ').filter(Boolean).join('.')}` : '';
                  const tagName = parent.tagName.toLowerCase();
                  if (id) {
                    path = `${tagName}${id} ${path}`;
                    break;
                  } else {
                    path = `${tagName}${className ? className.slice(0, 30) : ''} > ${path}`;
                  }
                  parent = parent.parentElement;
                }
                path = `${path}a[href="${href}"]`;

                links.push({
                  label,
                  url: href,
                  selector: path,
                  location: rule.location
                });
                processed.add(a);
              }
            }
          });
        });
      }

      // Add general breadcrumbs discovery
      const breadcrumbContainers = document.querySelectorAll('.breadcrumb, .breadcrumbs, [aria-label="breadcrumb"]');
      breadcrumbContainers.forEach(container => {
        const anchors = container.querySelectorAll('a');
        anchors.forEach(a => {
          const href = a.getAttribute('href');
          if (href) {
            links.push({
              label: (a.innerText || a.textContent || '').trim(),
              url: href,
              selector: `[aria-label="breadcrumb"] a[href="${href}"]`,
              location: 'header',
              parentLabel: 'Breadcrumb'
            });
          }
        });
      });

      // Scan all other links to ensure full page coverage
      const allAnchors = document.querySelectorAll('a');
      allAnchors.forEach(a => {
        const href = a.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !processed.has(a)) {
          const label = (a.innerText || a.textContent || '').trim();
          if (label && label.length > 0 && label.length < 50) {
            links.push({
              label,
              url: href,
              selector: `a[href="${href}"]`,
              location: 'content'
            });
          }
        }
      });

      return links;
    });
  }
}
