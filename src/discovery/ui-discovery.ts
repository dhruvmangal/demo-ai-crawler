import { Page } from 'playwright';
import { UiElement, UiElementType } from '../types/pages';

export class UiDiscovery {
  /**
   * Scans the active page for interactive UI components.
   */
  public static async discover(page: Page): Promise<UiElement[]> {
    return page.evaluate(() => {
      const elements: UiElement[] = [];

      // Helper to generate a simple selector
      const getSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        let selector = el.tagName.toLowerCase();
        if (el.className) {
          const classes = el.className.toString().split(/\s+/).filter(c => c && !c.includes('{') && !c.includes(':'));
          if (classes.length > 0) {
            selector += `.${classes.slice(0, 3).join('.')}`;
          }
        }
        // Add attribute identifiers if available
        const nameAttr = el.getAttribute('name');
        if (nameAttr) selector += `[name="${nameAttr}"]`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-target');
        if (testId) return `[data-testid="${testId}"]`;

        return selector;
      };

      // 1. Detect Dialogs/Modals
      const dialogSelectors = [
        'dialog', '[role="dialog"]', '.modal', '.popup', '.dialog', '.side-panel', '.drawer', '.aside-panel'
      ];
      dialogSelectors.forEach(sel => {
        const dialogs = document.querySelectorAll(sel);
        dialogs.forEach(dialog => {
          const style = window.getComputedStyle(dialog);
          if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            const titleEl = dialog.querySelector('h1, h2, h3, .modal-title, .dialog-title');
            const label = (titleEl?.textContent || dialog.getAttribute('aria-label') || 'Dialog/Modal').trim();
            elements.push({
              pageId: '', // To be filled by knowledge builder
              type: 'dialog',
              label,
              selector: getSelector(dialog),
              role: 'dialog',
              confidence: 0.95,
              metadata: {
                visible: true,
                innerButtons: Array.from(dialog.querySelectorAll('button')).map(b => (b.innerText || '').trim())
              }
            } as any);
          }
        });
      });

      // 2. Detect Forms
      const forms = document.querySelectorAll('form, [role="form"], .form-container');
      forms.forEach(form => {
        const titleEl = form.querySelector('h1, h2, h3, .form-title, legend');
        const label = (titleEl?.textContent || form.getAttribute('aria-label') || form.getAttribute('name') || 'Generic Form').trim();
        
        // Extract fields inside form
        const fields: any[] = [];
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
          const name = input.getAttribute('name') || input.id || '';
          const type = input.getAttribute('type') || input.tagName.toLowerCase();
          
          // Try to find label
          let fieldLabel = '';
          if (input.id) {
            const labelEl = document.querySelector(`label[for="${input.id}"]`);
            if (labelEl) fieldLabel = (labelEl.textContent || '').trim();
          }
          if (!fieldLabel) {
            const parentLabel = input.closest('label');
            if (parentLabel) fieldLabel = (parentLabel.textContent || '').trim();
          }
          if (!fieldLabel) {
            fieldLabel = input.getAttribute('placeholder') || input.getAttribute('aria-label') || name;
          }

          fields.push({
            name,
            label: fieldLabel.trim(),
            type,
            required: input.hasAttribute('required'),
            pattern: input.getAttribute('pattern') || undefined,
            placeholder: input.getAttribute('placeholder') || undefined
          });
        });

        elements.push({
          pageId: '',
          type: 'form',
          label,
          selector: getSelector(form),
          role: 'form',
          confidence: 0.95,
          metadata: {
            fields
          }
        } as any);
      });

      // 3. Detect Tables
      const tables = document.querySelectorAll('table, .table, [role="table"], .grid-container');
      tables.forEach(table => {
        const titleEl = table.previousElementSibling?.tagName.startsWith('H') ? table.previousElementSibling : null;
        const label = (titleEl?.textContent || table.getAttribute('aria-label') || 'Data Table').trim();

        // Extract Columns
        const columns: string[] = [];
        const headers = table.querySelectorAll('th, .table-header, [role="columnheader"]');
        headers.forEach(h => {
          const text = (h.textContent || '').trim();
          if (text) columns.push(text);
        });

        // Extract Row Actions (e.g. edit, delete, view buttons inside table body cells)
        const rowActions: string[] = [];
        const cells = table.querySelectorAll('td, .table-cell');
        cells.forEach(cell => {
          const buttons = cell.querySelectorAll('button, a.btn, a.button');
          buttons.forEach(btn => {
            const text = (btn.textContent || '').trim();
            if (text && !rowActions.includes(text) && text.length < 30) {
              rowActions.push(text);
            }
          });
        });

        elements.push({
          pageId: '',
          type: 'table',
          label,
          selector: getSelector(table),
          role: 'table',
          confidence: 0.90,
          metadata: {
            columns,
            rowActions
          }
        } as any);
      });

      // 4. Detect Buttons
      const buttons = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], .btn, .button');
      buttons.forEach(btn => {
        // Skip links that are already processed or layout tags
        if (btn.closest('nav') || btn.closest('aside') || btn.closest('.sidebar') || btn.closest('#sidebar')) {
          return;
        }
        const label = (btn.textContent || (btn as HTMLInputElement).value || '').trim();
        if (label && label.length > 0 && label.length < 50) {
          // Check if this button is inside a form or table, we still record it but mark association
          const parentForm = btn.closest('form');
          const parentTable = btn.closest('table');
          elements.push({
            pageId: '',
            type: 'button',
            label,
            selector: getSelector(btn),
            role: 'button',
            confidence: 0.85,
            metadata: {
              formId: parentForm ? getSelector(parentForm) : undefined,
              tableId: parentTable ? getSelector(parentTable) : undefined
            }
          } as any);
        }
      });

      return elements;
    });
  }
}
