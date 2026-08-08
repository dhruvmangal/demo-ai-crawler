# Product Purpose & the Problem Being Solved

## The problem

Understanding an unfamiliar web application — what pages exist, how to
navigate between them, what business objects it manages, what workflows
users actually complete — is normally manual, slow work: someone clicks
around, takes notes, maybe writes documentation that's stale within a
release cycle. This is a recurring cost for:

- **Sales engineers / solutions consultants** who need to demo a partner's
  or a customer's app without deep prior familiarity with it.
- **New team members / support staff** onboarding onto an internal tool
  with no up-to-date documentation.
- **QA / automation engineers** who need a map of an app's interactive
  surface (selectors, forms, destructive actions) before writing tests.
- **AI agents themselves** — an agent asked to "go do X in this web app"
  currently has to explore blind, page by page, burning tool calls and
  risking destructive clicks, unless it's handed a map up front.

## The approach

Instead of documentation written by a human, or a fixed crawler that only
knows one app template (e.g. hardcoded for CRM-shaped sites), this system
combines a **generic, heuristic browser crawler** (Playwright — finds
pages, nav, buttons/forms/tables by structural patterns that hold across
most web UIs) with a **local LLM reasoning pass** (Ollama) that looks at
what was found and infers the *business* layer on top of it: what are the
domain entities here, what actions can be taken on them, how do they
relate, and what multi-step workflows exist. Because the LLM reasons over
condensed summaries rather than a fixed template, the same pipeline works
whether the target turns out to be a CRM, an e-commerce admin panel, a
docs site, or something else entirely — see how `KnowledgeSummarizer`
labels the detected domain in
[domain-model-glossary.md](domain-model-glossary.md).

A second capability — narrated demo video generation via a Claude-driven
browser agent — exists because "here's a graph of entities and workflows"
is useful for automation, but a short narrated video is what actually
gets watched by a human deciding whether to trust or buy into a product.

## Why "best-effort" AI is a deliberate product decision

Every LLM call in the crawl pipeline (page summarization, entity/workflow
inference) is designed to degrade gracefully rather than block the
result: a crawl always produces a page tree and UI inventory even if the
LLM is down, slow, or disabled (`AI_SUMMARIZATION_ENABLED=false`) — it
just loses the summaries/entities/workflows layered on top. This matters
for the product because the structural crawl (pages, navigation,
selectors) is useful and demoable on its own; the AI layer is a
value-add, not a hard dependency for the tool to be usable at all.
