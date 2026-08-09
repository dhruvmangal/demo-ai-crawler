---
name: demo-script-generator
description: Turn a finished, live-verified caption list (from demo-caption-writer) into a plain Playwright Node script that performs each captioned step against a real browser, using resilient selectors and content-proportional dwell times. Use only after captions are written and verified, never before.
---

# Generating a Playwright script from finished captions

By the time this skill applies, the caption list is already done and
every interactive step in it has been live-verified (`demo-caption-writer`).
This skill is purely mechanical: turn that finished list into working
code. Don't re-decide what to show here -- that decision already happened.

## Use plain `playwright`, never `@playwright/test`

```js
const { chromium } = require('playwright');
```

`@playwright/test` is not a dependency of this project, and adding it
risks the version-pin drift `.claude/skills/run/SKILL.md` warns about
(`package.json`'s `playwright` is pinned to the exact version matching
the Dockerfile's `mcr.microsoft.com/playwright:vX-jammy` base image).
`@playwright/test` also wants to own browser/context lifecycle itself via
its own CLI runner -- the opposite of what a single continuous recorded
session needs (see `demo-recorder`).

## One step = one function

For each caption, write an `async (page) => { ... }` step function that
performs exactly the interaction(s) that caption's live verification
confirmed -- nothing more. Keep steps in the same order as the caption
list; step numbering must match 1:1 so captions and code stay traceable
to each other.

## Selector rules

- Prefer role/accessible-name locators (`page.getByRole('button', {
  name: 'Create Customer' })`) or `page.getByRole('link', { name: '...',
  exact: true })`, then `data-testid`, then explicit `id`, before falling
  back to class/positional selectors.
- Use the *specific* selector `demo-caption-writer` verified, not the raw
  stored hint from `crawler-knowledge-lookup`.
- If a locator could match more than one element on the page (common on
  pages with repeated components, e.g. several code blocks each with
  their own tab group), scope it explicitly (e.g. `.first()` only after
  confirming that's actually the right instance, or a more specific
  parent-scoped locator) rather than hoping the first match is correct.
- `page.fill()` sets a value directly; it does not simulate real
  keystrokes. That's fine for this use case (populating a demo form) --
  don't reach for slower keystroke-by-keystroke typing unless a caption
  specifically calls for showing typing happen.

## Never generate a destructive action

If a step's action matches `SafetyEngine`'s keyword list (see
`demo-caption-writer` for the exact list), it should never have survived
caption-writing as an action in the first place -- if you notice one here
anyway, that's a bug in the caption list, not something to code around.
Stop and go back to `demo-caption-writer` rather than writing the click.

## Dwell time belongs to the recorder, not here

Don't hardcode a single flat dwell duration into the script itself --
`demo-recorder` applies a generous, per-step, content-proportional dwell
(roughly 2500-4000ms depending on what the step shows) after each step
function returns. Your job here is just the step functions themselves.

## Where the script actually runs

Playwright/Chromium isn't installed on the host in this environment --
run scripts inside a container that already has it. `crawler-app`,
`admin`, `crawl-worker`, and `workflow-agent-worker` all build from the
same Dockerfile (`mcr.microsoft.com/playwright:v1.62.1-jammy`, matching
`package.json`'s pinned `playwright` version), so any of them works:

```bash
docker cp <local-script>.js crawler_app:/usr/src/app/<script>.js
docker exec crawler_app node /usr/src/app/<script>.js
docker exec crawler_app rm -f /usr/src/app/<script>.js   # clean up after
```

The recordings volume (`/usr/src/app/recordings` inside every container)
is shared, so writing output there from any of them makes it show up at
`http://localhost:3000/recordings/<file>` regardless of which container
ran the script.
