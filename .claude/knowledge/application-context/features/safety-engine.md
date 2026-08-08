# Safety Engine

Source: `src/safety/safety-engine.ts` (`SafetyEngine`). A single static
utility, no state, no config — a keyword blocklist checked wherever the
system is about to autonomously interact with a page.

## The check

```
DESTRUCTIVE_KEYWORDS = [
  'delete', 'remove', 'destroy', 'refund', 'disable', 'deactivate',
  'cancel', 'reset', 'void', 'terminate', 'clear', 'wipe'
]
```

`checkAction(label, selector, actionType?)` lowercases and concatenates
`label + selector + actionType`, and returns `{safe: false, reason}` if
*any* keyword appears anywhere in that combined string — a false-positive
-prone but conservative substring match (e.g. a button labeled "Clear
filters" would be blocked). `checkFormSubmission(formLabel, actionUrl?)`
is the same check applied to form label + action URL, though nothing in
the current codebase actually calls it — forms are discovered and
recorded, never auto-submitted by the crawler itself, so it exists as a
guard for hypothetical future auto-submit behavior.

Default posture is documented in the source as **read-only/inspection
mode**: standard navigation and button clicks to open/view something are
allowed by default; only pattern-matched destructive actions are blocked.

## Where it's enforced

1. **Crawl-time link queuing** (`playwright-crawler.ts`) — every
   discovered same-origin link is checked with `actionType='Navigate'`
   before being added to the crawl queue. A blocked link is simply never
   visited (logged as `[Safety Warning]`).
2. **Crawl-time modal-revelation clicks** (`playwright-crawler.ts`) —
   before clicking an add/create/open/view/show button to reveal a modal
   and discover its fields, checked with `actionType='Click'`. Blocked
   clicks are skipped (logged as `[Safety Intercepted]`).
3. **Workflow replay clicks** (`agent/workflow-orchestrator.ts`) — every
   `click` tool call the Claude agent attempts is re-checked against
   *whatever selector the agent actually chose* (which may differ from
   the originally recorded selector), not just validated once at record
   time. A blocked click surfaces to the agent as an `is_error` tool
   result, and the step is flagged `actionSkipped: true` (which the
   caption builder appends `(action skipped for safety)` to).

Nothing in the crawler or the workflow agent ever submits a form or
performs a genuinely destructive action end-to-end — the system is built
to *discover* what's possible (including opening modals to see their
fields) and to *narrate* workflows, not to actually create/delete/refund
real data.

## Known limitations (by design, not oversight)

- Substring matching means only the specific listed English keywords are
  caught — no semantic understanding, no other-language support, easily
  bypassed by an app that phrases destructive actions differently (e.g.
  "Archive" for what is functionally a delete).
- No allowlist/denylist configuration — the keyword list is hardcoded and
  would require a code change to adjust per-target-site risk tolerance.
