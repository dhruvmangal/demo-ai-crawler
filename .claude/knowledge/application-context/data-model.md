# Data Model (Postgres)

Source of truth: `init.sql`. All primary keys are `uuid_generate_v4()`
UUIDs. There is no `projects` table — `project_id` is just a UUID that
groups everything from one crawl target; the caller may pass their own or
let `POST /api/crawl` mint one.

## Tables

### `crawl_jobs`
One row per queued/running/finished crawl. `status`: `PENDING` → `RUNNING`
→ (`AWAITING_CREDENTIALS` ⇄ `RUNNING`) → `COMPLETED` | `FAILED`.
`login_url` is set only while `AWAITING_CREDENTIALS`. `error_message` set
on `FAILED`.

### `crawl_credentials`
Transient holding table. A row exists only between the caller POSTing
`/api/crawl/:id/credentials` and the worker's next poll — the worker
deletes it immediately on read, whether or not login succeeds. Never
holds credentials at rest for longer than one poll interval (5s).
`ON DELETE CASCADE` from `crawl_jobs`.

### `pages`
One row per discovered page. `parent_page_id` (self-referencing,
`ON DELETE SET NULL`) encodes the page tree. `via_label`/`via_selector`
record *what the crawler clicked* on the parent to reach this page — the
thing that makes this more than a sitemap: it's a set of directions.
`dom_hash` is a SHA-256 of a structural (tag/id/class) DOM tree, for
future dedup/change-detection use. `ai_summary`/`ai_description` are
nullable LLM output (added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
so upgrading an existing DB is safe). Unique on `(project_id, url)`.

### `page_snapshots`
Append-only: one row per page visit, storing the full structural DOM JSON
(`dom_json`) behind `dom_hash`. `ON DELETE CASCADE` from `pages`.

### `ui_elements`
Interactive components found on a page: `type` is `button | form | table |
dialog | input`. `selector` is how to target it in a real browser.
`ai_description` is nullable LLM output describing what the component
does. `ON DELETE CASCADE` from `pages`.

### `entities`
Business/domain objects the LLM inferred exist on the site (e.g.
Customer, Order — or whatever fits; not a fixed template). Unique on
`(project_id, name)` — inserts use `ON CONFLICT ... DO UPDATE` so a
re-crawl updates confidence/type in place rather than duplicating.

### `actions`
An action type (Create, Edit, Approve, Refund, …) available on an entity,
optionally tied to a `selector`. `entity_id` cascades on entity delete.

### `relationships`
Directed entity-to-entity edges (`relationship_type`, e.g. `HAS_ORDER`).
Unique on `(source_entity_id, target_entity_id, relationship_type)`, also
upserted on conflict.

### `workflows`
An inferred multi-step flow a user could complete on the site.
`confidence` is model-reported, 0–1.

### `workflow_steps`
Ordered (`step_number`) steps of a workflow, each optionally pointing at a
`page_id` / `action_id` / `entity_id` (all `ON DELETE SET NULL`, so
deleting a page/action/entity doesn't destroy the workflow's step count).

### `knowledge_summaries`
One row per project (`UNIQUE (project_id)`, upserted), holding the
`KnowledgeSummarizer` output: `domain` (heuristic label) +
`summary_data` (JSONB: page count, top entities, workflow flow-patterns).
This is what `GET /api/summary/:projectId` serves — a cheap, LLM-friendly
digest so a downstream agent doesn't need to pull the full graph.

### `workflow_runs`
Job queue row for the recording agent. `status`: `PENDING` → `RUNNING` →
`COMPLETED` | `FAILED`. `video_path`/`captions_path` are **filenames
relative to the shared `recordings` volume**, not full paths — served by
`crawler-app` at `/recordings/<filename>`.

## Delete/rebuild semantics worth knowing

`KnowledgeBuilder.build()` does a **hard delete-and-rebuild** per project
on every crawl, not an incremental merge:
- `DELETE FROM pages WHERE project_id = $1` (cascades to `ui_elements`,
  `page_snapshots`) before re-inserting the freshly crawled set.
- `DELETE FROM entities WHERE project_id = $1` and
  `DELETE FROM workflows WHERE project_id = $1` before re-inserting AI
  output (entities also cascade-delete `actions`/`relationships`;
  workflows cascade-delete `workflow_steps`).

So re-crawling a project fully replaces its pages/entities/workflows —
there's no history retained across crawls except whatever's still in
`page_snapshots`, which becomes orphaned (and cascade-deleted) once its
parent `pages` row is replaced.
