# Workflow Recording & the Claude Browser Agent

Source: `src/workers/workflow-agent-worker.ts`,
`src/recorder/workflow-recorder.ts`, `src/recorder/caption-builder.ts`,
`src/agent/workflow-orchestrator.ts`, `src/agent/browser-tools.ts`.

This feature is downstream of a completed crawl (it needs
`workflow_steps` rows to already exist) but is a fully separate pipeline
with its own worker, its own browser, and its own LLM provider
(Anthropic, not Ollama).

## `workflow-agent-worker.ts` — the poller

Same pattern as `crawl-worker.ts`: polls `workflow_runs` every 5s,
atomically claims one `PENDING` row (`UPDATE ... WHERE id = (SELECT ...
FOR UPDATE SKIP LOCKED)`), loads its steps pre-joined with
page/action/entity data into `WorkflowRunStep[]`, hands them to
`WorkflowRecorder.record()`, and writes back `COMPLETED` +
`video_path`/`captions_path` (just the `path.basename()`, not the full
path) or `FAILED` + `error_message`. Errors if a workflow has zero steps.

## `WorkflowRecorder.record()` — video capture

Launches a **fresh** headless Chromium with `recordVideo: {dir:
recordingsDir, size: 1280x720}` — Playwright's video recording is tied to
a context it creates itself, so this can't reuse or attach to any
browser used during the original crawl. For each step, in order:
1. Compute the cue's start time as `max(elapsed wall-clock time since
   recording start, end of previous cue)` — the `max` with the previous
   cue's end is what guarantees captions never overlap even when a step
   finishes faster than `MIN_CUE_MS` (1500ms).
2. `WorkflowOrchestrator.runStep(page, step)` — see below.
3. Hold the frame for `STEP_DWELL_MS` (1200ms) so the video is watchable.
4. Push a caption `Cue` covering `[cueStart, max(now, cueStart +
   MIN_CUE_MS)]`.

After all steps, `context.close()` finalizes the video file; the
temporary Playwright-chosen path is renamed to `<runId>.webm`, and
`buildVtt(cues)` is written to `<runId>.vtt`.

## `WorkflowOrchestrator.runStep()` — the agent

For each workflow step, this **replaces what used to be a hardcoded
goto/click replay** with an LLM agent loop (model `claude-opus-4-8`,
`max_tokens: 1024`, up to `MAX_TOOL_ITERATIONS = 6` tool round-trips):

1. Builds a context string from the step's known page URL/title/AI
   description, action type + entity name, and the *original* recorded
   selector (explicitly labeled "may be stale" in the prompt — the site
   may have changed since the crawl).
2. System prompt instructs the agent: prefer the given selector, but call
   `read_page_elements` to find the right element if it no longer
   matches; if the step is view-only, don't click anything — just call
   `finish`; always end by calling `finish` with a one-sentence
   present-tense narration suitable as a caption.
3. Loops: send messages + `BROWSER_TOOLS`, execute any non-`finish` tool
   calls against the live `page`, feed results back as `tool_result`
   blocks, repeat until the model calls `finish` (or emits plain text
   with no tool call, or the iteration cap is hit — each of those exits
   the loop with a best-effort narration).
4. **Safety gate on every `click` call specifically**: before executing,
   `SafetyEngine.checkAction()` is re-run against the *target selector
   the agent chose* (not just the original recorded one). If unsafe, the
   tool call is short-circuited with an `is_error` tool result
   ("Blocked for safety: ..."), `actionSkipped` is set `true` for this
   step, and the loop continues — the agent gets to react (e.g. call
   `finish` anyway) rather than the whole run failing.

Returns `{narration, actionSkipped}`.

## `browser-tools.ts` — the tool surface

A Playwright-MCP-style tool vocabulary (`navigate`, `click`, `type`,
`press_key`, `read_page_elements`, `wait`, `finish`) implemented as direct
Claude tool definitions against a real Playwright `Page`, rather than
running a separate `@playwright/mcp` server process. The doc comment in
the source is explicit that swapping in the real `@playwright/mcp`
package later is meant to be a drop-in replacement for this file —
useful context if asked to integrate MCP properly.
`read_page_elements` reuses `UiDiscovery.discover()` (same module the
crawler itself uses) so the agent sees the same element vocabulary the
crawl originally captured.

## `caption-builder.ts` — captions with or without the agent

`buildCaptionText(step, actionSkipped, narration?)`:
- If the orchestrator produced a `narration`, use it directly (this is
  the normal path now).
- Otherwise (agent path unavailable/not used for this step), fall back to
  a static template built from data already collected during the crawl:
  `"<ActionType> <EntityName>"` or just `<ActionType>`, plus the page's
  `ai_description`/`ai_summary` or `"Viewing <title>"`. **No extra LLM
  calls at recording time** for this fallback — it's pure string
  assembly from already-stored fields.
- Appends `" (action skipped for safety)"` when `actionSkipped` is true.

`buildVtt(cues)` renders standard WebVTT: `WEBVTT` header, then
`index\nHH:MM:SS.mmm --> HH:MM:SS.mmm\ntext\n\n` per cue.
