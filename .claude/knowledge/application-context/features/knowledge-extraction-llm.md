# LLM-Driven Knowledge Extraction (Ollama)

Source: `src/llm/ollama-client.ts`, `src/llm/page-summarizer.ts`,
`src/llm/knowledge-extractor.ts`. This is the local-model side of the
system — separate from the Anthropic/Claude agent used for workflow
recording (see [workflow-recording-agent.md](workflow-recording-agent.md)).

## `OllamaClient.generateJson()`

Thin wrapper around Ollama's `/api/generate` with `format: 'json'`,
`stream: false`, `temperature: 0.2`, `num_ctx: 8192`. One retry on any
failure (timeout, non-2xx, bad JSON) — local inference occasionally times
out under cold-start/CPU load. Returns `null` (never throws) after both
attempts fail, so every caller must treat the result as best-effort.
Default timeout 60s, overridable per call.

## Pass 1 — `PageSummarizer.summarize()` (per page, during the crawl)

Called from `KnowledgeBuilder.build()` once per discovered page, gated by
`AI_SUMMARIZATION_ENABLED`. Input: page title, breadcrumb, cleaned HTML
(scripts/styles/comments stripped, whitespace collapsed, truncated to
6000 chars), and the **already-discovered** `UiElement` list (selector +
type + label). Feeding the pre-discovered elements — rather than making
the small model parse raw HTML for selectors itself — is called out in
the source as the key reliability decision here.

Output shape: `{summary, description, components: [{selector,
description}]}` — one `components` entry per input element, matched back
by exact `selector` string. Persisted to `pages.ai_summary` /
`pages.ai_description` and `ui_elements.ai_description`.

Failure here is caught in `KnowledgeBuilder`, logged as a warning, and
leaves those columns `NULL` — never fails the crawl job.

## Pass 2 — `KnowledgeExtractor.extract()` (once per crawl, project-level)

Called once after all pages are summarized. Input is the **condensed**
output of pass 1 (page summaries + component descriptions), not raw HTML
— this keeps the prompt small and is what lets this generalize to
arbitrary sites instead of pattern-matching a fixed CRM/e-commerce
template. Elements are capped to the top 60 by confidence
(`MAX_ELEMENTS`), each description truncated to 120 chars
(`MAX_ELEMENT_DESC_CHARS`). Timeout is 180s (`PROJECT_LEVEL_TIMEOUT_MS`) —
much longer than pass 1, since this prompt reasons over the whole site at
once.

The prompt explicitly instructs the model *not* to force-fit a
CRM/e-commerce template, and to return an empty `workflows` array rather
than inventing one if nothing meaningful exists.

Output shape: `{entities, actions, relationships, workflows}` (see
`AiKnowledgeResult` in the source for exact field types). Validated
defensively: `result` must have an `entities` array or the whole thing is
treated as a failure (`null`); every nested field is individually
type-checked and filtered before being trusted, and any missing/invalid
`confidence` is clamped to `0.7` via a local `conf()` helper — deliberately
avoiding `undefined` reaching the Neo4j driver, which throws on missing
query parameters (unlike Postgres, which just stores `NULL`).

### `normalizeEntityName()`

Title-cases and naively singularizes entity names (`"customers"` /
`"Customer"` / `"Customers"` → `"Customer"`; handles `-ies → -y` and
trailing `-s`, but not irregular plurals) so the model's own
inconsistent naming across pages still dedupes against the `(project_id,
name)` unique constraint on `entities`.

## Failure semantics (repeat, because it's the load-bearing invariant)

Both passes are best-effort by design: a slow/unreachable/misbehaving
Ollama service degrades the crawl's *output richness*, never its
*success*. With `AI_SUMMARIZATION_ENABLED=false`, both passes are skipped
outright — pages/UI elements still crawl and persist fine, but
`ai_summary`/`ai_description` stay `NULL` and entities/actions/
relationships/workflows are empty for that project.
