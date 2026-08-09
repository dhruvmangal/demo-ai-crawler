---
name: demo-caption-writer
description: Turn a crawled project's knowledge (from crawler-knowledge-lookup) into an ordered, one-sentence-per-step narration/caption list for a demo recording -- verifying every claimed interaction against the live page before finalizing it, and filtering out destructive actions the same way SafetyEngine does. Use before generating any Playwright script for a demo, never after.
---

# Writing demo captions before any code exists

The caption list is the screenplay for the demo -- write it **before**
a single line of Playwright code. Generating code first and narrating
after tends to produce narration that just describes whatever the code
happens to do, rather than a deliberately chosen, watchable tour. Writing
captions first forces you to decide what's actually worth showing, and to
verify it's real, before investing in code.

## Process

For each candidate step (from a workflow's steps, or ones you're
composing yourself from a page-list fallback):

1. Draft a one-sentence, present-tense narration -- e.g. "Opens the
   Create Customer form and fills in the new customer's details," not
   "Click button then fill form."
2. **If the sentence implies a specific live interaction** (a click, a
   hover, a form fill, a search) -- verify it against the *real, current*
   page before keeping the caption. Fetch the live page (or drive a
   throwaway, non-recording headless browser to it) and confirm:
   - The element genuinely exists.
   - It's visible/interactable at the viewport you intend to record at
     (1280x720 is this app's standard -- some elements are hidden by
     responsive breakpoints and only appear at other sizes; that's a real
     failure mode, not a hypothetical one).
   - A click/interaction on it actually does what you expect -- don't
     assume a role/class match means it's wired up. It's normal for a
     plausible-looking interactive element to simply not respond (e.g. a
     tab switcher whose `aria-selected`/class never changes after a real
     `.click()`, despite the click landing).
   - If a locator matches more than one element, that's a sign to pick a
     more specific one (role + accessible name, `data-testid`, explicit
     `id`) -- not to silently take `.first()`, which can end up
     interacting with the wrong instance of several similar elements.
3. If verification fails, **drop the caption or rewrite it as something
   you did verify** (often: a pure view/navigation instead of the
   interaction you originally hoped for). Never keep a caption whose
   underlying action you haven't confirmed works.
4. Check the caption against a destructive-action filter before keeping
   it -- apply `SafetyEngine.checkAction`'s exact keyword list by hand
   (`src/safety/safety-engine.ts`), since you're standing in for that
   check manually: **delete, remove, destroy, refund, disable,
   deactivate, cancel, reset, void, terminate, clear, wipe**. If the
   element's label, selector, or the action itself matches any of these,
   do not caption it as an action -- either drop the step entirely or
   rewrite it as a safe view-only caption (e.g. narrate viewing a list
   that happens to contain a delete button, without ever narrating
   clicking it).

## Output

An ordered list, one entry per step:

```
{ stepNumber, narration, verifiedSelector? }
```

Steps with no direct target (pure navigation/viewing) don't need a
`verifiedSelector`. Steps that do need one should carry the *specific*
selector you confirmed works, not just the stored hint from
`crawler-knowledge-lookup` -- that hint is where you start looking, not
what you hand off unverified.

## Pacing

This list also drives how long the eventual recording will be. Don't
pad it artificially, but don't under-caption either -- a 2-step "view
page A, view page B" list produces a video too short to be watchable
(see `demo-recorder` for the actual dwell-time mechanics). If the
knowledge base only gave you a sparse 2-step workflow and the live site
clearly has more worth showing (real nav, search, meaningful toggles),
it's fine to compose additional verified steps yourself -- the caption
list should reflect a demo worth watching, not just a literal transcript
of whatever `workflow_steps` happened to record.
