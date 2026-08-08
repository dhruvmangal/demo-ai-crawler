# Business Context

Why this system exists, who it's for, and what its outputs mean in
business terms. Read this layer when deciding *what* to build/change, not
*how* — for implementation detail, see
[../application-context/README.md](../application-context/README.md).

## Map of this layer

- [product-purpose-and-problem.md](product-purpose-and-problem.md) — the problem being solved and why crawl+LLM instead of manual documentation
- [personas-and-use-cases.md](personas-and-use-cases.md) — who uses this and for what
- [domain-model-glossary.md](domain-model-glossary.md) — what "Entity", "Action", "Workflow", "confidence" mean in business terms
- [deliverables-and-outputs.md](deliverables-and-outputs.md) — the concrete things a user/agent gets out of a run, and what each is for
- [trust-safety-and-limits.md](trust-safety-and-limits.md) — the business rationale for the read-only posture, and what this system is (and isn't) reliable enough for

## One-paragraph pitch

Point this at any web application and it comes back with a structured,
navigable understanding of it: every page and exactly how to reach it, every
button/form/table on those pages, the business objects the app manages
(Customer, Order, whatever's actually there), and multi-step workflows a
user could complete — all inferred automatically, without anyone writing
documentation or test scripts by hand. It can then turn any one of those
inferred workflows into a narrated demo video. The output is meant to be
consumed by both humans (onboarding, docs, demos) and other AI agents
(as a map + selectors so they don't have to explore an unfamiliar app blind).
