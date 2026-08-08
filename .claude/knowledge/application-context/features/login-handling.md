# Login-Wall Handling

Source: `LoginRequiredError`/`attemptLogin` in `src/crawler/playwright-crawler.ts`,
`crawl_jobs.status = AWAITING_CREDENTIALS` handling in
`src/workers/crawl-worker.ts`, `POST /api/crawl/:id/credentials` in
`src/api/routes.ts`, `crawl_credentials` table in `init.sql`.

## Detection

Only checked on the **first page** of a crawl
(`this.visitedUrls.size === 1`): if a `input[type="password"]` element is
present, the crawler treats the site as login-gated.

- No credentials supplied on this attempt → `LoginRequiredError(url,
  'no_credentials')`.
- Credentials supplied but `attemptLogin()` returns `false` →
  `LoginRequiredError(url, 'invalid_credentials')`.

`LoginRequiredError` is the one exception type that's allowed to escape
`PlaywrightCrawler.crawl()`'s per-page try/catch — it's a crawl-level
condition, not a single bad page to skip.

## `attemptLogin()` heuristic

1. Find the first matching field from a priority list of username/email
   selectors (`input[type="email"]`, `input[name="username"]`,
   `input[name="email"]`, `input[id*="user" i]`, `input[id*="email" i]`,
   `input[autocomplete="username"]`, then a generic `input[type="text"]`
   as last resort).
2. Fill username + `input[type="password"]`.
3. Submit via `button[type="submit"], input[type="submit"]` if present,
   else press Enter in the password field.
4. **Success judgment, in order of preference:**
   - If the submit triggered a full navigation and the response is
     `!response.ok()` (4xx/5xx) → definite failure.
   - Otherwise (SPA-style submit with no full navigation, or a 2xx/3xx
     response) → fall back to "is a password field still present?" — if
     it disappeared, assume success. This fallback is explicitly
     documented in the source as guessable/foolable by a failure page
     that happens to omit the password field.

No 2FA, CAPTCHA, or OAuth-redirect support — those will surface as a
generic login failure (`invalid_credentials` or a stuck password field).

## Worker-side flow

`crawl-worker.ts`'s `processNextJob()`:
1. Claims the job, checks `crawl_credentials` for a row matching this
   `crawl_job_id`, and **deletes it immediately upon reading** —
   regardless of whether the login attempt that follows succeeds. So a
   credential submission is consumed exactly once, never retried
   automatically.
2. Passes `credentials` (if any) into `PlaywrightCrawler.crawl()`.
3. On `LoginRequiredError`: sets `status = AWAITING_CREDENTIALS`,
   `login_url`, `error_message` — does **not** mark the job `FAILED`.
   The job simply sits there until credentials are submitted.
4. Any other thrown error still marks the job `FAILED`.

## Caller-side flow

`POST /api/crawl/:id/credentials`:
- `400` if `username`/`password` missing.
- `404` if the job doesn't exist.
- `409` if the job's current status isn't `AWAITING_CREDENTIALS` (you
  can't pre-submit credentials, and you can't resubmit after the job has
  already moved on).
- On success: deletes any prior submission for this job (only the latest
  one wins if you resubmit while still `AWAITING_CREDENTIALS`), inserts
  the new one, flips the job back to `PENDING` and clears
  `error_message` — the next `crawl-worker` poll (≤5s) picks it up and
  retries from the start of `crawl()` (re-navigates to `login_url`, this
  time with credentials).

If the resubmitted credentials are *also* wrong, the job goes straight to
`FAILED` (not back to `AWAITING_CREDENTIALS`) — there's no infinite
"try again" loop; the caller has to queue a brand-new `POST /api/crawl` to
retry from scratch.
