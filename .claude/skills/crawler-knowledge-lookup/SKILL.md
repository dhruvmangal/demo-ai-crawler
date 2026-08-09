---
name: crawler-knowledge-lookup
description: Resolve a project_id from this crawler app to its crawl target and knowledge base (workflow steps + ui_elements, or a page-list fallback) via direct Postgres queries against the running docker compose stack. Use whenever a task needs to read what a specific crawled project actually discovered -- not just for demo recording.
---

# Looking up a crawled project's knowledge base

Given a `project_id` (UUID), this is how to find out what the crawler
actually discovered for it, straight from Postgres -- no API layer
needed, and no local `psql`/`pg` client required on the host.

If `crawler_postgres` isn't running, see the `run` skill to bring the
stack up first.

## Query pattern

Everything goes through the running container:

```bash
docker exec crawler_postgres psql -U crawler_user -d crawler_db -A -F' | ' -c "<sql>"
```

`-A -F' | '` gives unaligned, pipe-delimited output that's easy to read
and parse without fighting `psql`'s table borders.

## 1. Resolve the crawl target

```sql
SELECT target_url FROM crawl_jobs
WHERE project_id = '<project_id>' AND status = 'COMPLETED'
ORDER BY completed_at DESC LIMIT 1;
```

If nothing comes back, the project either doesn't exist or was never
crawled to completion -- check `SELECT id, status, target_url FROM
crawl_jobs WHERE project_id = '<project_id>'` before giving up.

## 2. Pull workflows, if any

```sql
SELECT id, name, confidence FROM workflows
WHERE project_id = '<project_id>' ORDER BY confidence DESC;
```

**A project can have zero workflows.** Entity/action extraction is tuned
for CRUD-style apps (Create/Edit/Approve an Entity); marketing and docs
sites (e.g. playwright.dev) routinely produce none. That's not an error --
fall back to the raw page list (step 4) and build a sensible tour from the
site's real, live functionality instead.

If there's more than one workflow and nothing tells you which to use,
default to the highest-confidence one.

## 3. Pull a workflow's ordered steps + full page element vocabulary

This is the app's own real query (`src/agent/workflow-knowledge.ts`) --
reuse it as-is, don't invent a different join:

```sql
SELECT ws.step_number, p.id AS page_id, p.url, p.title, p.ai_summary, p.ai_description,
       a.action_type, a.selector AS action_selector_hint, e.name AS entity_name
FROM workflow_steps ws
LEFT JOIN pages p ON p.id = ws.page_id
LEFT JOIN actions a ON a.id = ws.action_id
LEFT JOIN entities e ON e.id = ws.entity_id
WHERE ws.workflow_id = '<workflow_id>'
ORDER BY ws.step_number ASC;
```

This alone only gives **one global `(entity, actionType)` selector** per
step -- not a page-specific one. Always follow it with a per-page element
pull:

```sql
SELECT u.id, u.type, u.label, u.selector, u.role, u.confidence, u.ai_description
FROM ui_elements u
WHERE u.page_id = '<page_id>'
ORDER BY u.confidence DESC;
```

Treat every `selector`/`ai_description` here as a **hint from crawl
time**, not a guarantee -- the live site may have changed, or the stored
value may simply be imprecise (e.g. a bare `button.btn` that matches
several different buttons on the page). Live verification of anything
you plan to actually interact with is a separate, required step (see the
`demo-caption-writer` skill) -- this skill only gets you the raw data.

## 4. Fallback: no workflow, use the page list directly

```sql
SELECT id, url, title, ai_summary, ai_description FROM pages
WHERE project_id = '<project_id>' ORDER BY created_at;
```

Then, for whichever pages you decide are worth showing, pull their
`ui_elements` the same way as step 3.

## 5. Confirm the live site is actually reachable

Before relying on any of this, confirm the target still responds -- from
inside a container that has network access to it (usually `crawler_app`,
since app-internal targets like the mock CRM are only reachable from
inside the docker network):

```bash
docker exec crawler_app node -e "
require('https').get('<target_url>', res => console.log(res.statusCode))
  .on('error', e => console.error('ERR', e.message));
"
```
(use `require('http')` instead of `https` for `http://` targets, e.g. the
mock CRM on `http://crawler_app:4000`).

If the target is this repo's own mock CRM and it's unreachable, it
probably just isn't started yet:

```bash
docker exec -d crawler_app node dist/mock-crm-server.js
```

then re-check before proceeding.
