# Configuration & Deployment

## Environment variables

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PORT` | `3000` | crawler-app | API server port |
| `DATABASE_URL` | `postgresql://crawler_user:crawler_password@localhost:5432/crawler_db` | all Node services | Postgres connection string |
| `NEO4J_URI` | `bolt://localhost:7687` | crawler-app, crawl-worker | Neo4j bolt connection |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `crawler_neo4j_password` | crawler-app, crawl-worker | Neo4j credentials |
| `OLLAMA_URL` | `http://localhost:11434` | crawl-worker | Ollama server for page/component summarization + entity extraction |
| `OLLAMA_MODEL` | `qwen2.5:3b-instruct` | crawl-worker, `llm` service | model tag to pull and query |
| `AI_SUMMARIZATION_ENABLED` | `true` | crawl-worker | `false` skips both Ollama call sites entirely — faster crawls, no `llm` dependency, but pages/entities/workflows get no AI enrichment |
| `RECORDINGS_DIR` | `/usr/src/app/recordings` | crawler-app (serves), workflow-agent-worker (writes) | shared volume for video/captions |
| `ANTHROPIC_API_KEY` | — | workflow-agent-worker | required for `WorkflowOrchestrator` (Claude agent); read from shell env or `.env` at the Compose level, passed through `${ANTHROPIC_API_KEY:-}` |

Postgres/Neo4j credentials are also injected as Docker Compose service
`environment:` for `postgres`/`neo4j` themselves — see `docker-compose.yml`
for the literal values (`crawler_user`/`crawler_password`,
`neo4j`/`crawler_neo4j_password`). These are demo/dev credentials baked
into the compose file, not secrets management.

## Docker Compose topology

Long-running services (`crawler-app`, `crawl-worker`,
`workflow-agent-worker`) all `build: .` from the same `Dockerfile` —
they differ only in `command`. `extension-builder` builds from
`./extension` and exits after producing `extension/dist`.

Volumes: `pgdata`, `neo4jdata`, `neo4jlogs`, `ollamadata` (persistence),
`recordings` (shared between `crawler-app` and `workflow-agent-worker`).

`llm`'s entrypoint runs `ollama serve`, waits for it to be ready, pulls
`OLLAMA_MODEL`, then waits forever — with a healthcheck polling
`ollama list | grep -q "$OLLAMA_MODEL"`. First boot pulls ~2GB.

## Known-fragile points (don't reintroduce these bugs)

1. **Playwright version must stay pinned and matched to the base image.**
   `package.json` pins `playwright` to the *exact* version `1.62.1`
   (no `^`), and `Dockerfile`'s base image is
   `mcr.microsoft.com/playwright:v1.62.1-jammy`. If either drifts
   independently, `chromium.launch()` fails with "Executable doesn't
   exist" because the browser binaries baked into the base image won't
   match the installed npm package. Bump both together, always.

2. **Never run crawl code via `tsx` directly.** `npx tsx
   src/test-crawler.ts` (or hand-editing `worker:crawl`/`worker:record` to
   invoke `.ts` files directly) throws `ReferenceError: __name is not
   defined` inside `page.evaluate()`. Cause: `tsx`'s esbuild transform
   injects a `__name()` helper for named functions; Playwright serializes
   the `evaluate()` callback to run *inside the browser*, where that
   helper doesn't exist. The `worker:crawl` / `worker:record` /
   `test:mock` npm scripts instead run `npm run build && node dist/...` —
   `tsc` doesn't inject that helper, so compiled output is safe. Any new
   entrypoint that touches `page.evaluate()` must follow the same
   build-then-run pattern.

3. **Rebuild after code changes**: `docker compose up -d --build`
   (or just the one service, e.g. `docker compose up -d --build
   extension-builder`).

## Local dev without Docker for the extension

`extension/` is its own npm project (`extension/package.json`,
`extension/build.js` — esbuild). It bundles `extension/src/*.ts` into
`extension/dist`, which gets loaded unpacked into Chrome
(`chrome://extensions` → Developer mode → Load unpacked). It requires
`crawler-app` reachable at `http://localhost:3000` (its only
`host_permissions`).

## Everything-in-Docker workflow

No local Node/npm needed for the main service — `docker compose up -d`
handles build + Node + Playwright browsers + Postgres + Neo4j. See the
`run` skill (`.claude/skills/run/SKILL.md`) for the operational quick
reference (launch, drive a crawl, demo without a real target, teardown).
