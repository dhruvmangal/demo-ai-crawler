# Personas & Use Cases

## Personas

**Sales engineer / solutions consultant**
Needs to demo or explain an app (their own product, a partner's, or a
prospect's) without weeks of hands-on familiarity. Cares most about the
[workflow recording](../application-context/features/workflow-recording-agent.md)
output — a narrated video is what they can actually show in a meeting.

**Support / onboarding staff, new hire**
Needs a fast mental model of an internal tool with no current
documentation. Cares most about the page tree with click-paths
(`via_label`/`via_selector`) and the plain-language `ai_summary`/
`ai_description` on each page — effectively auto-generated documentation.

**QA / test automation engineer**
Needs an inventory of an app's interactive surface — every selector,
every form's fields, every table's row actions — as a starting point for
writing real tests, and specifically needs to know which actions are
destructive before scripting anything against them. Cares most about
`ui_elements` (selectors, field metadata) and the
[Safety Engine](../application-context/features/safety-engine.md)'s
notion of what's flagged risky.

**Agent builder / "give my agent a map first"**
Building an AI agent that needs to operate inside a specific web app
(fill forms, navigate, complete a task) and wants to avoid having that
agent explore blind — burning tool calls, risking destructive clicks, and
frequently getting lost. Cares most about the **graph** — entities,
relationships, workflows, and exact selectors — as pre-computed context
to hand the operating agent, dramatically shrinking its exploration
burden. This is also, structurally, what `WorkflowOrchestrator` itself
is: an agent consuming this system's own output (a workflow's steps +
selectors + descriptions) to act competently in a browser it wasn't
present for the discovery of.

**Product/competitive analyst**
Wants a structural read of a competitor's or partner's app — what
entities and workflows it exposes — without manually mapping it
themselves. Cares most about the domain summary
(`GET /api/summary/:projectId`) and the entity/relationship graph.

## Representative use cases

1. **"Explain this app to me"** — crawl a target, read back
   `GET /api/summary/:projectId` for a quick domain + entity + workflow
   digest, or `GET /api/graph/:projectId` for the full structure.
2. **"Show me a demo of X flow"** — crawl, pick an inferred workflow from
   the graph, trigger a recording, get back a narrated `.webm` + `.vtt`.
3. **"What can I safely automate here?"** — crawl, inspect `ui_elements`
   and their labels/selectors, cross-reference against what
   `SafetyEngine` would block, before writing a real automation script.
4. **"Prep context for an agent that needs to operate this app"** — crawl
   once, then hand a downstream agent the graph (entities, relationships,
   page tree with click-paths, component selectors) instead of letting it
   explore the live site cold.
5. **"This app is behind a login"** — crawl, get `AWAITING_CREDENTIALS`,
   submit credentials once via the API, crawl resumes and completes (see
   [login-handling.md](../application-context/features/login-handling.md)
   for exactly what does and doesn't work here — no 2FA/CAPTCHA/OAuth).

## Non-use-cases (out of scope by design)

- **Not** a general-purpose web scraper for content/data extraction — the
  unit of value is structure (pages/nav/UI/entities/workflows), not page
  content itself.
- **Not** a tool for performing real destructive actions in a target
  app — the Safety Engine and the "discover, don't submit" posture mean
  it will not actually delete/refund/cancel anything on your behalf (see
  [trust-safety-and-limits.md](trust-safety-and-limits.md)).
- **Not** a replacement for a full QA test suite — selectors/heuristics
  here are a starting point, not guaranteed-stable locators.
