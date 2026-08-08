# Trust, Safety & Limits

## Why the system defaults to read-only / non-destructive

This crawls and interacts with **real, arbitrary web applications** —
potentially including production tools with real customer/order/billing
data — autonomously and without a human watching each click. The product
decision reflected throughout the codebase (see
[../application-context/features/safety-engine.md](../application-context/features/safety-engine.md))
is: discovery and narration are valuable and low-risk; actually performing
state-changing actions (delete a customer, refund an order, cancel a
subscription) on someone's real app without explicit human intent is not
something this tool should ever do on its own. That's why:
- Buttons/links matching a destructive-keyword blocklist are refused
  before they're ever clicked or queued, both during the exploratory
  crawl and during workflow-recording replay.
- Forms are discovered (fields, labels, requiredness) but never
  auto-submitted anywhere in the pipeline.
- The recording agent re-checks safety on every click it attempts, even
  against a selector it chose itself mid-run — not just once against the
  originally recorded selector.

## Where that trust boundary is weaker than it sounds

Be direct about this when advising a user or agent relying on this
system:
- The blocklist is a **substring keyword match** in English
  (`delete`, `refund`, `cancel`, etc.) — it will miss destructive actions
  phrased differently ("Archive," "Deactivate account" if "deactivate"
  weren't already listed, non-English UIs) and can false-positive on
  benign labels that happen to contain a keyword (e.g. "Clear filters").
  Treat "the Safety Engine allowed it" as necessary, not sufficient,
  evidence that an action is safe.
- Login handling can submit credentials into a real login form
  (`attemptLogin()`) — appropriate for a site the user owns/is authorized
  to test, not for use against arbitrary third-party sites without
  authorization.
- Credentials are held only transiently (`crawl_credentials`, deleted the
  moment the worker reads them) and never logged, but they do pass
  through the API and Postgres in plaintext in transit/at that brief
  rest — this is a demo/internal-tool-grade posture, not something to
  point at systems requiring compliance-grade credential handling without
  further hardening.

## Reliability limits worth setting expectations around

- **Selectors are heuristic, not guaranteed stable.** They're built from
  DOM structure (id/class/tag paths) at crawl time; a target site's own
  re-render or a subsequent code change can invalidate them. The
  workflow-recording agent is explicitly designed to route around this
  (it's told the recorded selector "may be stale" and can look up a
  fresh one) — but a consumer treating a selector as a permanent locator
  for their own automation should re-verify it, not assume permanence.
- **The LLM layers are best-effort, not authoritative.** Entities,
  workflows, and page summaries come from a small local model
  (`qwen2.5:3b-instruct` by default) reasoning over condensed summaries —
  useful for orientation and demoing, not a substitute for a verified
  domain model. Confidence scores are self-reported by the model, not
  validated.
- **No 2FA / CAPTCHA / OAuth support.** Login handling only covers a
  classic username+password form. Sites requiring anything more will
  either fail the crawl outright or get stuck reporting
  `invalid_credentials` even with correct ones.
- **A crawl is a snapshot, not a monitor.** Nothing in this system
  re-crawls automatically or diffs against a prior crawl — `dom_hash` is
  stored but not currently used for change detection anywhere in the
  pipeline. "This app's structure hasn't changed since we last looked" is
  not a claim this system currently makes.
- **Full rebuild per crawl.** Re-crawling a project replaces its
  pages/entities/workflows outright (see
  [../application-context/data-model.md](../application-context/data-model.md)) —
  there is no retained history of how an app's structure evolved across
  crawls.
