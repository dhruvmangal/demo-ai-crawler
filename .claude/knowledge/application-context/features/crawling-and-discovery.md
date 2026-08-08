# Crawling & Discovery

Source: `src/crawler/playwright-crawler.ts`, `src/discovery/*.ts`.

## `PlaywrightCrawler.crawl()` — the loop

A breadth-first traversal over a `QueueItem { url, fromUrl?, viaLabel?,
viaSelector? }` queue, seeded with `options.startUrl`. Per iteration:

1. Pop the queue, normalize the URL (`normalizeUrl`: strips trailing slash
   from the pathname, keeps `protocol://host + pathname + search`), skip
   if already visited or `visitedUrls.size >= maxPages`.
2. `page.goto(url, {waitUntil: 'domcontentloaded'})` + a fixed 1s settle
   wait for animations/renders.
3. **Login-wall check** (first page only, see
   [login-handling.md](login-handling.md)).
4. `PageDiscovery.discover(page)` → title, breadcrumb, structural DOM
   hash/JSON.
5. `NavigationDiscovery.discover(page)` → candidate same-origin links,
   each checked against `SafetyEngine.checkAction(label, selector,
   'Navigate')` before being queued — a link whose label/selector/href
   contains a destructive keyword is dropped, not just deprioritized.
6. `UiDiscovery.discover(page)` → buttons/forms/tables/dialogs on the
   current page.
7. **Modal-revelation heuristic**: if no dialog is already open, click
   buttons whose label contains add/create/open/view/show (each still
   gated by `SafetyEngine`), re-run `UiDiscovery` to capture newly-revealed
   fields, then press `Escape` to close it back out. This is how the
   crawler finds a "Create Customer" modal's form fields without a human
   ever recording that flow.
8. Push the page's full record (`url, title, breadcrumb, domHash, domJson,
   html, elements, parentUrl, viaLabel, viaSelector`) into `pagesData`,
   which is the crawl's return value, later consumed by
   `KnowledgeBuilder.build()`.

Per-page failures (`pageErr`) are caught, logged, and the crawl continues
to the next queued URL — **except** `LoginRequiredError`, which propagates
out of `crawl()` entirely (a login wall is a crawl-level condition, not a
single bad page).

`browser.close()` always runs in a `finally`.

## `PageDiscovery.discover()`

Runs inside the page (`page.evaluate`) to extract:
- **Breadcrumb**: text from `.breadcrumb`/`.breadcrumbs`/`[aria-label=
  "breadcrumb"]`/`.breadcrumb-list`, joined with `>`; falls back to
  Title-Cased URL path segments if no breadcrumb element exists.
- **Structural DOM tree**: recursively walks `document.body`, keeping only
  `tag`/`id`/`class`/`children` (drops `script`/`style`/`svg`/`path`/
  `noscript` and all text content) — this is what gets hashed
  (`crypto.createHash('sha256')`) into `dom_hash` and stored verbatim as
  `page_snapshots.dom_json`.
- Returns `url` as **path + query only** (host stripped) — pages are
  identified relative to their project's origin.

## `NavigationDiscovery.discover()`

Scans known nav containers (`nav`, `aside`, `.sidebar`, `#sidebar`,
`.menu`, `.navigation`, `header`, `footer`) for `<a>` tags, builds a
best-effort stable CSS selector path for each (walking up parents,
preferring an ancestor `id`), then does a second pass over *all* remaining
anchors on the page (label length < 50 chars) to make sure link coverage
isn't limited to elements inside a recognized nav container. Also
specifically extracts breadcrumb anchors. Filters out `#`-only and
`javascript:` hrefs.

## `UiDiscovery.discover()`

Four independent passes over the page, each producing `UiElement`-shaped
objects (`pageId` left `''`, filled in later by `KnowledgeBuilder`):

1. **Dialogs/modals** — `dialog`, `[role="dialog"]`, `.modal`, `.popup`,
   `.dialog`, `.side-panel`, `.drawer`, `.aside-panel`, filtered to those
   actually visible (`display`/`visibility`/`opacity` computed style
   checks). Captures inner button labels in `metadata.innerButtons`.
2. **Forms** — `form`, `[role="form"]`, `.form-container`. Extracts every
   `input`/`select`/`textarea` as a field: `name`, resolved `label`
   (checks `label[for=id]`, then closest ancestor `<label>`, then
   `placeholder`/`aria-label`), `type`, `required`, `pattern`,
   `placeholder`.
3. **Tables** — `table`, `.table`, `[role="table"]`, `.grid-container`.
   Extracts column headers (`th`/`.table-header`/`[role="columnheader"]`)
   and de-duplicated row-action button labels (e.g. "Edit"/"Delete" found
   inside `td`/`.table-cell`).
4. **Buttons** — broad selector set, explicitly *excluding* anything
   inside `nav`/`aside`/`.sidebar`/`#sidebar` (those are navigation,
   already covered by `NavigationDiscovery`). Records whether the button
   sits inside a form or table via `metadata.formId`/`metadata.tableId`.

`getSelector()` (local helper, duplicated conceptually across discovery
files) prefers `id`, then `data-testid`/`data-target`, then
`tag.class1.class2.class3[name="..."]` — heuristic, not guaranteed unique
or stable across a site's own re-renders.

## Confidence scores

Every discovered `UiElement` gets a fixed heuristic confidence
(dialogs 0.95, forms 0.95, tables 0.90, buttons 0.85) reflecting how
reliable that detection pattern generally is — not a per-instance
computed score.
