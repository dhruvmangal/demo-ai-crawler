// Thin client for the crawler-app REST API (see src/api/routes.ts in the main service).
import { AuthService } from './auth';

export const API_BASE = 'http://localhost:3000/api';
export const RECORDINGS_BASE = 'http://localhost:3000/recordings';

export interface CrawlJob {
  id: string;
  project_id: string;
  target_url: string;
  status: 'PENDING' | 'RUNNING' | 'AWAITING_CREDENTIALS' | 'ENRICHING' | 'COMPLETED' | 'FAILED';
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface GraphNode {
  labels: string[];
  properties: Record<string, any>;
}

export interface GraphEdge {
  type: string;
  source: string;
  target: string;
  properties: Record<string, any>;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  project_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  video_path?: string | null;
  captions_path?: string | null;
  error_message?: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

/** Unwraps the {success,data}/{success,error} envelope every API response is now wrapped in. */
async function asJson<T>(res: Response): Promise<T> {
  let body: Envelope<T> | undefined;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // fall through to status-based error below
  }

  if (!res.ok || !body || !body.success) {
    const message = body?.error?.message || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return body.data as T;
}

/**
 * fetch() wrapper that attaches the stored access token and retries exactly once after a
 * silent AuthService.refreshSession() on a 401, mirroring public/admin/auth.js's
 * authorizedFetch pattern (adapted for chrome.storage.local instead of localStorage).
 */
async function authorizedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await AuthService.getValidAccessToken();
  if (!token) {
    throw new Error('Not logged in.');
  }

  const withAuth = (t: string): RequestInit => ({
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${t}` }
  });

  let res = await fetch(url, withAuth(token));
  if (res.status === 401) {
    const refreshed = await AuthService.refreshSession();
    if (!refreshed) {
      throw new Error('Session expired. Please log in again.');
    }
    const newToken = await AuthService.getValidAccessToken();
    if (!newToken) {
      throw new Error('Session expired. Please log in again.');
    }
    res = await fetch(url, withAuth(newToken));
  }
  return res;
}

export async function startCrawl(targetUrl: string): Promise<CrawlJob> {
  const res = await authorizedFetch(`${API_BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUrl })
  });
  const data = await asJson<{ job: CrawlJob }>(res);
  return data.job;
}

export async function getCrawlJob(id: string): Promise<CrawlJob> {
  const res = await authorizedFetch(`${API_BASE}/crawl/${id}`);
  return asJson<CrawlJob>(res);
}

export async function getGraph(projectId: string): Promise<GraphResponse> {
  const res = await authorizedFetch(`${API_BASE}/graph/${projectId}`);
  return asJson<GraphResponse>(res);
}

export async function runWorkflow(workflowId: string): Promise<WorkflowRun> {
  const res = await authorizedFetch(`${API_BASE}/workflows/${workflowId}/run`, { method: 'POST' });
  const data = await asJson<{ run: WorkflowRun }>(res);
  return data.run;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRun> {
  const res = await authorizedFetch(`${API_BASE}/workflow-runs/${id}`);
  return asJson<WorkflowRun>(res);
}

export function pollWorkflowRun(
  id: string,
  onUpdate: (run: WorkflowRun) => void,
  intervalMs = 2000
): { cancel: () => void } {
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    try {
      const run = await getWorkflowRun(id);
      if (cancelled) return;
      onUpdate(run);
      if (run.status === 'COMPLETED' || run.status === 'FAILED') return;
    } catch {
      // transient network hiccup — keep polling
    }
    if (!cancelled) setTimeout(tick, intervalMs);
  };

  tick();
  return { cancel: () => { cancelled = true; } };
}

export async function submitCredentials(
  jobId: string,
  username: string,
  password: string
): Promise<{ message: string }> {
  const res = await authorizedFetch(`${API_BASE}/crawl/${jobId}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return asJson(res);
}

/**
 * Polls a crawl job until it reaches a terminal state (COMPLETED/FAILED), or
 * AWAITING_CREDENTIALS which the caller surfaces to the user.
 */
export function pollCrawlJob(
  id: string,
  onUpdate: (job: CrawlJob) => void,
  intervalMs = 2000
): { cancel: () => void } {
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    try {
      const job = await getCrawlJob(id);
      if (cancelled) return;
      onUpdate(job);
      if (job.status === 'COMPLETED' || job.status === 'FAILED') return;
    } catch (err) {
      // transient network hiccup — keep polling, the caller sees status via onUpdate only
    }
    if (!cancelled) setTimeout(tick, intervalMs);
  };

  tick();
  return { cancel: () => { cancelled = true; } };
}
