# Knowledge Building & Persistence

Source: `src/knowledge/knowledge-builder.ts` (`KnowledgeBuilder.build()`).
This is the orchestrator that turns `PlaywrightCrawler`'s raw output into
everything downstream (Postgres rows, Neo4j graph). Called once per crawl
job, from `crawl-worker.ts`, after `crawl()` returns.

## Steps, in order

1. **Wipe this project's pages**: `DELETE FROM pages WHERE project_id =
   $1` (cascades `ui_elements`, `page_snapshots`) — see
   [../data-model.md](../data-model.md) for why this is a full
   rebuild, not a merge.
2. **Insert pages + elements**, page by page, each getting a fresh
   `uuid_generate_v4()`-independent id (`uuidv4()` from the `uuid`
   package, generated app-side so the id is known before the INSERT
   returns — needed to link page_snapshots/ui_elements/AI output in the
   same pass).
3. **Per-page AI enrichment** (`PageSummarizer`, best-effort — see
   [knowledge-extraction-llm.md](knowledge-extraction-llm.md)):
   summary/description written to the page row; component descriptions
   matched back to `ui_elements` rows by exact selector string and
   written individually.
4. **Resolve parent/child page relationships** — for each page, in
   priority order:
   - Prefer `rawPage.parentUrl` (the actual URL the crawler was on when
     it clicked the link that led here) — this reflects the real
     click-path/site structure, not a guess.
   - Fall back to URL sub-path nesting (e.g. `/customers/new` → parent
     `/customers`) **only** when no click-path was recorded — i.e. the
     start page, or a CDP-attached session where navigation wasn't
     driven by the crawler's own queue.
5. **Wipe this project's entities/workflows**: `DELETE FROM entities...`
   and `DELETE FROM workflows...` (cascades actions/relationships and
   workflow_steps respectively).
6. **Project-level AI extraction** (`KnowledgeExtractor`, best-effort):
   entities inserted with `ON CONFLICT (project_id, name) DO UPDATE`
   (upsert by normalized name); actions/relationships/workflows/steps
   only inserted when they successfully resolve back to an already-saved
   entity/page/action by name/URL match (`findEntity()` helper) — any
   reference the model invented that doesn't match a real entity/page is
   silently dropped, not inserted as a dangling reference.
7. **Graph projection**: `GraphProjection.project(projectId, {...})` —
   see [../graph-model.md](../graph-model.md).

## Matching workflow steps to actions

For each AI-proposed workflow step (`{pageUrl, entityName, actionType}`),
the builder resolves an actual `action_id` by finding an already-saved
action belonging to the step's resolved entity whose `actionType` matches
case-insensitively. If the model names an action type that was never
separately proposed in the `actions` array, the step ends up with
`action_id = NULL` (not fabricated) — `workflow_steps.action_id` is
nullable specifically for this case.

## Why persistence happens before graph projection

Neo4j nodes/edges are created directly from the `Entity`/`Action`/
`Relationship`/`Workflow`/`WorkflowStep` objects *as saved to Postgres*
(with their real Postgres-assigned UUIDs as node `id` properties), so
Postgres must be the last word on IDs before the graph is built — this is
why projection is step 7, strictly after every Postgres write.
