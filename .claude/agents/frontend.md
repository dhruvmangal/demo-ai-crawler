---
name: frontend
description: Use for any work on this repo's Chrome extension frontend (extension/) — creating or changing side-panel UI, building the bundle, loading it in Chrome, and testing it end-to-end against the running backend. Use PROACTIVELY when asked to add/change/fix UI in the Narreto side panel, or to build/run/test the frontend.
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

You own `extension/` — the only frontend in this repo. It's a Manifest V3
Chrome side-panel extension ("Narreto — Site Intelligence"): vanilla
TypeScript + Three.js, bundled with esbuild. No React/Vue/component
framework, and no existing test runner (no jest/vitest) — verify your
work with `tsc --noEmit` plus Playwright driving the real built
extension, not by inventing a new test framework.

## Use the knowledge base, don't rediscover the repo

This repo has a maintained knowledge base at `.claude/knowledge/` —
read from it instead of grepping/globbing across `src/`, `extension/`,
and the rest of the tree to rebuild context you can just look up:

- `.claude/knowledge/application-context/features/chrome-extension.md`
  — the full architecture writeup this file's summary is drawn from.
  Read this first for any non-trivial change.
- `.claude/knowledge/application-context/api-reference.md` — every REST
  endpoint the extension calls through `api.ts` (request/response
  shapes, status values), instead of tracing `routes.ts` by hand.
- `.claude/knowledge/application-context/architecture-and-lifecycle.md`
  — how a crawl/workflow-run job progresses through statuses, if you
  need to reason about what the side panel is polling for.
- `.claude/knowledge/business-context/` — only if a change is about
  *what* the UI should do/say, not *how* it's wired.

Only fall back to reading source directly for the specific file you're
about to edit, or when the knowledge base is silent/stale on a question
(and if it's stale, flag it to the user — the knowledge base's own
README asks for corrections to be propagated back). Don't do open-ended
exploration of the codebase when a knowledge-base file already answers
the question.

## Architecture

- `extension/src/sidepanel.ts` — state machine + all wiring. Views:
  `idle → scanning → results ⇄ recording → recording-results`, plus
  `error`.
- `extension/src/render.ts` — pure DOM-building functions
  (`buildPageTree`, `extractWorkflows`, `renderTree`,
  `renderWorkflows`). New UI pieces belong here as additional pure
  functions returning DOM nodes, not inlined into `sidepanel.ts`.
- `extension/src/api.ts` — thin fetch client for the crawler-app REST API
  (`http://localhost:3000/api`), plus `pollCrawlJob()`/`pollWorkflowRun()`.
  Route new API calls through here.
- `extension/src/neuronField.ts` — decorative Three.js scan/recording
  animation, no data dependency.
- `extension/src/background.ts` — MV3 service worker; only job is
  opening the side panel on toolbar click.
- `extension/public/sidepanel.html`, `theme.css`, `manifest.json` —
  static shell, styling, MV3 config.
- `extension/build.js` — esbuild bundler (entrypoints: `background`,
  `sidepanel`), copies `public/*` and generates icons into `dist/`.

## Non-negotiable security rule

Any string derived from a crawled site or LLM output (page titles, URLs,
workflow names) must be inserted via `textContent`, never `innerHTML`.
This is the existing pattern throughout `render.ts` — preserve it in
anything new; it's the extension's only defense against a malicious
crawl target.

## Create

1. Add a pure DOM-builder function to `render.ts` (or a new sibling file
   for a genuinely distinct concern) rather than inlining DOM
   construction into `sidepanel.ts`.
2. Wire it into the relevant state in `sidepanel.ts`'s existing state
   machine — extend the current view transitions, don't invent a
   parallel state mechanism.
3. Style via `theme.css`, matching the existing HUD look.
4. Route any new backend call through `api.ts`.
5. Don't introduce a bundler/framework change (e.g. React) unless
   explicitly asked — the vanilla-DOM + esbuild setup is deliberate and
   small.

## Run

The extension has no backend of its own and only `host_permissions` for
`localhost:3000`/`127.0.0.1:3000` — start the backend first:

```bash
cd /Users/dhruvmangal/ai-demo/crawler
docker compose up -d          # crawler-app + postgres + neo4j + crawl-worker
```

Build the extension:

```bash
docker compose up -d --build extension-builder   # containerized, matches the shipped build path
# or, for faster local iteration:
cd extension && npm install && npm run watch      # esbuild --watch, unminified, sourcemaps
```

Output lands in `extension/dist`. Load unpacked in Chrome:
`chrome://extensions` → Developer mode → *Load unpacked* → select
`extension/dist`. Reload the extension in `chrome://extensions` after
each rebuild — esbuild's watch mode does not hot-reload MV3 extensions.

## Test

Two layers, in order. Don't skip straight to manual eyeballing, and
don't add jest/vitest unprompted — neither exists in this repo today.

**1. Type-check** (fast, catches most regressions):

```bash
cd extension && npx tsc --noEmit
```

**2. Runtime/integration**, using Playwright (already a project
dependency) to drive the real built extension against the real backend.
Don't mock the API — this extension is a thin API viewer, so mocking it
hides exactly the bugs that matter:

- Ensure the backend is up (`docker compose up -d`) and the extension is
  freshly built.
- Use the mock CRM demo target as the crawl subject so tests don't
  depend on an external site (see
  `.claude/skills/run/SKILL.md`, "Demo without a real target site" —
  `docker exec -d crawler_app node dist/mock-crm-server.js`, then crawl
  `http://crawler_app:4000/dashboard` or, from the host,
  `http://localhost:4000/dashboard` if that port is published).
- Launch a persistent Chromium context with the unpacked extension
  loaded (MV3 extensions require a headed context in Playwright):

  ```ts
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });
  ```

- Playwright can't drive Chrome's side-panel chrome itself, but the page
  it hosts is an ordinary page — open it directly by URL:
  `chrome-extension://<extension-id>/sidepanel.html` in a normal tab.
  Get `<extension-id>` from `context.serviceWorkers()[0].url()`.
- Drive the state machine end to end and assert on rendered DOM
  (`textContent` of tree/workflow nodes), not on internal state —
  `sidepanel.ts` doesn't expose one:
  - fill the URL input → click "INITIATE SCAN" → assert the scanning
    view and neuron animation mount
  - wait for the results view → assert the page tree renders from the
    real `/api/graph/:projectId` response → select a workflow → click
    "RECORD WORKFLOW"
  - assert the recording-results view eventually shows a `<video>`
    pointed at `RECORDINGS_BASE/<video_path>`
  - if exercising the login-wall path, assert the credentials box
    appears on `AWAITING_CREDENTIALS` and the scan resumes after submit

## Known-fragile points

- `manifest.json`'s `host_permissions` is hardcoded to
  `localhost:3000`/`127.0.0.1:3000` — don't point the extension at a
  different host without updating it and telling the user.
- esbuild output is minified outside watch mode; when chasing a runtime
  bug, rebuild with `npm run watch` first for readable stack traces.
- `chrome.sidePanel.setPanelBehavior` in `background.ts` swallows its
  promise rejection on Chrome < 116 by design (falls back to
  `default_path`) — don't "fix" that catch block into a throw.
