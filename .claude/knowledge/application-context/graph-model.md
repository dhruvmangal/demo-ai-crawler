# Graph Model (Neo4j)

Source: `src/graph/graph-projection.ts` (`GraphProjection.project()`), called
once at the end of `KnowledgeBuilder.build()`. This is a **projection**, not
a separate source of truth — Postgres is authoritative; Neo4j is rebuilt
from it on every crawl.

## Rebuild strategy

Every project on every crawl: `MATCH (n) WHERE n.projectId = $projectId
DETACH DELETE n` wipes that project's subgraph, then everything is
recreated from the just-persisted Postgres rows. Simple and correct, at
the cost of O(pages + elements + entities + …) individual Cypher
statements per crawl (no batched `UNWIND` — fine at demo/small-crawl scale,
worth revisiting if `maxPages` grows much past current defaults).

## Node labels

| Label | Key properties | Created from |
|---|---|---|
| `:Page` | `id`, `projectId`, `url`, `title`, `breadcrumb`, `viaLabel`, `viaSelector`, `aiSummary`, `aiDescription` | `pages` |
| `:Component` | `id`, `projectId`, `type`, `label`, `selector`, `aiDescription` | `ui_elements` |
| `:Entity` | `id`, `projectId`, `name`, `entityType`, `confidence` | `entities` |
| `:Action` | `id`, `projectId`, `actionType`, `selector`, `confidence` | `actions` |
| `:Workflow` | `id`, `projectId`, `name`, `confidence` | `workflows` |
| `:WorkflowStep` | `id` (synthetic: `${workflowId}_step_${stepNumber}`), `projectId`, `stepNumber` | `workflow_steps` |

## Edges

| Edge | Direction | Properties | Meaning |
|---|---|---|---|
| `HAS_PAGE` | parent → child | `label`, `selector` | click-path: what to click on the parent page to reach the child |
| `CHILD_OF` | child → parent | `label`, `selector` | inverse of `HAS_PAGE`, same properties, for reverse traversal |
| `HAS_COMPONENT` | Page → Component | — | this component is discoverable on this page |
| `RELATED_TO` | source Entity → target Entity | `relationshipType`, `confidence` | business relationship (e.g. Customer→Order) |
| `HAS_ACTION` | Entity → Action | — | this action can be performed on this entity |
| `HAS_STEP` | Workflow → WorkflowStep | — | membership |
| `NEXT_STEP` | WorkflowStep(n) → WorkflowStep(n+1) | — | sequencing, built by sorting on `stepNumber` |
| `ON_PAGE` | WorkflowStep → Page | — | this step happens on this page (only if the step resolved to a known page) |
| `PERFORMS_ACTION` | WorkflowStep → Action | — | only if the step resolved to a known action |
| `TARGETS_ENTITY` | WorkflowStep → Entity | — | only if the step resolved to a known entity |

## Reading it back

`GET /api/graph/:projectId` (`routes.ts`) runs a single
`MATCH (n) WHERE n.projectId = $projectId OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m`
and flattens the result into `{ nodes: [{labels, properties}], edges:
[{type, source, target, properties}] }`. This is the shape the Chrome
extension's `render.ts` consumes to build the page tree (via `HAS_PAGE`
edges) and workflow list (via `:Workflow` nodes) — see
[chrome-extension.md](features/chrome-extension.md).

Note `nodes.set(nodeA.properties.id || nodeA.elementId, ...)` — nodes are
deduped by their app-assigned `id` property (falling back to Neo4j's
internal `elementId` only if that's missing), so the same node reached via
multiple edges appears once in the response.
