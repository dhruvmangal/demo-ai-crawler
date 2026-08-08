# API Reference

Full interactive docs: `GET /api-docs` (Swagger UI over `src/api/openapi.json`).
This is the practical/annotated version. Base path for everything below is
`/api` (mounted in `server.ts`), except `/health` and `/recordings/*`.

| Method & Path | Body / Params | Returns | Notes |
|---|---|---|---|
| `GET /health` | — | `{status, timestamp}` | liveness check, no DB access |
| `POST /api/crawl` | `{targetUrl, projectId?}` | `201 {message, job}` | `projectId` optional — server mints a UUID if omitted. Inserts `crawl_jobs` row, `status=PENDING` |
| `GET /api/crawl/:id` | — | job row (`id, project_id, target_url, status, login_url, started_at, completed_at, error_message`) | `404` if unknown id |
| `POST /api/crawl/:id/credentials` | `{username, password}` | `{message}` | only valid when job `status=AWAITING_CREDENTIALS`; `409` otherwise. Writes to `crawl_credentials`, flips job back to `PENDING` |
| `GET /api/graph/:projectId` | — | `{nodes, edges}` | full Neo4j projection for the project, see [graph-model.md](graph-model.md) |
| `GET /api/summary/:projectId` | — | `{domain, summary_data, created_at}` | cheap digest from `knowledge_summaries`; `404` until the crawl completes and summarization has run |
| `POST /api/workflows/:workflowId/run` | — | `201 {message, run}` | `404` if workflow unknown. Inserts `workflow_runs` row, `status=PENDING` |
| `GET /api/workflow-runs/:id` | — | run row (`id, workflow_id, project_id, status, video_path, captions_path, error_message, started_at, completed_at`) | `404` if unknown id |
| `GET /recordings/:filename` | — | video/vtt file (static) | served from `RECORDINGS_DIR`; filenames come from `video_path`/`captions_path` above |

## Typical client sequences

**Crawl a site and read results:**
```
POST /api/crawl {targetUrl}          -> job.id, job.project_id
poll GET /api/crawl/:id              -> until status COMPLETED|FAILED
GET /api/summary/:project_id         -> lightweight digest
GET /api/graph/:project_id           -> full graph for visualization/automation
```

**Handle a login wall mid-crawl:**
```
poll GET /api/crawl/:id              -> status flips to AWAITING_CREDENTIALS, login_url set
POST /api/crawl/:id/credentials {username, password}
poll GET /api/crawl/:id              -> back to RUNNING, eventually COMPLETED|FAILED
```
See [features/login-handling.md](features/login-handling.md) for what
happens if the submitted credentials are wrong (it fails the job with
`LoginRequiredError('invalid_credentials')` rather than re-prompting).

**Record and fetch a workflow demo:**
```
GET /api/graph/:project_id           -> pick a :Workflow node's id
POST /api/workflows/:workflowId/run  -> run.id
poll GET /api/workflow-runs/:id      -> until status COMPLETED|FAILED
GET /recordings/:video_path          -> the .webm
GET /recordings/:captions_path       -> the .vtt
```

## Error shape

All error responses are `{error: string}` with a 4xx/5xx status —
`400` for missing required body fields, `404` for unknown ids, `409` for
an invalid state transition (credentials submitted when not awaiting
them), `500` wrapping any unexpected exception (`err.message` is
surfaced directly, unsanitized — this is a demo-grade service, not
hardened for untrusted API callers).
