// Thin client for the crawler-app REST API (see src/api/routes.ts in the main service).
export const API_BASE = 'http://localhost:3000/api';
export const RECORDINGS_BASE = 'http://localhost:3000/recordings';

export interface CrawlJob {
  id: string;
  project_id: string;
  target_url: string;
  status: 'PENDING' | 'RUNNING' | 'AWAITING_CREDENTIALS' | 'COMPLETED' | 'FAILED';
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

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function startCrawl(targetUrl: string): Promise<CrawlJob> {
  const res = await fetch(`${API_BASE}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUrl })
  });
  const data = await asJson<{ job: CrawlJob }>(res);
  return data.job;
}

export async function getCrawlJob(id: string): Promise<CrawlJob> {
  const res = await fetch(`${API_BASE}/crawl/${id}`);
  return asJson<CrawlJob>(res);
}

export async function getGraph(projectId: string): Promise<GraphResponse> {
  const res = await fetch(`${API_BASE}/graph/${projectId}`);
  return asJson<GraphResponse>(res);
}

export async function runWorkflow(workflowId: string): Promise<WorkflowRun> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, { method: 'POST' });
  const data = await asJson<{ run: WorkflowRun }>(res);
  return data.run;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRun> {
  const res = await fetch(`${API_BASE}/workflow-runs/${id}`);
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
  const res = await fetch(`${API_BASE}/crawl/${jobId}/credentials`, {
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
