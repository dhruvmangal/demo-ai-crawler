import { Page } from 'playwright';
import { UiElement, UiElementType, UiElementMetadata } from '../types/pages';

export class UiDiscovery {
  /**
   * Scans the active page for interactive and structural UI components -- type, inferred
   * purpose, DOM structure, on-page position, and a curated computed-style subset for
   * every element, not just the handful of interactive types this used to cover.
   */
  public static async discover(page: Page): Promise<UiElement[]> {
    return page.evaluate(() => {
      const elements: UiElement[] = [];
      const typeCounts: Partial<Record<string, number>> = {};

      // page.evaluate() serializes this whole function into the page and re-parses it
      // there, so it can't close over module-level Node.js constants -- these live inside
      // the callback instead. Protects storage and the (unfiltered) downstream LLM prompts
      // / recording-pipeline query from a pathologically content-heavy page. Interactive
      // types are detected before display types below, so if the overall cap is hit it's
      // the decorative elements that get dropped first.
      const OVERALL_CAP = 80;
      const PER_TYPE_CAPS: Record<string, number> = { image: 25, card: 25, badge: 20, 'nav-item': 30 };

      function tryPush(el: UiElement): void {
        if (elements.length >= OVERALL_CAP) return;
        const cap = PER_TYPE_CAPS[el.type];
        if (cap !== undefined) {
          const count = typeCounts[el.type] || 0;
          if (count >= cap) return;
          typeCounts[el.type] = count + 1;
        }
        elements.push(el);
      }

      // ---- selector ----
      const getSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        let selector = el.tagName.toLowerCase();
        if (el.className) {
          const classes = el.className.toString().split(/\s+/).filter(c => c && !c.includes('{') && !c.includes(':'));
          if (classes.length > 0) {
            selector += `.${classes.slice(0, 3).join('.')}`;
          }
        }
        const nameAttr = el.getAttribute('name');
        if (nameAttr) selector += `[name="${nameAttr}"]`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-target');
        if (testId) return `[data-testid="${testId}"]`;
        return selector;
      };

      // ---- visibility ----
      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return !(rect.width === 0 && rect.height === 0);
      };

      // ---- position / region ----
      const getRegion = (el: Element): 'header' | 'sidebar' | 'footer' | 'main' | 'modal' | 'unknown' => {
        const found = new Set<string>();
        let node: Element | null = el.parentElement;
        while (node && node !== document.documentElement) {
          const tag = node.tagName.toLowerCase();
          const cls = node.className ? String(node.className) : '';
          const role = node.getAttribute('role') || '';
          if (tag === 'dialog' || role === 'dialog' || /\b(modal|dialog|popup|drawer|side-panel)\b/i.test(cls)) found.add('modal');
          if (tag === 'header') found.add('header');
          if (tag === 'footer') found.add('footer');
          if (tag === 'nav' || tag === 'aside' || /\b(sidebar|side-nav)\b/i.test(cls)) found.add('sidebar');
          if (tag === 'main') found.add('main');
          node = node.parentElement;
        }
        if (found.has('modal')) return 'modal';
        if (found.has('header')) return 'header';
        if (found.has('footer')) return 'footer';
        if (found.has('sidebar')) return 'sidebar';
        if (found.has('main')) return 'main';
        return 'unknown';
      };

      const getPosition = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inViewport,
          documentY: Math.round(window.scrollY + rect.y),
          region: getRegion(el)
        };
      };

      // ---- styling (curated, not a full computed-style dump) ----
      const getStyling = (el: Element) => {
        const s = window.getComputedStyle(el);
        return {
          color: s.color,
          backgroundColor: s.backgroundColor,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          borderRadius: s.borderRadius,
          borderColor: s.borderColor,
          borderWidth: s.borderWidth,
          boxShadow: s.boxShadow,
          cursor: s.cursor,
          opacity: s.opacity,
          zIndex: s.zIndex,
          display: s.display,
          visibility: s.visibility
        };
      };

      // ---- structure ----
      const ATTR_ALLOWLIST = ['id', 'name', 'href', 'type', 'placeholder', 'value', 'title', 'role', 'data-testid', 'data-target'];
      const getAttributes = (el: Element): Record<string, string> => {
        const attrs: Record<string, string> = {};
        ATTR_ALLOWLIST.forEach(a => {
          const v = el.getAttribute(a);
          if (v) attrs[a] = v;
        });
        Array.from(el.attributes).forEach(a => {
          if (a.name.startsWith('aria-')) attrs[a.name] = a.value;
        });
        return attrs;
      };

      const getDomPath = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        let depth = 0;
        while (node && node !== document.body && depth < 6) {
          let part = node.tagName.toLowerCase();
          const parent: Element | null = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === (node as Element).tagName);
            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
            }
          }
          parts.unshift(part);
          node = node.parentElement;
          depth++;
        }
        return (depth >= 6 ? '…>' : '') + parts.join('>');
      };

      const getParentSelector = (el: Element): string | undefined => {
        const ancestor = el.closest('form, table, dialog, [role="dialog"], nav, [role="navigation"]');
        return ancestor && ancestor !== el ? getSelector(ancestor) : undefined;
      };

      const getStructure = (el: Element) => {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200);
        return {
          tag: el.tagName.toLowerCase(),
          attributes: getAttributes(el),
          domPath: getDomPath(el),
          parentSelector: getParentSelector(el),
          childCount: el.children.length,
          textContent: text || undefined
        };
      };

      // ---- state ----
      const getState = (el: any) => {
        const state: Record<string, boolean> = {};
        if ('disabled' in el) state.disabled = !!el.disabled;
        else if (el.hasAttribute('disabled')) state.disabled = true;
        if ('required' in el) state.required = !!el.required;
        else if (el.hasAttribute('required')) state.required = true;
        if ('checked' in el) state.checked = !!el.checked;
        if (el.hasAttribute('aria-selected')) state.selected = el.getAttribute('aria-selected') === 'true';
        if ('readOnly' in el) state.readonly = !!el.readOnly;
        if (el.hasAttribute('aria-expanded')) state.expanded = el.getAttribute('aria-expanded') === 'true';
        return state;
      };

      // ---- purpose (keyword/context heuristic, no LLM call) ----
      const inferPurpose = (type: string, label: string): string => {
        const l = (label || '').toLowerCase();
        switch (type) {
          case 'form': return /search/.test(l) ? 'search' : 'submit-form';
          case 'table': return 'browse-records';
          case 'link': return 'navigate';
          case 'nav-item': return 'navigate';
          case 'breadcrumb': return 'navigate';
          case 'pagination': return 'navigate-pages';
          case 'checkbox': case 'radio': case 'toggle': return 'toggle-state';
          case 'select': return 'select-option';
          case 'textarea': return 'enter-text';
          case 'tab': return 'switch-view';
          case 'image': return 'display-media';
          case 'badge': return 'display-status';
          case 'alert': return 'display-status';
          case 'card': return 'display-content';
          case 'menu': return 'open-menu';
          case 'dialog': return 'display-content';
          case 'input':
            if (/search|query|find/.test(l)) return 'search';
            if (/email/.test(l)) return 'enter-email';
            if (/password/.test(l)) return 'enter-password';
            return 'enter-text';
        }
        if (/delete|remove|trash/.test(l)) return 'delete-item';
        if (/create|add|new/.test(l)) return 'create-item';
        if (/edit|update/.test(l)) return 'edit-item';
        if (/save|submit/.test(l)) return 'submit-form';
        if (/view|open|show|details/.test(l)) return 'view-details';
        if (/search|filter/.test(l)) return 'search-filter';
        if (/sort/.test(l)) return 'sort-data';
        if (/export|download/.test(l)) return 'export-data';
        if (/close|cancel|dismiss/.test(l)) return 'dismiss';
        return 'perform-action';
      };

      const buildMetadata = (el: Element, type: string, label: string, extra?: Partial<UiElementMetadata>): UiElementMetadata => ({
        purpose: inferPurpose(type, label),
        structure: getStructure(el),
        position: getPosition(el),
        styling: getStyling(el),
        state: getState(el),
        ...(extra || {})
      });

      // 1. Dialogs/Modals
      const dialogSelectors = ['dialog', '[role="dialog"]', '.modal', '.popup', '.dialog', '.side-panel', '.drawer', '.aside-panel'];
      dialogSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(dialog => {
          if (!isVisible(dialog)) return;
          const titleEl = dialog.querySelector('h1, h2, h3, .modal-title, .dialog-title');
          const label = (titleEl?.textContent || dialog.getAttribute('aria-label') || 'Dialog/Modal').trim();
          tryPush({
            pageId: '',
            type: 'dialog',
            label,
            selector: getSelector(dialog),
            role: 'dialog',
            confidence: 0.95,
            metadata: buildMetadata(dialog, 'dialog', label, {
              innerButtons: Array.from(dialog.querySelectorAll('button')).map(b => (b as HTMLElement).innerText.trim())
            })
          });
        });
      });

      // 2. Forms (keeps its aggregate `fields` summary; each field is also captured on
      // its own below, whether or not it lives inside a form)
      document.querySelectorAll('form, [role="form"], .form-container').forEach(form => {
        const titleEl = form.querySelector('h1, h2, h3, .form-title, legend');
        const label = (titleEl?.textContent || form.getAttribute('aria-label') || form.getAttribute('name') || 'Generic Form').trim();

        const fields: UiElementMetadata['fields'] = [];
        form.querySelectorAll('input, select, textarea').forEach(input => {
          const name = input.getAttribute('name') || input.id || '';
          const type = input.getAttribute('type') || input.tagName.toLowerCase();
          let fieldLabel = '';
          if (input.id) {
            try {
              const labelEl = document.querySelector(`label[for="${input.id}"]`);
              if (labelEl) fieldLabel = (labelEl.textContent || '').trim();
            } catch { /* id isn't a valid selector token (e.g. contains ':') */ }
          }
          if (!fieldLabel) {
            const parentLabel = input.closest('label');
            if (parentLabel) fieldLabel = (parentLabel.textContent || '').trim();
          }
          if (!fieldLabel) {
            fieldLabel = input.getAttribute('placeholder') || input.getAttribute('aria-label') || name;
          }
          fields!.push({
            name,
            label: fieldLabel.trim(),
            type,
            required: input.hasAttribute('required'),
            pattern: input.getAttribute('pattern') || undefined,
            placeholder: input.getAttribute('placeholder') || undefined
          });
        });

        if (!isVisible(form)) return;
        tryPush({
          pageId: '',
          type: 'form',
          label,
          selector: getSelector(form),
          role: 'form',
          confidence: 0.95,
          metadata: buildMetadata(form, 'form', label, { fields })
        });
      });

      // 3. Tables
      document.querySelectorAll('table, .table, [role="table"], .grid-container').forEach(table => {
        if (!isVisible(table)) return;
        const titleEl = table.previousElementSibling?.tagName.startsWith('H') ? table.previousElementSibling : null;
        const label = (titleEl?.textContent || table.getAttribute('aria-label') || 'Data Table').trim();

        const columns: string[] = [];
        table.querySelectorAll('th, .table-header, [role="columnheader"]').forEach(h => {
          const text = (h.textContent || '').trim();
          if (text) columns.push(text);
        });

        const rowActions: string[] = [];
        table.querySelectorAll('td, .table-cell').forEach(cell => {
          cell.querySelectorAll('button, a.btn, a.button').forEach(btn => {
            const text = (btn.textContent || '').trim();
            if (text && !rowActions.includes(text) && text.length < 30) rowActions.push(text);
          });
        });

        tryPush({
          pageId: '',
          type: 'table',
          label,
          selector: getSelector(table),
          role: 'table',
          confidence: 0.90,
          metadata: buildMetadata(table, 'table', label, { columns, rowActions })
        });
      });

      // 4. Buttons (the button's form/table ancestor, if any, is already captured via
      // metadata.structure.parentSelector -- no separate formId/tableId needed)
      document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], .btn, .button').forEach(btn => {
        if (btn.closest('nav') || btn.closest('aside') || btn.closest('.sidebar') || btn.closest('#sidebar')) return;
        if (!isVisible(btn)) return;
        const label = (btn.textContent || (btn as HTMLInputElement).value || '').trim();
        if (!label || label.length === 0 || label.length >= 50) return;
        tryPush({
          pageId: '',
          type: 'button',
          label,
          selector: getSelector(btn),
          role: 'button',
          confidence: 0.85,
          metadata: buildMetadata(btn, 'button', label)
        });
      });

      // 5. Standalone form fields (input/select/textarea/checkbox/radio) -- captured as
      // their own elements whether or not they live inside a <form>, unlike before where
      // non-form-nested fields were invisible and form-nested ones only existed buried in
      // the form's `fields` summary above.
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (!isVisible(el)) return;
        const tag = el.tagName.toLowerCase();
        let type: UiElementType;
        let role: string;
        if (tag === 'select') { type = 'select'; role = 'combobox'; }
        else if (tag === 'textarea') { type = 'textarea'; role = 'textbox'; }
        else {
          const inputType = (el.getAttribute('type') || 'text').toLowerCase();
          if (['hidden', 'submit', 'button', 'reset', 'image'].includes(inputType)) return; // not a distinct field, or handled by button detection
          if (inputType === 'checkbox') { type = 'checkbox'; role = 'checkbox'; }
          else if (inputType === 'radio') { type = 'radio'; role = 'radio'; }
          else { type = 'input'; role = 'textbox'; }
        }

        let label = '';
        if (el.id) {
          try {
            const labelEl = document.querySelector(`label[for="${el.id}"]`);
            if (labelEl) label = (labelEl.textContent || '').trim();
          } catch { /* invalid id-as-selector */ }
        }
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) label = (parentLabel.textContent || '').trim();
        }
        if (!label) {
          label = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim();
        }
        if (!label) label = `${type} field`;

        tryPush({
          pageId: '',
          type,
          label,
          selector: getSelector(el),
          role,
          confidence: 0.9,
          metadata: buildMetadata(el, type, label)
        });
      });

      // 6. Links vs. nav items -- same detection pass; content links (main/article/etc.)
      // are tagged `link`, anything inside nav/aside/header/footer/sidebar is `nav-item`.
      // NavigationDiscovery separately queues these for crawling; this only inventories them.
      document.querySelectorAll('a[href]').forEach(a => {
        if (!isVisible(a)) return;
        const label = (a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').trim();
        if (!label || label.length > 100) return;
        const isNavArea = !!(a.closest('nav') || a.closest('aside') || a.closest('header') || a.closest('footer') || a.closest('.sidebar') || a.closest('#sidebar'));
        const type: UiElementType = isNavArea ? 'nav-item' : 'link';
        tryPush({
          pageId: '',
          type,
          label,
          selector: getSelector(a),
          role: 'link',
          confidence: isNavArea ? 0.72 : 0.8,
          metadata: buildMetadata(a, type, label)
        });
      });

      // 7. Toggles (switches not already covered by checkbox detection above)
      document.querySelectorAll('[role="switch"]').forEach(el => {
        if (el.tagName.toLowerCase() === 'input' || !isVisible(el)) return;
        const label = (el.getAttribute('aria-label') || el.textContent || 'Toggle').trim();
        tryPush({
          pageId: '', type: 'toggle', label, selector: getSelector(el), role: 'switch', confidence: 0.75,
          metadata: buildMetadata(el, 'toggle', label)
        });
      });

      // 8. Tabs
      document.querySelectorAll('[role="tab"]').forEach(el => {
        if (!isVisible(el)) return;
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim();
        if (!label) return;
        tryPush({
          pageId: '', type: 'tab', label, selector: getSelector(el), role: 'tab', confidence: 0.75,
          metadata: buildMetadata(el, 'tab', label)
        });
      });

      // 9. Breadcrumb trail (one per page, typically)
      const breadcrumbEl = document.querySelector('nav[aria-label="breadcrumb" i], .breadcrumb, .breadcrumbs, ol.breadcrumb');
      if (breadcrumbEl && isVisible(breadcrumbEl)) {
        const label = (breadcrumbEl.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150) || 'Breadcrumb';
        tryPush({
          pageId: '', type: 'breadcrumb', label, selector: getSelector(breadcrumbEl), role: 'navigation', confidence: 0.8,
          metadata: buildMetadata(breadcrumbEl, 'breadcrumb', label)
        });
      }

      // 10. Pagination
      document.querySelectorAll('.pagination, nav[aria-label*="pagination" i], [role="navigation"][aria-label*="page" i]').forEach(el => {
        if (!isVisible(el)) return;
        const label = (el.getAttribute('aria-label') || 'Pagination').trim();
        tryPush({
          pageId: '', type: 'pagination', label, selector: getSelector(el), role: 'navigation', confidence: 0.78,
          metadata: buildMetadata(el, 'pagination', label)
        });
      });

      // 11. Cards (content containers -- exact class-token match to avoid "cardholder" etc.)
      document.querySelectorAll('.card, [class~="card"]').forEach(card => {
        if (!isVisible(card) || card.closest('table')) return;
        const titleEl = card.querySelector('h1, h2, h3, h4, .card-title');
        const label = (titleEl?.textContent || card.getAttribute('aria-label') || 'Card').trim().slice(0, 80);
        tryPush({
          pageId: '', type: 'card', label, selector: getSelector(card), role: 'group', confidence: 0.6,
          metadata: buildMetadata(card, 'card', label)
        });
      });

      // 12. Images (skip icons/spacers)
      document.querySelectorAll('img[src]').forEach(img => {
        const rect = img.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 24 || !isVisible(img)) return;
        const label = (img.getAttribute('alt') || img.getAttribute('title') || 'Image').trim().slice(0, 80);
        tryPush({
          pageId: '', type: 'image', label, selector: getSelector(img), role: 'img', confidence: 0.7,
          metadata: buildMetadata(img, 'image', label)
        });
      });

      // 13. Alerts / banners
      document.querySelectorAll('[role="alert"], .alert, .toast, .notification, .banner').forEach(el => {
        if (!isVisible(el)) return;
        const label = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150) || 'Alert';
        tryPush({
          pageId: '', type: 'alert', label, selector: getSelector(el), role: 'alert', confidence: 0.82,
          metadata: buildMetadata(el, 'alert', label)
        });
      });

      // 14. Badges/status pills
      document.querySelectorAll('[role="status"], .badge, [class~="tag"], [class~="chip"]').forEach(el => {
        if (!isVisible(el)) return;
        const label = (el.textContent || '').trim().slice(0, 50);
        if (!label) return;
        tryPush({
          pageId: '', type: 'badge', label, selector: getSelector(el), role: 'status', confidence: 0.6,
          metadata: buildMetadata(el, 'badge', label)
        });
      });

      // 15. Menus (most closed dropdown menus are display:none and naturally excluded by isVisible)
      document.querySelectorAll('[role="menu"], .dropdown-menu, .menu').forEach(el => {
        if (!isVisible(el)) return;
        const label = (el.getAttribute('aria-label') || 'Menu').trim();
        tryPush({
          pageId: '', type: 'menu', label, selector: getSelector(el), role: 'menu', confidence: 0.6,
          metadata: buildMetadata(el, 'menu', label)
        });
      });

      return elements;
    });
  }
}
