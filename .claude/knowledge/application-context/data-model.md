# Data Model (Postgres)

Source of truth: `init.sql`. All primary keys are `uuid_generate_v4()`
UUIDs. There is no `projects` table — `project_id` is just a UUID that
groups everything from one crawl target; the caller may pass their own or
let `POST /api/crawl` mint one.

## Tables

### `crawl_jobs`
One row per queued/running/finished crawl. `status`: `PENDING` → `RUNNING`
→ (`AWAITING_CREDENTIALS` ⇄ `RUNNING`) → `ENRICHING` → `COMPLETED` | `FAILED`.
`ENRICHING` means the headless-browser crawl is done and AI summarization/
knowledge extraction/graph projection are running in the background
(`ENRICH_CONCURRENCY`-bounded, off the worker's polling loop, so it never
blocks the next job's crawl from starting). `login_url` is set only while
`AWAITING_CREDENTIALS`. `error_message` set on `FAILED`.

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

### `users`
Stores user accounts authenticated via Google OAuth, GitHub OAuth, or local demo.
Columns: `id` (UUID PK), `email` (VARCHAR UNIQUE), `name` (VARCHAR), `avatar_url` (TEXT), `provider` (`google` | `github` | `demo`), `provider_user_id` (TEXT), `role` (VARCHAR default `'user'`), `last_login_at` (TIMESTAMPTZ), `created_at`, `updated_at`.

### `user_auth_logs`
Audit trail recording every authentication lifecycle event: `SIGNUP`, `LOGIN`, `LOGOUT`, `TOKEN_REFRESH`.
Columns: `id` (UUID PK), `user_id` (UUID FK `ON DELETE CASCADE`), `event_type` (VARCHAR), `provider` (VARCHAR), `ip_address` (VARCHAR), `user_agent` (TEXT), `metadata` (JSONB), `created_at` (TIMESTAMPTZ).
Indexed on `email`, `provider`, `user_id`, `created_at DESC`, `event_type`.

## Delete/rebuild semantics worth knowing

`KnowledgeBuilder.build()` uses a cached lookup before deletion to preserve AI summaries across re-crawls when `dom_hash` is unchanged:
- Existing `ai_summary` / `ai_description` keyed by `dom_hash` are read into memory.
- `DELETE FROM pages WHERE project_id = $1` cleans previous rows.
- Re-inserted pages with identical `dom_hash` reuse previous summaries without calling the LLM.
- `DELETE FROM entities WHERE project_id = $1` and
  `DELETE FROM workflows WHERE project_id = $1` before re-inserting AI
  output (entities cascade-delete `actions`/`relationships`;
  workflows cascade-delete `workflow_steps`).
- `users` and `user_auth_logs` are preserved across crawls.
