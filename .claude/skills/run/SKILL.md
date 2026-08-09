---
name: run
description: Launch this website-discovery/knowledge-graph crawler app (Postgres + Neo4j + Express API + Playwright worker) via docker compose, and drive it with a real crawl.
---

# Running the crawler app

This is `website-discovery-knowledge-graph-builder`: an Express API
(`crawler_app`, port 3000) backed by Postgres (`crawler_postgres`,
port 5432) and Neo4j (`crawler_neo4j`, ports 7474/7687), plus a
background `crawl-worker` container that polls Postgres for queued
jobs, crawls the target site with Playwright, extracts UI
elements/entities/workflows, and projects a knowledge graph into
Neo4j.

No local Node/npm is required — everything runs in Docker. The host
only needs Docker Desktop running.

## Launch

```bash
cd /Users/dhruvmangal/ai-demo/crawler
docker compose up -d
```

This builds (first time) and starts all four services: `postgres`,
`neo4j`, `crawler-app` (API), `crawl-worker` (background job
processor). Rebuild after code changes with `docker compose up -d --build`.

Verify:

```bash
curl http://localhost:3000/health
```

## Drive it: queue a real crawl

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com"}'
```

Returns `job.id` and `job.project_id`. The `crawl-worker` container
picks it up within its 5s poll interval — watch it live:

```bash
docker compose logs -f crawl-worker
```

Poll job status, then fetch results once `status` is `COMPLETED`:

```bash
curl http://localhost:3000/api/crawl/<job-id>
curl http://localhost:3000/api/summary/<project-id>
curl http://localhost:3000/api/graph/<project-id>
curl http://localhost:3000/api/auth/users
curl http://localhost:3000/api/auth/stats
```

## Database migrations and seeders

```bash
docker exec crawler_app npm run db:migrate
docker exec crawler_app npm run db:seed
```

## Demo without a real target site

A mock CRM app (dashboard/customers/orders/settings pages) ships in
the image for demoing without hitting a real site:

```bash
docker exec -d crawler_app node dist/mock-crm-server.js
curl -X POST http://localhost:3000/api/crawl \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"http://crawler_app:4000/dashboard"}'
```

Or run the fully self-contained one-shot version (starts the mock
site, crawls it, builds the graph, prints a summary, writes
`output_schema.json`) — no Postgres job queue involved:

```bash
docker exec crawler_app npm run test:mock
```

## Known-fragile points (already fixed, don't reintroduce)

- **Playwright version must stay pinned and matched.** `package.json`
  pins `playwright` to the exact version `1.62.1`, and
  `Dockerfile`'s base image is `mcr.microsoft.com/playwright:v1.62.1-jammy`.
  If either drifts (e.g. someone widens the semver range or bumps
  one but not the other), `chromium.launch()` fails with "Executable
  doesn't exist" because the browser binaries baked into the base
  image won't match the installed `playwright` npm package.
- **Don't run crawl code via `tsx` directly.** `npx tsx
  src/test-crawler.ts` (or `worker:crawl`/`worker:record` if they're
  ever changed back to invoke `.ts` files directly) throws
  `ReferenceError: __name is not defined` inside
  `page.evaluate()` — `tsx`'s esbuild transform injects a `__name()`
  helper for named functions, and Playwright serializes the
  `evaluate()` callback to run in the browser, where that helper
  doesn't exist. `npm run build && node dist/...` (what
  `worker:crawl`/`worker:record`/`test:mock` do now) avoids this since
  `tsc` doesn't inject that helper.

## Teardown

```bash
docker compose down        # stop, keep data volumes
docker compose down -v     # stop and wipe Postgres/Neo4j data
```
