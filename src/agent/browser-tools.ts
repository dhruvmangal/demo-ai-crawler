import Anthropic from '@anthropic-ai/sdk';
import { Page } from 'playwright';
import { UiDiscovery } from '../discovery/ui-discovery';

/**
 * A Playwright-MCP-style tool surface: the same action vocabulary Microsoft's
 * @playwright/mcp server exposes (navigate/click/type/snapshot), implemented as
 * direct Claude tool definitions against a real Playwright Page rather than a
 * separate MCP server process. Swapping in the real @playwright/mcp package later
 * (e.g. to share it with other MCP clients) is a drop-in replacement for this file.
 *
 * Used by ScriptHealer (src/agent/script-healer.ts), the one remaining live-page,
 * LLM-driven phase -- generation itself is handled by DeterministicScriptEngine, which
 * needs no browser or LLM. ScriptHealer defines its own locally-scoped "finish" tool
 * (finish_heal) with a shape specific to what it produces, rather than a shared generic
 * one.
 */
export const BROWSER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to.' }
      },
      required: ['url']
    }
  },
  {
    name: 'click',
    description: 'Click an element identified by a CSS selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click.' }
      },
      required: ['selector']
    }
  },
  {
    name: 'type',
    description: 'Type text into an input element identified by a CSS selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input element.' },
        text: { type: 'string', description: 'Text to type into the element.' }
      },
      required: ['selector', 'text']
    }
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key, e.g. "Enter" or "Escape".',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press, e.g. "Enter".' }
      },
      required: ['key']
    }
  },
  {
    name: 'read_page_elements',
    description: 'Read the interactive elements currently visible on the page (buttons, forms, inputs, tables) with their type, label, and selector. Use this if a known selector fails, or to find the right element to act on.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'wait',
    description: 'Wait for a number of milliseconds, e.g. to let a page or animation settle.',
    input_schema: {
      type: 'object',
      properties: {
        milliseconds: { type: 'number', description: 'How long to wait, in milliseconds.' }
      },
      required: ['milliseconds']
    }
  }
];

/** Executes one non-"finish" browser tool call against a live Playwright page. */
export async function executeBrowserTool(page: Page, name: string, input: any): Promise<string> {
  switch (name) {
    case 'navigate':
      await page.goto(input.url, { waitUntil: 'domcontentloaded' });
      return `Navigated to ${input.url}`;
    case 'click':
      await page.click(input.selector, { timeout: 5000 });
      return `Clicked ${input.selector}`;
    case 'type':
      await page.fill(input.selector, input.text);
      return `Typed into ${input.selector}`;
    case 'press_key':
      await page.keyboard.press(input.key);
      return `Pressed ${input.key}`;
    case 'read_page_elements': {
      const elements = await UiDiscovery.discover(page);
      return JSON.stringify(elements.map(e => ({ type: e.type, label: e.label, selector: e.selector })));
    }
    case 'wait':
      await page.waitForTimeout(input.milliseconds);
      return `Waited ${input.milliseconds}ms`;
    default:
      return `Unknown tool: ${name}`;
  }
}
