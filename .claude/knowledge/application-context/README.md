# Application Context

How the system is actually built: services, data model, APIs, and the
mechanics of every feature. Read this layer when you need to change code,
debug a failure, or understand *how* something works.

(For *why* it works this way and who it's for, see
[../business-context/README.md](../business-context/README.md).)

## System in one paragraph

`website-discovery-knowledge-graph-builder` is a Docker Compose stack that
crawls a target website with Playwright, discovers its pages/navigation/UI
elements, uses a local LLM (Ollama) to summarize what it found and infer
business entities/actions/relationships/workflows, persists all of it to
Postgres, projects it into Neo4j as a graph, and serves it over a REST API.
A second feature — independent of the crawl — lets a Claude-driven browser
agent replay one of the inferred workflows in a fresh headless browser,
recording a narrated demo video with WebVTT captions.

## Services (docker-compose.yml)

| Service | Role | Port(s) |
|---|---|---|
| `crawler-app` | Express API: queues crawls, serves results, serves `/recordings/*` | 3000 |
| `crawl-worker` | Polls Postgres for `PENDING` `crawl_jobs`, runs the crawl + knowledge build | — |
| `workflow-agent-worker` | Polls Postgres for `PENDING` `workflow_runs`, replays workflow steps via a Claude agent, records video | — |
| `postgres` | Relational store, schema in `init.sql` | 5432 |
| `neo4j` | Graph projection for graph queries/visualization | 7474 (browser), 7687 (bolt) |
| `llm` | Ollama (`qwen2.5:3b-instruct` by default) — page/component summaries + entity/workflow inference | 11434 |
| `extension-builder` | Build-only: bundles the Chrome extension, then exits | — |

All four long-running Node services (`crawler-app`, `crawl-worker`,
`workflow-agent-worker`) are built from the same image (`Dockerfile`); which
one runs is just the container `command`.

## Map of this layer

- [architecture-and-lifecycle.md](architecture-and-lifecycle.md) — request/job lifecycle end to end, how the pieces call each other
- [data-model.md](data-model.md) — Postgres schema (`init.sql`), every table and why it exists
- [graph-model.md](graph-model.md) — Neo4j node/edge projection (`graph-projection.ts`)
- [api-reference.md](api-reference.md) — every REST endpoint (`routes.ts`, `openapi.json`)
- [configuration-and-deployment.md](configuration-and-deployment.md) — env vars, Docker specifics, known-fragile points
- `features/` — one file per functional area, each grounded in the source file(s) that implement it:
  - [crawling-and-discovery.md](features/crawling-and-discovery.md) — `PlaywrightCrawler`, `PageDiscovery`, `NavigationDiscovery`, `UiDiscovery`
  - [login-handling.md](features/login-handling.md) — login-wall detection, `AWAITING_CREDENTIALS`, credential handoff
  - [knowledge-extraction-llm.md](features/knowledge-extraction-llm.md) — `PageSummarizer`, `KnowledgeExtractor`, `OllamaClient`
  - [knowledge-building-persistence.md](features/knowledge-building-persistence.md) — `KnowledgeBuilder` orchestration
  - [knowledge-summarization.md](features/knowledge-summarization.md) — `KnowledgeSummarizer` lightweight domain summary
  - [workflow-recording-agent.md](features/workflow-recording-agent.md) — `WorkflowOrchestrator`, `browser-tools.ts`, `WorkflowRecorder`, `caption-builder.ts`
  - [safety-engine.md](features/safety-engine.md) — `SafetyEngine` destructive-action blocking
  - [chrome-extension.md](features/chrome-extension.md) — the Narreto side panel
  - [mock-demo-environment.md](features/mock-demo-environment.md) — `mock-crm-server.ts`, `test-crawler.ts`

## Source tree reference

```
src/
  api/            Express app, routes, OpenAPI spec
  config/         Postgres pool + Neo4j driver singletons
  crawler/        Playwright-driven crawl loop (playwright-crawler.ts)
  discovery/      Page metadata, navigation links, UI element discovery
  graph/          Neo4j projection of the relational knowledge model
  knowledge/      Orchestrates persistence + AI extraction + summarization
  llm/            Ollama client + page/component summarization + entity extraction
  agent/          Claude-driven browser agent (workflow replay) + its tool surface
  recorder/       Video recording + WebVTT caption generation for workflow runs
  safety/         Blocks risky interactions (e.g. destructive button clicks)
  workers/        Background job processors (crawl-worker, workflow-agent-worker)
  types/          Shared TypeScript types
  mock-crm-server.ts   Standalone demo target app
  test-crawler.ts      One-shot self-contained crawl test (no job queue)
init.sql          Postgres schema
docker-compose.yml / Dockerfile
extension/        Chrome side-panel extension (separate npm project, esbuild)
```
