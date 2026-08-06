import type { GraphResponse } from './api';

export interface PageTreeNode {
  id: string;
  url: string;
  title: string;
  viaLabel: string;
  viaSelector: string;
  children: PageTreeNode[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  confidence: number;
}

function pageNodeId(node: { properties: Record<string, any> }): string {
  return node.properties.id;
}

/** Builds the page tree from the graph's Page nodes + HAS_PAGE edges (label/selector = what to click to navigate). */
export function buildPageTree(graph: GraphResponse): PageTreeNode[] {
  const pageNodes = graph.nodes.filter((n) => n.labels.includes('Page'));
  const byId = new Map<string, PageTreeNode>();
  for (const n of pageNodes) {
    byId.set(pageNodeId(n), {
      id: pageNodeId(n),
      url: n.properties.url || '',
      title: n.properties.title || n.properties.url || 'Untitled page',
      viaLabel: '',
      viaSelector: '',
      children: []
    });
  }

  const hasPageEdges = graph.edges.filter((e) => e.type === 'HAS_PAGE');
  const childIds = new Set<string>();
  for (const edge of hasPageEdges) {
    const parent = byId.get(edge.source);
    const child = byId.get(edge.target);
    if (!parent || !child) continue;
    child.viaLabel = edge.properties?.label || '';
    child.viaSelector = edge.properties?.selector || '';
    parent.children.push(child);
    childIds.add(child.id);
  }

  // Roots = pages that never appear as a HAS_PAGE target.
  return Array.from(byId.values()).filter((n) => !childIds.has(n.id));
}

export function extractWorkflows(graph: GraphResponse): WorkflowSummary[] {
  return graph.nodes
    .filter((n) => n.labels.includes('Workflow'))
    .map((n) => ({
      id: n.properties.id,
      name: n.properties.name || 'Untitled workflow',
      confidence: typeof n.properties.confidence === 'number' ? n.properties.confidence : 0
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

function renderTreeNode(node: PageTreeNode): HTMLElement {
  const details = document.createElement('details');
  details.className = 'tree-node';
  details.open = true;

  const summary = document.createElement('summary');
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tree-title';
  titleSpan.textContent = node.title; // textContent — page titles come from crawled (untrusted) sites
  summary.appendChild(titleSpan);

  const urlSpan = document.createElement('span');
  urlSpan.className = 'tree-url';
  urlSpan.textContent = node.url;
  summary.appendChild(urlSpan);

  if (node.viaLabel || node.viaSelector) {
    const viaSpan = document.createElement('span');
    viaSpan.className = 'tree-via';
    viaSpan.textContent = `via "${node.viaLabel || node.viaSelector}"`;
    summary.appendChild(viaSpan);
  }

  details.appendChild(summary);

  if (node.children.length > 0) {
    const childList = document.createElement('div');
    childList.className = 'tree-children';
    for (const child of node.children) {
      childList.appendChild(renderTreeNode(child));
    }
    details.appendChild(childList);
  }

  return details;
}

export function renderTree(container: HTMLElement, roots: PageTreeNode[]) {
  container.innerHTML = '';
  if (roots.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No pages discovered.';
    container.appendChild(empty);
    return;
  }
  for (const root of roots) {
    container.appendChild(renderTreeNode(root));
  }
}

export function renderWorkflows(
  container: HTMLElement,
  workflows: WorkflowSummary[],
  onSelect: (workflow: WorkflowSummary) => void
) {
  container.innerHTML = '';
  if (workflows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No workflows inferred.';
    container.appendChild(empty);
    return;
  }

  const rows: HTMLButtonElement[] = [];
  for (const workflow of workflows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'workflow-row';
    row.setAttribute('aria-pressed', 'false');

    const marker = document.createElement('span');
    marker.className = 'workflow-marker';
    marker.textContent = '◆';

    const name = document.createElement('span');
    name.className = 'workflow-name';
    name.textContent = workflow.name; // textContent — workflow names are LLM output over untrusted site content

    const confidence = document.createElement('span');
    confidence.className = 'workflow-confidence';
    confidence.textContent = `${Math.round(workflow.confidence * 100)}%`;

    row.append(marker, name, confidence);
    row.addEventListener('click', () => {
      rows.forEach((r) => r.setAttribute('aria-pressed', 'false'));
      row.setAttribute('aria-pressed', 'true');
      onSelect(workflow);
    });

    rows.push(row);
    container.appendChild(row);
  }
}
