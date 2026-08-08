# Chrome Extension — "Narreto — Site Intelligence"

Source: `extension/` (separate npm project, esbuild-bundled). A Manifest
V3 side-panel UI over the main service's REST API — it has no backend of
its own and holds no crawl state beyond what it polls from
`crawler-app`.

## Build & load

`extension-builder` (a Docker Compose service) bundles `extension/src/*`
(TypeScript + Three.js) into `extension/dist` via esbuild
(`extension/build.js`) and exits — it's build-only, not a running
container. Rebuild after source changes: `docker compose up -d --build
extension-builder`. Load unpacked in Chrome:
`chrome://extensions` → Developer mode → *Load unpacked* → select
`extension/dist`. Requires `crawler-app` reachable at
`http://localhost:3000` (the only `host_permissions` entry in
`manifest.json`) — the extension will not work against a differently
hosted deployment without editing the manifest.

## Files

- **`manifest.json`** — MV3, `sidePanel` + `activeTab` + `storage`
  permissions, `background.js` service worker, `sidepanel.html` as the
  panel entrypoint.
- **`background.ts`** — one job: `chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true })` so clicking the toolbar icon opens the
  side panel directly rather than a popup. Falls back silently on
  Chrome < 116 (the promise rejection is swallowed; `default_path` in the
  manifest still makes `chrome.action` open the panel on older Chrome).
- **`api.ts`** — thin `fetch` client for the main service's REST API
  (`API_BASE = http://localhost:3000/api`, `RECORDINGS_BASE = .../recordings`).
  Includes `pollCrawlJob()`/`pollWorkflowRun()` — simple recursive
  `setTimeout` polling (2s interval) that calls back on every update and
  stops itself once status is terminal (`COMPLETED`/`FAILED`), swallowing
  transient network errors mid-poll rather than aborting.
- **`render.ts`** — pure functions turning a `GraphResponse` (from
  `GET /api/graph/:projectId`) into UI: `buildPageTree()` walks `:Page`
  nodes + `HAS_PAGE` edges into a tree (roots = pages that never appear as
  a `HAS_PAGE` target); `extractWorkflows()` pulls `:Workflow` nodes
  sorted by confidence descending; `renderTree()`/`renderWorkflows()`
  build the actual DOM (using `textContent`, never `innerHTML`, for any
  crawled-site-derived or LLM-derived string — page titles/URLs and
  workflow names are untrusted input from whatever site was crawled).
- **`neuronField.ts`** — a Three.js particle/ring animation shown during
  active scanning/recording; purely decorative, no data dependency.
- **`sidepanel.ts`** — the state machine and all wiring; see below.

## UI state machine (`sidepanel.ts`)

Views: `idle → scanning → results ⇄ recording → recording-results`, plus
an `error` view reachable from `scanning` or `recording`.

- **idle**: URL input pre-filled from the active tab's URL
  (`getActiveTabUrl()`, restricted to `http(s)://`). "INITIATE SCAN" →
  `startCrawl()` + begins polling.
- **scanning**: shows the neuron animation and a status label per crawl
  status (`STATUS_LABEL` map). If status becomes `AWAITING_CREDENTIALS`,
  reveals a username/password box (`submitCredentials()`); on success
  just hides the box and keeps polling — no explicit "submitted" message.
- **results**: on `COMPLETED`, fetches the graph and renders the page
  tree + a clickable workflow list. Selecting a workflow stores
  `{id, name}` in `chrome.storage.local` under
  `selectedWorkflow:<projectId>` (persisted for the session, though
  nothing currently reads it back on reload) and reveals "RECORD
  WORKFLOW".
- **recording / recording-results**: mirrors the scanning flow for
  `POST /api/workflows/:id/run` + `pollWorkflowRun()`; on `COMPLETED`,
  points a `<video>` element at `RECORDINGS_BASE/<video_path>` and
  attaches a `<track kind="captions">` at `RECORDINGS_BASE/<captions_path>`
  if present.
- **error**: shows `job.error_message` / `run.error_message` verbatim (or
  a generic fallback), with a retry/back path depending on which flow
  failed.

No component of the extension writes to the crawl target site or
performs any action beyond the REST calls above — it's purely a viewer
and trigger for the backend pipeline described in
[../architecture-and-lifecycle.md](../architecture-and-lifecycle.md).
