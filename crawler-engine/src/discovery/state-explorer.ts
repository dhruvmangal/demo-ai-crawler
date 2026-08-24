import { Page } from 'playwright';
import { UiDiscovery } from './ui-discovery';
import { SafetyEngine } from '../safety/safety-engine';
import { UiElement, UiElementDiscoveryTrigger } from '../types/pages';

interface TriggerCandidate {
  selector: string;
  label: string;
}

interface StateTriggers {
  modalTriggers: TriggerCandidate[];
  tabTriggers: TriggerCandidate[];
  accordionTriggers: TriggerCandidate[];
}

const MAX_MODAL_TRIGGERS = 5;
const MAX_TAB_TRIGGERS = 8;
const MAX_ACCORDION_TRIGGERS = 10;
const MAX_SCROLL_ITERATIONS = 3;
// Backstop against a pathological page (e.g. dozens of tabs x accordions) turning one page
// visit into an unbounded number of extra UiDiscovery passes.
const MAX_TOTAL_DISCOVERED = 100;

/**
 * Interacts with non-navigational, state-changing UI -- tabs, accordions/collapsibles,
 * modals, and lazy/infinite-scroll content -- that a plain link-following BFS crawl never
 * triggers, since none of it changes the URL. Without this, everything gated behind such an
 * interaction (a second tab's form, a collapsed FAQ answer, a modal's fields, page 2 of an
 * infinite-scroll feed) is invisible to the feature inventory even though it's live,
 * functional UI on a page the crawler already visited.
 *
 * Every element this surfaces gets tagged with `metadata.discoveredVia` (see UiDiscovery /
 * types/pages.ts) recording which interaction revealed it, so downstream consumers can tell
 * "always visible" apart from "behind tab X" instead of it being silently flattened into the
 * same list as the elements that were on-page at initial load.
 */
export class StateExplorer {
  public static async explore(page: Page, existingElements: UiElement[]): Promise<UiElement[]> {
    const discovered: UiElement[] = [];
    const seenSelectors = new Set(existingElements.map(e => e.selector));

    // Returns how many elements were actually new, so callers (infinite-scroll in
    // particular) can tell a no-op pass from one that surfaced something.
    const addNew = (elements: UiElement[], trigger: UiElementDiscoveryTrigger): number => {
      let added = 0;
      for (const el of elements) {
        if (discovered.length >= MAX_TOTAL_DISCOVERED) break;
        if (seenSelectors.has(el.selector)) continue;
        seenSelectors.add(el.selector);
        el.metadata = { ...el.metadata!, discoveredVia: trigger };
        discovered.push(el);
        added++;
      }
      return added;
    };

    // A dialog already open (e.g. the crawler landed mid-modal, or one was already captured
    // this pass) means opening another risks stacking dialogs / stealing focus -- skip modal
    // exploration entirely rather than fight that state.
    const hasOpenDialog = existingElements.some(e => e.type === 'dialog');

    const triggers = await this.findTriggers(page);

    if (!hasOpenDialog) {
      for (const trigger of triggers.modalTriggers.slice(0, MAX_MODAL_TRIGGERS)) {
        if (discovered.length >= MAX_TOTAL_DISCOVERED) break;
        const safety = SafetyEngine.checkAction(trigger.label, trigger.selector, 'Click');
        if (!safety.safe) {
          console.log(`[Safety Intercepted] Blocked modal-reveal interaction: ${safety.reason}`);
          continue;
        }
        try {
          console.log(`[State Explorer] Opening modal via: "${trigger.label}"`);
          await page.click(trigger.selector, { timeout: 2000 });
          await page.waitForTimeout(500);
          addNew(await UiDiscovery.discover(page), { type: 'modal', triggerLabel: trigger.label, triggerSelector: trigger.selector });
          // Escape back to normal page state before trying the next trigger or exploration type.
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        } catch {
          // Click failed/timed out -- skip it, not a crawl failure.
        }
      }
    }

    for (const trigger of triggers.tabTriggers.slice(0, MAX_TAB_TRIGGERS)) {
      if (discovered.length >= MAX_TOTAL_DISCOVERED) break;
      const safety = SafetyEngine.checkAction(trigger.label, trigger.selector, 'Click');
      if (!safety.safe) {
        console.log(`[Safety Intercepted] Blocked tab-reveal interaction: ${safety.reason}`);
        continue;
      }
      try {
        console.log(`[State Explorer] Opening tab: "${trigger.label}"`);
        await page.click(trigger.selector, { timeout: 2000 });
        await page.waitForTimeout(400);
        addNew(await UiDiscovery.discover(page), { type: 'tab', triggerLabel: trigger.label, triggerSelector: trigger.selector });
      } catch {
        // Click failed/timed out -- skip it, not a crawl failure.
      }
    }

    for (const trigger of triggers.accordionTriggers.slice(0, MAX_ACCORDION_TRIGGERS)) {
      if (discovered.length >= MAX_TOTAL_DISCOVERED) break;
      const safety = SafetyEngine.checkAction(trigger.label, trigger.selector, 'Click');
      if (!safety.safe) {
        console.log(`[Safety Intercepted] Blocked accordion-reveal interaction: ${safety.reason}`);
        continue;
      }
      try {
        console.log(`[State Explorer] Expanding accordion panel: "${trigger.label}"`);
        await page.click(trigger.selector, { timeout: 2000 });
        await page.waitForTimeout(400);
        addNew(await UiDiscovery.discover(page), { type: 'accordion', triggerLabel: trigger.label, triggerSelector: trigger.selector });
      } catch {
        // Click failed/timed out -- skip it, not a crawl failure.
      }
    }

    await this.exploreInfiniteScroll(page, addNew);

    return discovered;
  }

  /**
   * One DOM pass that finds all three trigger kinds up front (before any clicking starts),
   * since opening a modal or switching a tab shouldn't invalidate selectors already computed
   * for the others.
   */
  private static async findTriggers(page: Page): Promise<StateTriggers> {
    return page.evaluate(() => {
      const isVisible = (el: Element): boolean => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return !(rect.width === 0 && rect.height === 0);
      };

      const getSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-target');
        if (testId) return `[data-testid="${testId}"]`;
        const name = el.getAttribute('name');
        let selector = el.tagName.toLowerCase();
        if (name) selector += `[name="${name}"]`;
        if (el.className) {
          const classes = el.className.toString().split(/\s+/).filter(c => c && !c.includes('{') && !c.includes(':'));
          if (classes.length > 0) selector += `.${classes.slice(0, 3).join('.')}`;
        }
        return selector;
      };

      const label = (el: Element): string => (el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim();

      // Modal triggers: strong explicit attributes (no keyword guessing needed) plus a
      // label-keyword fallback for buttons with no such attribute -- mirrors what the crawler
      // used to check for inline before this was pulled out into its own explorer.
      const modalTriggers = new Map<string, string>();
      document.querySelectorAll('[aria-haspopup="dialog"], [data-toggle="modal"], [data-bs-toggle="modal"], [data-modal-target]').forEach(el => {
        if (isVisible(el)) modalTriggers.set(getSelector(el), label(el));
      });
      document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], .btn, .button').forEach(el => {
        if (!isVisible(el)) return;
        const l = label(el).toLowerCase();
        if (/\b(add|create|open|view|show|new)\b/.test(l)) modalTriggers.set(getSelector(el), label(el));
      });

      // Tab triggers: anything tab-shaped that isn't already the active/selected one --
      // clicking the already-active tab wouldn't reveal anything new.
      const isActiveTab = (el: Element): boolean => el.getAttribute('aria-selected') === 'true' || el.classList.contains('active');
      const tabTriggers: TriggerCandidate[] = [];
      document.querySelectorAll('[role="tab"], .nav-tabs .nav-link, .tabs [role="tab"], .tab-item, .tab-button').forEach(el => {
        if (isVisible(el) && !isActiveTab(el)) tabTriggers.push({ selector: getSelector(el), label: label(el) });
      });

      // Accordion triggers: aria-expanded="false" plus the common class/data-attribute
      // patterns Bootstrap-style accordions use, so unlabeled custom accordions still match.
      const accordionTriggers: TriggerCandidate[] = [];
      document.querySelectorAll('[aria-expanded="false"], [data-toggle="collapse"], [data-bs-toggle="collapse"], .accordion-header, .accordion-toggle, .accordion-button.collapsed').forEach(el => {
        if (isVisible(el)) accordionTriggers.push({ selector: getSelector(el), label: label(el) });
      });

      return {
        modalTriggers: Array.from(modalTriggers.entries()).map(([selector, l]) => ({ selector, label: l })),
        tabTriggers,
        accordionTriggers
      };
    });
  }

  /**
   * Scrolls to the bottom of the page up to MAX_SCROLL_ITERATIONS times, stopping as soon as
   * a scroll neither grows the page nor reveals any element not already seen -- most pages
   * that aren't infinite-scroll/lazy-load will bail after the first iteration. Restores the
   * original scroll position afterward so it doesn't affect the crawl loop's next steps.
   */
  private static async exploreInfiniteScroll(page: Page, addNew: (elements: UiElement[], trigger: UiElementDiscoveryTrigger) => number): Promise<void> {
    for (let i = 0; i < MAX_SCROLL_ITERATIONS; i++) {
      const heightBefore = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(800);
      const heightAfter = await page.evaluate(() => document.body.scrollHeight);

      const trigger: UiElementDiscoveryTrigger = { type: 'infinite-scroll', triggerLabel: `scroll-${i + 1}`, triggerSelector: 'window' };
      const addedCount = addNew(await UiDiscovery.discover(page), trigger);

      // Neither the page nor the discoverable element set grew -- nothing further to gain
      // from scrolling more (guards against pages where height grows from e.g. an ad/tracker
      // reflow but no real new content actually appeared).
      if (heightAfter <= heightBefore && addedCount === 0) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}
