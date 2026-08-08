# Architecture & Lifecycle

## Crawl job lifecycle

```
POST /api/crawl {targetUrl}
  -> INSERT crawl_jobs (status=PENDING)                          [routes.ts]
  -> crawl-worker polls every 5s, claims one row via
     "FOR UPDATE SKIP LOCKED" (safe with multiple worker replicas) [crawl-worker.ts]
  -> status=RUNNING
  -> PlaywrightCrawler.crawl()                                    [playwright-crawler.ts]
       BFS over same-origin links, up to maxPages (default 10-15)
       per page: PageDiscovery + NavigationDiscovery + UiDiscovery
       SafetyEngine gates any exploratory navigation/click
     -> may throw LoginRequiredError -> status=AWAITING_CREDENTIALS (see login-handling.md)
  -> KnowledgeBuilder.build(projectId, rawPages)                  [knowledge-builder.ts]
       1. persist pages + ui_elements to Postgres
       2. per page (best-effort): PageSummarizer -> Ollama -> ai_summary/ai_description
       3. resolve parent/child page relationships
       4. once per crawl (best-effort): KnowledgeExtractor -> Ollama ->
          entities/actions/relationships/workflows
       5. GraphProjection.project() -> Neo4j
  -> KnowledgeSummarizer.summarize(projectId)                     [knowledge-summarizer.ts]
       heuristic domain label + top entities/workflows -> knowledge_summaries
  -> status=COMPLETED (or FAILED with error_message)
```

Poll `GET /api/crawl/:id` for status; once `COMPLETED`, read
`GET /api/summary/:projectId` (cheap) or `GET /api/graph/:projectId` (full
graph, for visualization/automation).

## Workflow recording lifecycle

Independent of the crawl above — triggered only after a crawl has produced
at least one workflow.

```
POST /api/workflows/:workflowId/run
  -> INSERT workflow_runs (status=PENDING)                        [routes.ts]
  -> workflow-agent-worker polls every 5s, claims a row
     (same SKIP LOCKED pattern)                                   [workflow-agent-worker.ts]
  -> status=RUNNING
  -> loads workflow_steps JOINed with pages/actions/entities,
     ordered by step_number
  -> WorkflowRecorder.record(runId, steps)                        [workflow-recorder.ts]
       launches a FRESH headless browser (Playwright's recordVideo needs a
       context it launched itself -- it can't attach to the user's live tab)
       for each step:
         WorkflowOrchestrator.runStep(page, step)                 [agent/workflow-orchestrator.ts]
           a Claude agent (Anthropic SDK, model claude-opus-4-8) drives the
           page via a Playwright-MCP-style tool surface (agent/browser-tools.ts):
           navigate / click / type / press_key / read_page_elements / wait / finish
           - SafetyEngine re-checks any "click" tool call before executing it
           - "finish" returns a one-sentence present-tense narration
         caption cue built from that narration (or a static fallback)         [caption-builder.ts]
  -> video (.webm) + captions (.vtt) written to the shared `recordings` volume
  -> status=COMPLETED, video_path/captions_path set (or FAILED)
```

Poll `GET /api/workflow-runs/:id`; once `COMPLETED`, the video/captions are
servable at `crawler-app`'s `/recordings/<video_path>` (static file serving
in `server.ts`, since both `crawler-app` and `workflow-agent-worker` mount
the same `recordings` Docker volume).

## Two independent LLM integrations — don't conflate them

1. **Ollama (local model, `OLLAMA_URL`/`OLLAMA_MODEL`)** — used entirely
   inside the crawl pipeline, for page/component summarization
   (`llm/page-summarizer.ts`) and entity/workflow inference
   (`llm/knowledge-extractor.ts`). Gated by `AI_SUMMARIZATION_ENABLED`.
   Both call sites are best-effort: failures are logged and leave fields
   `NULL`/empty, never fail the crawl job.
2. **Anthropic Claude (`ANTHROPIC_API_KEY`, hardcoded model
   `claude-opus-4-8`)** — used entirely inside workflow *recording*, to
   drive the browser step-by-step and narrate it
   (`agent/workflow-orchestrator.ts`). Required for
   `workflow-agent-worker`'s core function; there's no fallback path if the
   key is missing (the SDK client throws lazily on first use, not at
   process startup).

## Why the crawl and the recording each launch their own browser

`PlaywrightCrawler.crawl()` launches (or CDP-attaches to) a browser to
*discover* the site. `WorkflowRecorder.record()` launches a completely
separate, fresh headless browser to *replay* a workflow for video capture.
They never share a browser instance — recording needs Playwright's own
`recordVideo` context, and replaying happens well after the crawl's browser
has already closed.
