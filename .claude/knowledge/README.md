# Knowledge Base — `website-discovery-knowledge-graph-builder`

A structured reference to this repository, written for reuse across
Claude Code agents and skill runs in this project — so a new
conversation, subagent, or skill doesn't have to rediscover the codebase
from scratch. Two layers:

- **[application-context/](application-context/README.md)** — how the
  system is built: architecture, data model, graph model, API, config,
  and one file per feature area. Read this for implementation work:
  bug fixes, adding endpoints, changing crawl/discovery/LLM/recording
  logic.
- **[business-context/](business-context/README.md)** — why it's built
  this way: the problem it solves, who it's for, what its outputs mean,
  and where its trust/safety boundaries are. Read this for product
  decisions: what a change should do, how to explain a feature, whether
  a proposed behavior fits the system's intent.

Start with whichever layer matches the task. Implementation questions
("how does login handling work") belong in application-context; framing
questions ("why does this system refuse to click Delete buttons") belong
in business-context — they cross-reference each other throughout.

## Quick orientation

This service crawls a target website with Playwright, uses a local LLM
(Ollama) to infer its business entities/actions/relationships/workflows,
persists everything to Postgres + Neo4j, serves it over a REST API, and
can generate a Claude-agent-narrated demo video of any inferred workflow.
A Chrome side-panel extension provides a UI over the same API. See
[application-context/README.md](application-context/README.md) for the
full picture, or [business-context/README.md](business-context/README.md)
for the one-paragraph pitch.

## How to use this when running a skill or agent in this repo

- Before making a change, skim the relevant `application-context/features/*.md`
  file — most non-trivial behavior here has a documented rationale
  ("best-effort," "delete-and-rebuild," "safety-gated") that isn't
  obvious from the code alone, and getting it wrong tends to reintroduce
  a bug that was deliberately avoided (see
  `application-context/configuration-and-deployment.md`'s "known-fragile
  points" for two concrete examples: Playwright version pinning, and
  never running crawl code via `tsx`).
- If a task is about *what* the system should do rather than *how* it
  currently does it, check `business-context/` first — several behaviors
  that look like they could be "improved" (e.g. the safety keyword
  blocklist, best-effort AI failure handling, full rebuild-per-crawl) are
  deliberate product decisions documented there, not gaps.
- This knowledge base describes the system **as read from source on
  2026-08-06**. If you find the code has diverged from what's written
  here, trust the code and update the relevant file — don't propagate a
  stale claim.
- Operational how-to (launching the stack, running a crawl, teardown)
  lives in `.claude/skills/run/SKILL.md`, not here — this knowledge base
  is about understanding the system, that skill is about operating it.

## Full file index

```
application-context/
  README.md                              layer overview + service table + source tree
  architecture-and-lifecycle.md          crawl & recording job lifecycles, two LLM integrations explained
  data-model.md                          Postgres schema, every table, delete/rebuild semantics
  graph-model.md                         Neo4j node/edge projection
  api-reference.md                       every REST endpoint + typical client sequences
  configuration-and-deployment.md        env vars, Docker topology, known-fragile points
  features/
    crawling-and-discovery.md            PlaywrightCrawler, PageDiscovery, NavigationDiscovery, UiDiscovery
    login-handling.md                    login-wall detection, AWAITING_CREDENTIALS, credential handoff
    knowledge-extraction-llm.md          PageSummarizer, KnowledgeExtractor, OllamaClient (local LLM)
    knowledge-building-persistence.md    KnowledgeBuilder orchestration
    knowledge-summarization.md           KnowledgeSummarizer domain heuristic
    workflow-recording-agent.md          WorkflowOrchestrator (Claude agent), browser-tools, WorkflowRecorder
    safety-engine.md                     destructive-action blocklist, where it's enforced
    chrome-extension.md                  Narreto side panel
    mock-demo-environment.md             mock-crm-server.ts, test-crawler.ts

business-context/
  README.md                              layer overview + one-paragraph pitch
  product-purpose-and-problem.md         the problem being solved, why crawl+LLM
  personas-and-use-cases.md              who uses this, representative use cases, non-use-cases
  domain-model-glossary.md               Entity/Action/Relationship/Workflow/confidence in plain language
  deliverables-and-outputs.md            what a consumer gets, and why each deliverable exists
  trust-safety-and-limits.md             rationale for the safety posture + honest reliability limits
```
