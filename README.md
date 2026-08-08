# Website Discovery & Knowledge Graph Builder

Crawls a target website with Playwright, discovers its pages, navigation, and
UI elements (buttons/forms/tables), and builds a knowledge base describing:

- **The page tree** — which pages exist, and the exact link/button (label +
  CSS selector) you'd click on a parent page to reach each child page.
- **Entities, actions, and relationships** — business/domain objects (e.g.
  Customer, Order — or whatever's relevant for the specific site), inferred
  by a local LLM from the crawled pages and components.
- **Workflows** — multi-step flows an AI pass infers a user could complete
  on the site, not limited to any fixed set of templates.

Results are persisted to Postgres (relational) and projected into Neo4j
(graph), and served over a small REST API with Swagger docs.

## Architecture

| Service | What it does | Port |
|---|---|---|
| `crawler-app` | Express API — queues crawl jobs, serves results, serves recorded videos/captions at `/recordings/*` | `3000` |
| `admin` | Admin backoffice (unauthenticated) — separate container/port from `crawler-app` so it can be kept off the public internet independently | `3001` |
| `crawl-worker` | Polls Postgres for `PENDING` jobs, runs the Playwright crawl, builds the knowledge graph | — |
| `workflow-agent-worker` | Polls Postgres for `PENDING` `workflow_runs`, replays a workflow's steps in a fresh headless Playwright browser, records video, writes WebVTT captions | — |
| `postgres` | Relational store: `crawl_jobs`, `pages`, `ui_elements`, `entities`, `actions`, `relationships`, `workflows`, `workflow_runs`, `knowledge_summaries` | `5432` |
| `neo4j` | Graph projection of the same knowledge, for graph queries/visualization | `7474` (browser), `7687` (bolt) |
| `llm` | Ollama, serving a small local model (`qwen2.5:3b-instruct` by default) used to summarize pages/components and infer entities/actions/relationships/workflows | `11434` |
| `extension-builder` | Build-only: bundles the Chrome extension into `extension/dist` | — |

A crawl job's life cycle: `POST /api/crawl` inserts a `PENDING` row →
`crawl-worker` picks it up, crawls with a headless browser, extracts
knowledge, writes it to Postgres + Neo4j, marks the job `COMPLETED` (or
`FAILED` with an `error_message`).

The `llm` service is used twice per crawl:
1. **Per page**: `crawl-worker` sends each page's HTML plus its
   already-discovered UI elements, and gets back a page-level
   summary/description and a per-component description. Stored on
   `pages.ai_summary` / `pages.ai_description` and
   `ui_elements.ai_description`, projected onto `:Page` and `:Component`
   (`HAS_COMPONENT`) nodes in Neo4j.
2. **Once per crawl**: after all pages are summarized, `crawl-worker` sends
   the condensed page/component summaries (not raw HTML) and asks the model
   to infer the site's entities, actions, relationships, and workflows —
   generalizing to whatever the site actually is, rather than matching
   against a fixed set of templates. Stored in `entities`, `actions`,
   `relationships`, `workflows`, `workflow_steps`, projected as `:Entity`/
   `:Action`/`:Workflow`/`:WorkflowStep` nodes in Neo4j.

Both are best-effort — a model failure/timeout logs a warning; page/component
fields are left `NULL`, and if the second pass fails, entities/actions/
relationships/workflows are simply empty for that crawl, rather than failing
the job. This means those four now depend on the `llm` service — with
`AI_SUMMARIZATION_ENABLED=false`, pages/components still crawl fine but no
entities/relationships/workflows are produced.

## Prerequisites

Just [Docker Desktop](https://www.docker.com/products/docker-desktop/) —
everything (Node, Playwright browsers, Postgres, Neo4j) runs in containers.
No local Node/npm install needed.

## Quick start

```bash
docker compose up -d
curl http://localhost:3000/health
```

Or via the included `Makefile`, which wraps the commands used throughout this
doc (build, start/stop, logs, db shell/migrate/empty/reset, the mock demo):

```bash
make help
make up
```

Open **http://localhost:3000/api-docs** for interactive Swagger UI docs of
every endpoint.

## Usage

Queue a crawl against a real site:

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com"}'
# => { "job": { "id": "...", "project_id": "...", "status": "PENDING", ... } }
```

Poll job status:

```bash
curl http://localhost:3000/api/crawl/<job-id>
```

Once `status` is `COMPLETED`, read back the results:

```bash
# Lightweight summary (domain, main entities, main workflows)
curl http://localhost:3000/api/summary/<project-id>

# Full graph: pages/entities/actions/workflows + their edges
# (e.g. HAS_PAGE edges carry {label, selector} — what to click to navigate)
curl http://localhost:3000/api/graph/<project-id>
```

Watch a crawl happen live:

```bash
docker compose logs -f crawl-worker
```

### Recording a workflow

Once a crawl is `COMPLETED` and has inferred workflows, queue a Playwright
recording of one:

```bash
curl -X POST http://localhost:3000/api/workflows/<workflow-id>/run
# => { "run": { "id": "...", "workflow_id": "...", "status": "PENDING", ... } }
```

`workflow-agent-worker` picks it up, replays the workflow's steps
(`workflow_steps`, in `step_number` order) in a fresh headless browser —
navigating to each step's page and clicking its action's selector, skipping
anything `SafetyEngine` flags as destructive — while recording video. Poll:

```bash
curl http://localhost:3000/api/workflow-runs/<run-id>
```

Once `status` is `COMPLETED`, `video_path`/`captions_path` are filenames
servable at `/recordings/*`:

```bash
open http://localhost:3000/recordings/<video_path>
```

The `.vtt` captions are generated per step from data already collected during
the crawl (each page's `ai_summary`/`ai_description`, plus the step's action
type and entity name) — no extra LLM calls at recording time.

```bash
docker compose logs -f workflow-agent-worker
```

### Admin backoffice

A dashboard over everything the service has produced lives at:

```
http://localhost:3001/admin
```

It runs as its own container (`admin`, `src/api/admin-server.ts`) on its own port,
separate from the public API (`crawler-app`, port 3000) — see below for why.

It lists every crawl request (`crawl_jobs`) newest-first with live status, and
for the selected one shows four tabs: **Overview** (job timings, extracted
counts, entities/actions, relationships, domain summary), **Knowledge graph**
(the Neo4j projection rendered as an interactive force-directed graph — drag to
pan, scroll to zoom, click a node to inspect its properties and edges, toggle
node types in the legend), **Workflows & videos** (each inferred workflow, its
steps, a *Record video* button, and every run's `.webm` with its `.vtt`
narration track inline), and **Pages** (the discovered page table with AI
descriptions).

It polls every 5 seconds, so a crawl or recording can be watched from `PENDING`
through to a playable video. It is served by the `admin` container from
`public/admin/` and reads `/api/admin/*`, `/api/graph/*` and `/recordings/*` —
all read-only except the *Record video* button, which posts to
`/api/workflows/:id/run`. The latter two endpoints are also mounted on
`crawler-app` (they're general API endpoints, not admin-only); the handlers
are shared via `src/api/graph-routes.ts` and `src/api/workflow-run-routes.ts`
so the logic isn't duplicated. **There is no authentication**: it exposes
every crawl's data, so keep port 3001 off the public internet (this is also
why it's a separate container/port from the API in the first place — so it
can be firewalled off independently of port 3000).

### Demo without a real target site

A mock CRM app (dashboard/customers/orders/settings, with modals and
tables) ships in the image for demoing without hitting a real site:

```bash
docker exec -d crawler_app node dist/mock-crm-server.js
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"http://crawler_app:4000/dashboard"}'
```

Or run the fully self-contained one-shot version (starts the mock site,
crawls it, builds the graph, prints a summary, writes
`output_schema.json`) — no job queue involved:

```bash
docker exec crawler_app npm run test:mock
```

## Configuration

Set via environment variables (see `docker-compose.yml`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` (`crawler-app`) / `3001` (`admin`) | Server port; each container sets its own |
| `DATABASE_URL` | `postgresql://crawler_user:crawler_password@localhost:5432/crawler_db` | Postgres connection string |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j bolt connection |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `crawler_neo4j_password` | Neo4j credentials |
| `OLLAMA_URL` | `http://llm:11434` | Ollama server used for AI page/component summarization |
| `OLLAMA_MODEL` | `qwen2.5:3b-instruct` | Model tag to pull and run in the `llm` service |
| `AI_SUMMARIZATION_ENABLED` | `true` | Set to `false` to skip LLM calls entirely (faster crawls, no `llm` dependency) |
| `RECORDINGS_DIR` | `/usr/src/app/recordings` | Shared volume where `workflow-agent-worker` writes videos/captions and `crawler-app` serves them from |

## Development notes

- **Playwright version is pinned and must stay matched to the Docker base
  image.** `package.json` pins `playwright` to the exact version `1.62.1`,
  and `Dockerfile`'s base image is `mcr.microsoft.com/playwright:v1.62.1-jammy`.
  If either drifts independently, `chromium.launch()` fails because the
  browser binaries baked into the base image won't match the installed npm
  package.
- **Don't run crawl code via `tsx` directly.** The `worker:crawl`,
  `worker:record`, and `test:mock` npm scripts build (`tsc`) and then run the
  compiled `dist/` output rather than `.ts` files directly. Running crawl
  code through `tsx` throws `ReferenceError: __name is not defined` inside
  `page.evaluate()` — `tsx`'s esbuild transform injects a `__name()` helper
  for named functions, and Playwright serializes the `evaluate()` callback
  to run inside the browser, where that helper doesn't exist.
- Rebuild after code changes: `docker compose up -d --build`.
- **First `docker compose up -d` pulls the LLM model** (~2GB for
  `qwen2.5:3b-instruct`) into the `llm` container the first time it starts —
  give it a few minutes before crawls will pick up AI summaries; check
  progress with `docker compose logs -f llm`. AI enrichment runs
  synchronously per page during the crawl and adds latency per page; disable
  it with `AI_SUMMARIZATION_ENABLED=false` if you want faster crawls or
  don't want to run the `llm` service at all.

## Project structure

```
src/
  agent/          LLM orchestrator + Playwright tool surface used when replaying
                  a workflow for recording
  api/            Express app (server.ts) + standalone admin server
                  (admin-server.ts), routes (incl. admin-routes.ts), OpenAPI spec
  config/         Postgres pool + Neo4j driver setup
  crawler/        Playwright-driven crawl loop
  discovery/      Page metadata, navigation links, UI element discovery
  graph/          Neo4j projection of the relational knowledge model
  knowledge/      Orchestrates persistence + AI extraction
  llm/            Ollama client + AI page/component summarization and
                  entity/action/relationship/workflow extraction
  safety/         Blocks risky interactions (e.g. destructive button clicks)
  workers/        Background job processors (crawl, demo planning)
  types/          Shared TypeScript types
public/
  admin/          Admin backoffice page (static, served by the `admin`
                  container at /admin, port 3001)
init.sql          Postgres schema
docker-compose.yml
Dockerfile
extension/        Chrome side-panel extension (see below)
```

## Chrome extension

`extension/` is a Manifest V3 Chrome extension with a HUD-style ("Narreto") side
panel: click the toolbar icon, it targets the active tab's URL, POSTs to
`/api/crawl`, and while the job runs shows a Three.js animation of neurons
firing across tumbling rings. Once the job hits `COMPLETED`, it fetches
`/api/graph/:projectId` and renders the discovered page tree plus a one-line,
selectable list of inferred workflows.

It's a browser UI, not a server, so it doesn't run as a long-lived container.
`extension-builder` in `docker-compose.yml` bundles `extension/src` (TypeScript
+ Three.js, via esbuild) into `extension/dist` and exits:

```bash
make extension          # or: docker compose build extension-builder && docker compose run --rm extension-builder
make extension-watch    # same, but rebuilds on every change to extension/src
```

Then load it in Chrome: `chrome://extensions` → enable *Developer mode* →
*Load unpacked* → select `extension/dist`. Requires `crawler-app` running at
`http://localhost:3000` (declared in `host_permissions`). Re-run `make
extension` after editing `extension/src/*` — the builder image copies the source
in at image-build time, so the image has to be rebuilt, which `make extension`
does for you.

## Teardown

```bash
docker compose down        # stop, keep data volumes
docker compose down -v     # stop and wipe Postgres/Neo4j data
```
