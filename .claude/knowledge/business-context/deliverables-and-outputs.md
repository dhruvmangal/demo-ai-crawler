# Deliverables & Outputs

What a consumer (human or agent) actually gets from this system, and
which persona/use-case each one serves. Cross-referenced to the API that
returns it — see
[../application-context/api-reference.md](../application-context/api-reference.md)
for exact request/response shapes.

| Deliverable | Endpoint | Best for |
|---|---|---|
| **Domain digest** — coarse domain label, page count, top entities, workflow flow-patterns | `GET /api/summary/:projectId` | Quick orientation; cheap enough to hand to an LLM prompt without blowing a context budget |
| **Full knowledge graph** — every page (with click-path), component, entity, action, relationship, workflow, and how they connect | `GET /api/graph/:projectId` | Automation/agent context-priming; visualization (this is what the Chrome extension renders); deep exploration |
| **Page tree with click-paths** (a view over the graph) | derived from `GET /api/graph/:projectId`'s `HAS_PAGE` edges | Onboarding docs, "how do I get to X" answers, auto-generated navigation guides |
| **Narrated demo video + captions** | `POST /api/workflows/:id/run` → `GET /recordings/*` | Sales demos, stakeholder walkthroughs, anything meant to be *watched* rather than queried |
| **Crawl job status / error detail** | `GET /api/crawl/:id` | Operational visibility — did it work, is it stuck on a login wall, why did it fail |

## Why both a "digest" and a "full graph" exist

The digest (`knowledge_summaries`) exists specifically to avoid forcing
every consumer to pull and parse the entire graph just to answer "what is
this app, roughly, and what are its 2-3 main things." It's the
LLM-context-budget-conscious option — deliberately lossy in exchange for
being cheap and immediately readable. The full graph is for when a
consumer actually needs to act on specifics (an exact selector, an exact
click-path, a specific workflow's steps).

## Why the video is a separate deliverable from the graph

The graph is machine/power-user-oriented — accurate but not persuasive on
its own. The recorded workflow video exists because the actual business
moment this product targets (a demo, a walkthrough, an onboarding aid) is
better served by something a non-technical stakeholder can watch in 60
seconds than by a JSON graph they'd need help interpreting. The captions
(WebVTT) matter for the same reason video captions always matter:
accessibility and skimmability (searchable/scrubbable by text) without
needing sound on.

## What "confidence" should and shouldn't be used for in a deliverable

Confidence scores (see
[domain-model-glossary.md](domain-model-glossary.md)) are surfaced in the
summary's top-10-entities ranking and the extension's workflow list
sort order — they're a *ranking* signal, appropriate for "show me the
most likely things first." They are not validated against ground truth
anywhere in the system, so they shouldn't be presented to an end user as
a certainty/accuracy metric without that caveat.
