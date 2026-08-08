# Domain Model Glossary

Plain-language meaning of the concepts this system produces. For the
literal schema, see
[../application-context/data-model.md](../application-context/data-model.md)
and [../application-context/graph-model.md](../application-context/graph-model.md).

**Page** — one distinct URL (path + query) the crawler visited.
Carries *how it was reached*: the label and selector of the exact
link/button clicked on its parent page. This is the difference between a
sitemap and a set of directions — a downstream consumer (human or agent)
knows not just that a page exists, but exactly what to click to get
there.

**Component** — an interactive element found on a page: a button, form,
table, or dialog/modal. Business-meaningful because it's the app's actual
*capability surface* — what a user can actually do on that page, not just
what they can read.

**Entity** — a business/domain object the LLM inferred the app is
"about" — e.g. Customer, Order, Invoice, or whatever fits the actual
site. Not drawn from a fixed template; a marketing site or a docs site
will infer different (or no) entities than a CRM would. `entityType` is
the model's own free-text categorization (defaults to
`"BusinessObject"`).

**Action** — something a user can do to/with an entity (Create, Edit,
Approve, Refund, …), optionally tied to the selector that performs it.
This is the layer that turns "there's a button labeled Refund" into "you
can Refund an Order" — connecting UI to business meaning.

**Relationship** — a directed connection between two entities (e.g.
Customer `HAS_ORDER` Order). Describes how the business objects the app
manages relate to each other, mirroring how a domain model diagram would.

**Workflow** — a multi-step sequence a user could complete on the site
(e.g. "Create a Customer, then place an Order for them"), each step
optionally anchored to a page/action/entity. This is the highest-value
output for demoing or automating the app — it's the difference between
knowing an app *has* pages and forms versus knowing what a user actually
*does* with them end to end.

**Confidence** — a 0–1 score the LLM (or a fixed heuristic, for
UI-discovery-level confidence) attaches to its own output. Not a
statistical guarantee — treat it as the model's self-reported certainty,
useful for ranking/filtering (e.g. "top 10 entities by confidence" in the
summary), not as ground truth.

**Domain** (e.g. "Customer Relationship Management (CRM)",
"E-commerce Admin Panel", "Billing / Financial Dashboard", "Analytics
Platform", "Generic Dashboard") — a coarse, deterministic label
(`KnowledgeSummarizer`, keyword matching on entity names, not an LLM
call) meant for quick human orientation, not a rigorous classification.
See
[../application-context/features/knowledge-summarization.md](../application-context/features/knowledge-summarization.md)
for the exact rule.

**Project** — the grouping unit for one crawl target (`project_id`).
Everything from pages to entities to workflows belongs to exactly one
project. Re-crawling a project replaces its pages/entities/workflows
outright (see data-model doc) — there's no versioned history of "what
this app looked like last month."

**Workflow run** — one *recording* of a workflow: an independent
artifact (video + captions) produced by replaying a workflow's steps.
Distinct from the workflow itself — you can trigger multiple runs of the
same workflow (e.g. to re-record after a UI change), each an independent
`workflow_runs` row.
