# Knowledge Summarization

Source: `src/knowledge/knowledge-summarizer.ts`
(`KnowledgeSummarizer.summarize()`). Called once per crawl job, from
`crawl-worker.ts`, immediately after `KnowledgeBuilder.build()` completes.
Not an LLM call — this is a cheap, deterministic, SQL-driven digest meant
to be served as-is to a downstream consumer (human or agent) without
pulling the full graph.

## What it computes

1. **Page count** — `COUNT(*) FROM pages WHERE project_id = $1`.
2. **Entities** — all rows from `entities`, ordered by `confidence DESC`.
3. **Workflows + flow pattern** — each workflow joined through
   `workflow_steps` to `entities`, producing a human-readable
   `flowPattern` string like `Customer -> Order -> Invoice` (entity names
   in step order, joined with `->`); `'Undefined Flow'` if a workflow has
   no entity-bearing steps.
4. **Domain label** — a fixed keyword heuristic over lowercased entity
   names, checked in this priority order:
   - contains `customer`/`lead`/`opportunity` → `Customer Relationship
     Management (CRM)`
   - else contains `order`/`product`/`cart` → `E-commerce Admin Panel`
   - else contains `invoice`/`payment`/`billing` → `Billing / Financial
     Dashboard`
   - else contains `analytics`/`metric`/`report` → `Analytics Platform`
   - else → `Generic Dashboard`

   This is intentionally coarse — it's a label for quick orientation, not
   a claim of certainty. A site with no matching entity names (or AI
   summarization disabled, so no entities at all) always lands on
   `Generic Dashboard`.

## Output & storage

```json
{
  "domain": "Customer Relationship Management (CRM)",
  "discoveredPagesCount": 8,
  "mainEntities": ["Customer", "Order", "..."],  // top 10 by confidence
  "mainWorkflows": [{"name": "...", "confidence": 0.8, "flowPattern": "..."}],
  "timestamp": "2026-08-06T..."
}
```

Upserted into `knowledge_summaries` (`ON CONFLICT (project_id) DO
UPDATE`), served verbatim by `GET /api/summary/:projectId`. Re-running a
crawl replaces the previous summary for that project entirely.
