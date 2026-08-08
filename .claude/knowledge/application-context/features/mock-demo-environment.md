# Mock Demo Environment

Source: `src/mock-crm-server.ts`, `src/test-crawler.ts`. Exists so the
whole pipeline can be exercised and demoed without a real target site or
external network access.

## `mock-crm-server.ts`

A tiny standalone Express app (port `4000`, exported as `mockServer`) with
a shared sidebar/breadcrumb layout and four+ pages, deliberately shaped to
exercise every discovery code path:

- **`/dashboard`** — a button opening a "Create Lead" modal/form (exercises
  dialog + form + field discovery).
- **`/customers`** — a "Create Customer" modal/form plus a data table with
  row actions **"Edit"** and **"Delete"** (the `Delete` button is exactly
  the kind of thing `SafetyEngine` is meant to catch and refuse to
  auto-click).
- **`/orders`** — a "Create Order" modal/form plus a table with row
  actions **"Print Invoice"** and **"Refund"** (again, `Refund` is a
  blocklisted keyword).
- **`/settings`** — a plain content page, no interactive elements, to
  exercise the "page with nothing to discover" path.
- **`/portal`** (login-gated) + **`/login`** — a minimal session-cookie
  login flow (`admin`/`admin123`) purpose-built to exercise
  [login-handling.md](login-handling.md): `/portal` redirects to `/login`
  if the `session=valid` cookie isn't present; `POST /login` sets that
  cookie on success or returns `401` with a page containing no password
  field, matching `attemptLogin()`'s "no full navigation vs 4xx response"
  success-judgment branches.

Run standalone inside the built image:
```
docker exec -d crawler_app node dist/mock-crm-server.js
curl -X POST http://localhost:3000/api/crawl \
  -d '{"targetUrl":"http://crawler_app:4000/dashboard"}'
```
(Note: crawled from *inside* the Docker network, hence
`crawler_app:4000`, not `localhost:4000`.)

## `test-crawler.ts`

A fully self-contained one-shot harness — no job queue, no worker
process:

1. Starts the mock CRM server in-process (imports `mockServer`).
2. Re-applies `init.sql` against the configured Postgres (idempotent —
   every `CREATE TABLE`/`ALTER TABLE` in the schema uses `IF NOT EXISTS`).
3. Runs `PlaywrightCrawler.crawl()` directly against
   `http://localhost:4000/dashboard`.
4. Runs `KnowledgeBuilder.build()` and `KnowledgeSummarizer.summarize()`
   directly (same calls the real `crawl-worker` makes).
5. Re-queries Postgres to assemble a verification-friendly `output_schema.json`
   per page: title, url, `reachedFrom` (parent URL), `navigateVia`
   (label/selector), discovered buttons/forms/tables, and entity
   relationships — written to the repo root.
6. Shuts down the mock server and Neo4j driver, exits.

Invoke via `npm run test:mock`, which — like `worker:crawl`/
`worker:record` — builds first (`tsc`) and runs compiled `dist/` output,
never `tsx` directly (see
[../configuration-and-deployment.md](../configuration-and-deployment.md)
for why). Inside the container:
```
docker exec crawler_app npm run test:mock
```

This is the fastest way to validate an end-to-end change to
discovery/knowledge-building logic without going through the async job
queue or standing up a separate target site.
