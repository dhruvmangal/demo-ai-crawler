/**
 * Narreto admin backoffice.
 *
 * Drives three existing surfaces of the API: /api/admin/* (crawl requests + their
 * Postgres-side data), /api/graph/:projectId (the Neo4j projection) and /recordings/*
 * (the .webm + .vtt written by workflow-agent-worker).
 *
 * Everything rendered here originates from crawled third-party sites or LLM output, so
 * text is only ever inserted with textContent -- never innerHTML.
 */

const POLL_MS = 5000;
const MAX_GRAPH_NODES = 500;

const LABEL_STYLE = {
  Page: { color: '#35e2ff', radius: 9 },
  Component: { color: '#1a6b80', radius: 4 },
  Entity: { color: '#ffb454', radius: 9 },
  Action: { color: '#b78bff', radius: 6 },
  Workflow: { color: '#6effa8', radius: 11 },
  WorkflowStep: { color: '#4a8fa0', radius: 5 }
};
const DEFAULT_HIDDEN_LABELS = ['Component'];

const state = {
  totals: null,
  requests: [],
  filter: '',
  selectedId: null,
  detail: null,
  activeTab: 'overview',
  graph: null,
  graphProjectId: null,
  hiddenLabels: new Set(DEFAULT_HIDDEN_LABELS),
  signatures: { graph: null, recordings: null },
  simulation: null
};

const els = {
  totals: document.getElementById('totals'),
  list: document.getElementById('request-list'),
  detail: document.getElementById('detail'),
  filter: document.getElementById('filter'),
  autoRefresh: document.getElementById('auto-refresh'),
  tpl: document.getElementById('tpl-detail')
};

/* ------------------------------------------------------------------ helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function chip(status) {
  const node = el('span', `chip status-${status || 'UNKNOWN'}`, status || 'unknown');
  return node;
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtDuration(from, to) {
  if (!from || !to) return '—';
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function pct(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

async function getJSON(url) {
  const res = await AdminAuth.authorizedFetch(url);
  if (!res.ok) {
    throw new Error(await AdminAuth.parseErrorMessage(res));
  }
  const body = await res.json();
  return body.data;
}

function definitionList(pairs, className) {
  const dl = el('dl', className || 'kv');
  for (const [key, value] of pairs) {
    dl.appendChild(el('dt', null, key));
    const dd = el('dd');
    if (value instanceof Node) dd.appendChild(value);
    else dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    dl.appendChild(dd);
  }
  return dl;
}

function card(title, ...children) {
  const box = el('div', 'card');
  if (title) box.appendChild(el('h3', null, title));
  for (const child of children) if (child) box.appendChild(child);
  return box;
}

function table(headers, rows) {
  const wrap = el('div', 'table-scroll');
  const t = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  headers.forEach((h) => headRow.appendChild(el('th', null, h)));
  thead.appendChild(headRow);
  t.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach((cells) => {
    const tr = el('tr');
    cells.forEach((cell) => {
      const td = el('td');
      if (cell instanceof Node) td.appendChild(cell);
      else td.textContent = cell === null || cell === undefined || cell === '' ? '—' : String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

/* --------------------------------------------------------------- top totals */

function renderTotals() {
  els.totals.replaceChildren();
  if (!state.totals) return;
  const items = [
    ['requests', state.totals.requests],
    ['active', state.totals.requests_active],
    ['pages', state.totals.pages],
    ['entities', state.totals.entities],
    ['workflows', state.totals.workflows],
    ['runs', state.totals.runs],
    ['videos', state.totals.videos]
  ];
  for (const [label, value] of items) {
    const box = el('div', 'total');
    box.appendChild(el('span', 'total-value', value ?? 0));
    box.appendChild(el('span', 'total-label', label));
    els.totals.appendChild(box);
  }
}

/* ------------------------------------------------------------ requests list */

function matchesFilter(request) {
  const q = state.filter.trim().toLowerCase();
  if (!q) return true;
  return [request.target_url, request.status, request.id, request.project_id]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q));
}

function renderList() {
  const visible = state.requests.filter(matchesFilter);
  els.list.replaceChildren();

  if (visible.length === 0) {
    els.list.appendChild(el('p', 'empty-state', state.requests.length ? 'No matching requests.' : 'No crawl requests yet.'));
    return;
  }

  for (const request of visible) {
    const row = el('button', 'request-row');
    row.type = 'button';
    row.setAttribute('aria-pressed', String(request.id === state.selectedId));

    row.appendChild(el('span', 'request-url', request.target_url));

    const sub = el('div', 'request-sub');
    sub.appendChild(chip(request.status));
    sub.appendChild(el('span', null, fmtTime(request.created_at)));
    row.appendChild(sub);

    row.appendChild(
      el(
        'div',
        'request-counts',
        `${request.page_count} pages · ${request.entity_count} entities · ${request.workflow_count} workflows · ${request.video_count}/${request.run_count} videos`
      )
    );

    row.addEventListener('click', () => selectRequest(request.id));
    els.list.appendChild(row);
  }
}

/* ------------------------------------------------------------------- detail */

function selectRequest(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  state.detail = null;
  state.graph = null;
  state.graphProjectId = null;
  state.signatures = { graph: null, recordings: null };
  stopSimulation();
  renderList();
  els.detail.replaceChildren(el('p', 'empty-state', 'Loading…'));
  loadDetail();
}

async function loadDetail() {
  if (!state.selectedId) return;
  try {
    state.detail = await getJSON(`/api/admin/requests/${state.selectedId}`);
    renderDetail();
  } catch (err) {
    els.detail.replaceChildren(el('div', 'error-box', `Failed to load request: ${err.message}`));
  }
}

function recordingsSignature(detail) {
  return detail.runs.map((r) => `${r.id}:${r.status}:${r.video_path || ''}`).join('|') +
    '#' + detail.workflows.map((w) => w.id).join(',');
}

function graphSignature(detail) {
  return `${detail.job.status}:${detail.pages.length}:${detail.entities.length}:${detail.workflows.length}`;
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return;

  const root = els.tpl.content.cloneNode(true);
  root.querySelector('.detail-title').textContent = detail.job.target_url;
  root.querySelector('.detail-meta').textContent =
    `job ${detail.job.id} · project ${detail.job.project_id} · created ${fmtTime(detail.job.created_at)}`;
  const statusChip = root.querySelector('.detail-status');
  statusChip.className = `chip status-${detail.job.status}`;
  statusChip.textContent = detail.job.status;

  const tabs = Array.from(root.querySelectorAll('.tab'));
  const panels = Array.from(root.querySelectorAll('.tab-panel'));
  tabs.forEach((tab) => {
    const name = tab.dataset.tab;
    tab.setAttribute('aria-selected', String(name === state.activeTab));
    tab.addEventListener('click', () => {
      state.activeTab = name;
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
      panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
      if (name === 'graph') ensureGraph();
    });
  });
  panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === state.activeTab));

  els.detail.replaceChildren(root);

  renderOverview(panelFor('overview'), detail);
  renderRecordings(panelFor('recordings'), detail);
  renderPages(panelFor('pages'), detail);
  state.signatures.recordings = recordingsSignature(detail);
  state.signatures.graph = graphSignature(detail);

  if (state.activeTab === 'graph') ensureGraph();
  else panelFor('graph').appendChild(el('p', 'empty-state', 'Open this tab to render the graph.'));
}

function panelFor(name) {
  return els.detail.querySelector(`.tab-panel[data-panel="${name}"]`);
}

/* ----------------------------------------------------------------- overview */

function renderOverview(panel, detail) {
  panel.replaceChildren();
  const job = detail.job;

  if (job.error_message) {
    panel.appendChild(card('Error', el('div', 'error-box', job.error_message)));
  }
  if (job.status === 'AWAITING_CREDENTIALS') {
    panel.appendChild(
      card('Awaiting credentials', el('p', null, `The crawler paused at ${job.login_url || 'a login page'} and is waiting for POST /api/crawl/${job.id}/credentials.`))
    );
  }

  const grid = el('div', 'grid-2');

  grid.appendChild(
    card(
      'Request',
      definitionList([
        ['Target URL', job.target_url],
        ['Status', chip(job.status)],
        ['Job id', job.id],
        ['Project id', job.project_id],
        ['Created', fmtTime(job.created_at)],
        ['Started', fmtTime(job.started_at)],
        ['Completed', fmtTime(job.completed_at)],
        ['Crawl duration', fmtDuration(job.started_at, job.completed_at)]
      ])
    )
  );

  const runsDone = detail.runs.filter((r) => r.status === 'COMPLETED').length;
  const runsFailed = detail.runs.filter((r) => r.status === 'FAILED').length;
  grid.appendChild(
    card(
      'Knowledge extracted',
      definitionList([
        ['Pages', detail.pages.length],
        ['UI components', detail.pages.reduce((sum, p) => sum + (p.element_count || 0), 0)],
        ['Entities', detail.entities.length],
        ['Actions', detail.entities.reduce((sum, e) => sum + e.actions.length, 0)],
        ['Relationships', detail.relationships.length],
        ['Workflows', detail.workflows.length],
        ['Recording runs', `${detail.runs.length} (${runsDone} completed, ${runsFailed} failed)`]
      ])
    )
  );

  panel.appendChild(grid);

  if (detail.summary) {
    panel.appendChild(
      card(
        'Domain summary',
        definitionList([
          ['Domain', detail.summary.domain],
          ['Generated', fmtTime(detail.summary.created_at)]
        ]),
        el('pre', null, JSON.stringify(detail.summary.summary_data, null, 2))
      )
    );
  }

  if (detail.entities.length > 0) {
    panel.appendChild(
      card(
        'Entities & actions',
        table(
          ['Entity', 'Type', 'Confidence', 'Actions'],
          detail.entities.map((e) => [
            e.name,
            e.entity_type,
            pct(e.confidence),
            e.actions.map((a) => a.action_type).join(', ')
          ])
        )
      )
    );
  }

  if (detail.relationships.length > 0) {
    panel.appendChild(
      card(
        'Relationships',
        table(
          ['Source', 'Type', 'Target', 'Confidence'],
          detail.relationships.map((r) => [r.source_name, r.relationship_type, r.target_name, pct(r.confidence)])
        )
      )
    );
  }
}

/* -------------------------------------------------------------------- pages */

function renderPages(panel, detail) {
  panel.replaceChildren();
  if (detail.pages.length === 0) {
    panel.appendChild(el('p', 'empty-state', 'No pages discovered for this project.'));
    return;
  }

  panel.appendChild(
    card(
      `Discovered pages (${detail.pages.length})`,
      table(
        ['Title', 'URL', 'Via', 'Components', 'AI description'],
        detail.pages.map((p) => {
          const link = el('a', null, p.url);
          link.href = p.url;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          return [p.title, link, p.via_label, p.element_count, p.ai_description || p.ai_summary];
        })
      )
    )
  );
}

/* ------------------------------------------------------------ video player */

function svgIcon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.innerHTML = paths;
  return svg;
}

const PLAYER_ICONS = {
  play: '<polygon points="7,4 20,12 7,20" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  replay: '<path fill="currentColor" d="M12 5V1L6.5 6.5 12 12V8a4 4 0 1 1-4 4H6a6 6 0 1 0 6-6z"/>',
  back: '<path fill="currentColor" d="M11 5V1L5.5 6.5 11 12V8a4 4 0 1 1-4 4H5a6 6 0 1 0 6-6z"/>',
  fwd: '<path fill="currentColor" d="M13 5V1l5.5 5.5L13 12V8a4 4 0 1 0 4 4h2a6 6 0 1 1-6-6z"/>',
  volume: '<path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  muted: '<path fill="currentColor" d="M4 9v6h4l5 5V4L8 9H4z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M16 9l4.5 6M20.5 9L16 15"/>',
  expand: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  collapse: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>',
};

const PLAYER_ASPECT_MODES = [
  { key: 'contain', label: 'FIT' },
  { key: 'cover', label: 'FILL' },
  { key: 'fill', label: 'STRETCH' },
];

function formatPlayerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function createVideoPlayer({ src, captionsSrc }) {
  const player = el('div', 'player');
  player.tabIndex = 0;

  const media = el('div', 'player-media');
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = src;
  video.style.objectFit = PLAYER_ASPECT_MODES[0].key;
  media.appendChild(video);

  let track = null;
  if (captionsSrc) {
    track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'Narration';
    track.srclang = 'en';
    track.src = captionsSrc;
    video.appendChild(track);
    track.track.mode = 'disabled';
  }

  const bigButton = el('button', 'player-bigplay');
  bigButton.type = 'button';
  bigButton.appendChild(svgIcon(PLAYER_ICONS.play));
  media.appendChild(bigButton);
  player.appendChild(media);

  const controls = el('div', 'player-controls');

  const progress = el('div', 'player-progress');
  const buffered = el('div', 'player-progress-buffered');
  const played = el('div', 'player-progress-played');
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'player-seek';
  seek.min = '0';
  seek.max = '1000';
  seek.value = '0';
  progress.append(buffered, played, seek);
  controls.appendChild(progress);

  const row = el('div', 'player-row');

  const playBtn = el('button', 'player-btn');
  playBtn.type = 'button';
  playBtn.appendChild(svgIcon(PLAYER_ICONS.play));

  const backBtn = el('button', 'player-btn player-skip');
  backBtn.type = 'button';
  backBtn.appendChild(svgIcon(PLAYER_ICONS.back));
  backBtn.appendChild(el('span', 'player-skip-label', '10'));

  const fwdBtn = el('button', 'player-btn player-skip');
  fwdBtn.type = 'button';
  fwdBtn.appendChild(svgIcon(PLAYER_ICONS.fwd));
  fwdBtn.appendChild(el('span', 'player-skip-label', '10'));

  const volumeWrap = el('div', 'player-volume');
  const muteBtn = el('button', 'player-btn');
  muteBtn.type = 'button';
  muteBtn.appendChild(svgIcon(PLAYER_ICONS.volume));
  const volumeRange = document.createElement('input');
  volumeRange.type = 'range';
  volumeRange.className = 'player-volume-range';
  volumeRange.min = '0';
  volumeRange.max = '1';
  volumeRange.step = '0.01';
  volumeRange.value = '1';
  volumeWrap.append(muteBtn, volumeRange);

  const time = el('span', 'player-time', '0:00 / 0:00');
  const spacer = el('div', 'player-spacer');

  const ccBtn = el('button', 'player-btn player-pill', 'CC');
  ccBtn.type = 'button';
  if (!track) ccBtn.disabled = true;

  const aspectBtn = el('button', 'player-btn player-pill', PLAYER_ASPECT_MODES[0].label);
  aspectBtn.type = 'button';

  const fsBtn = el('button', 'player-btn');
  fsBtn.type = 'button';
  fsBtn.appendChild(svgIcon(PLAYER_ICONS.expand));

  row.append(playBtn, backBtn, fwdBtn, volumeWrap, time, spacer, ccBtn, aspectBtn, fsBtn);
  controls.appendChild(row);
  player.appendChild(controls);

  function setPlayIcon(isPlaying) {
    playBtn.replaceChildren(svgIcon(isPlaying ? PLAYER_ICONS.pause : PLAYER_ICONS.play));
    bigButton.replaceChildren(svgIcon(video.ended ? PLAYER_ICONS.replay : isPlaying ? PLAYER_ICONS.pause : PLAYER_ICONS.play));
  }

  function togglePlay() {
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }

  media.addEventListener('click', togglePlay);
  playBtn.addEventListener('click', togglePlay);

  video.addEventListener('play', () => {
    setPlayIcon(true);
    player.classList.add('is-playing');
    scheduleIdle();
  });
  video.addEventListener('pause', () => {
    setPlayIcon(false);
    player.classList.remove('is-playing');
    showControls();
  });
  video.addEventListener('ended', () => {
    setPlayIcon(false);
    player.classList.remove('is-playing');
    showControls();
  });

  backBtn.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
  });
  fwdBtn.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
  });

  let lastVolume = 1;
  function updateVolumeIcon() {
    muteBtn.replaceChildren(svgIcon(video.muted || video.volume === 0 ? PLAYER_ICONS.muted : PLAYER_ICONS.volume));
  }
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = lastVolume || 1;
    volumeRange.value = video.muted ? '0' : String(video.volume);
    updateVolumeIcon();
  });
  volumeRange.addEventListener('input', () => {
    const v = Number(volumeRange.value);
    video.volume = v;
    video.muted = v === 0;
    if (v > 0) lastVolume = v;
    updateVolumeIcon();
  });

  let seeking = false;
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => {
    if (!Number.isFinite(video.duration)) return;
    played.style.width = `${Number(seek.value) / 10}%`;
    video.currentTime = (Number(seek.value) / 1000) * video.duration;
  });
  seek.addEventListener('change', () => { seeking = false; });

  video.addEventListener('timeupdate', () => {
    if (!seeking && Number.isFinite(video.duration) && video.duration > 0) {
      const pct = (video.currentTime / video.duration) * 1000;
      seek.value = String(pct);
      played.style.width = `${pct / 10}%`;
    }
    time.textContent = `${formatPlayerTime(video.currentTime)} / ${formatPlayerTime(video.duration)}`;
  });

  video.addEventListener('progress', () => {
    if (!video.buffered.length || !Number.isFinite(video.duration) || video.duration === 0) return;
    const end = video.buffered.end(video.buffered.length - 1);
    buffered.style.width = `${Math.min(100, (end / video.duration) * 100)}%`;
  });

  video.addEventListener('loadedmetadata', () => {
    time.textContent = `${formatPlayerTime(video.currentTime)} / ${formatPlayerTime(video.duration)}`;
  });

  video.addEventListener('error', () => {
    player.replaceChildren(el('div', 'error-box', 'This recording could not be loaded.'));
  });

  if (track) {
    ccBtn.addEventListener('click', () => {
      const showing = track.track.mode === 'showing';
      track.track.mode = showing ? 'disabled' : 'showing';
      ccBtn.classList.toggle('active', !showing);
    });
  }

  let aspectIndex = 0;
  aspectBtn.addEventListener('click', () => {
    aspectIndex = (aspectIndex + 1) % PLAYER_ASPECT_MODES.length;
    const mode = PLAYER_ASPECT_MODES[aspectIndex];
    video.style.objectFit = mode.key;
    aspectBtn.textContent = mode.label;
  });

  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement === player) document.exitFullscreen();
    else player.requestFullscreen().catch(() => {});
  });
  player.addEventListener('fullscreenchange', () => {
    const isFs = document.fullscreenElement === player;
    fsBtn.replaceChildren(svgIcon(isFs ? PLAYER_ICONS.collapse : PLAYER_ICONS.expand));
    player.classList.toggle('is-fullscreen', isFs);
  });

  let idleTimer = null;
  function showControls() {
    player.classList.remove('idle');
    if (idleTimer) clearTimeout(idleTimer);
    if (!video.paused && !video.ended) scheduleIdle();
  }
  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => player.classList.add('idle'), 2200);
  }
  player.addEventListener('mousemove', showControls);
  player.addEventListener('mouseleave', () => {
    if (!video.paused) player.classList.add('idle');
  });

  player.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'k', 'm', 'f', 'c'].includes(event.key)) {
      event.preventDefault();
    }
    showControls();
    switch (event.key) {
      case ' ':
      case 'k':
        togglePlay();
        break;
      case 'ArrowLeft':
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case 'ArrowRight':
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
        break;
      case 'ArrowUp':
        video.volume = Math.min(1, video.volume + 0.05);
        volumeRange.value = String(video.volume);
        updateVolumeIcon();
        break;
      case 'ArrowDown':
        video.volume = Math.max(0, video.volume - 0.05);
        volumeRange.value = String(video.volume);
        updateVolumeIcon();
        break;
      case 'm':
        muteBtn.click();
        break;
      case 'f':
        fsBtn.click();
        break;
      case 'c':
        if (track) ccBtn.click();
        break;
      default:
        break;
    }
  });

  updateVolumeIcon();
  return player;
}

/* ------------------------------------------------------- workflows & videos */

async function queueRun(workflowId, button) {
  button.disabled = true;
  button.textContent = 'Queueing…';
  try {
    const res = await AdminAuth.authorizedFetch(`/api/workflows/${workflowId}/run`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(await AdminAuth.parseErrorMessage(res));
    }
    await loadDetail();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Record video';
    const box = el('div', 'error-box', `Could not queue run: ${err.message}`);
    button.parentElement.appendChild(box);
  }
}

function runCard(run) {
  const box = el('div', 'run-card');

  const head = el('div', 'run-head');
  head.appendChild(chip(run.status));
  head.appendChild(el('span', null, fmtTime(run.created_at)));
  box.appendChild(head);

  if (run.status === 'COMPLETED' && run.video_path) {
    box.appendChild(createVideoPlayer({
      src: `/recordings/${run.video_path}`,
      captionsSrc: run.captions_path ? `/recordings/${run.captions_path}` : null,
    }));

    const links = el('div', 'run-links');
    const videoLink = el('a', null, 'video');
    videoLink.href = `/recordings/${run.video_path}`;
    videoLink.target = '_blank';
    videoLink.rel = 'noreferrer noopener';
    links.appendChild(videoLink);
    if (run.captions_path) {
      const vttLink = el('a', null, 'captions (.vtt)');
      vttLink.href = `/recordings/${run.captions_path}`;
      vttLink.target = '_blank';
      vttLink.rel = 'noreferrer noopener';
      links.appendChild(vttLink);
    }
    links.appendChild(el('span', null, `agent time ${fmtDuration(run.started_at, run.completed_at)}`));
    box.appendChild(links);
  } else if (run.status === 'FAILED') {
    box.appendChild(el('div', 'error-box', run.error_message || 'Run failed.'));
  } else {
    box.appendChild(el('p', 'empty-state', run.status === 'RUNNING' ? 'Agent is replaying the workflow…' : 'Waiting for the recording worker to pick this up…'));
  }

  box.appendChild(el('div', 'run-head', `run ${run.id}`));
  return box;
}

function renderRecordings(panel, detail) {
  panel.replaceChildren();

  if (detail.workflows.length === 0) {
    panel.appendChild(el('p', 'empty-state', 'No workflows were inferred for this project, so there is nothing to record.'));
    return;
  }

  const runsByWorkflow = new Map();
  for (const run of detail.runs) {
    if (!runsByWorkflow.has(run.workflow_id)) runsByWorkflow.set(run.workflow_id, []);
    runsByWorkflow.get(run.workflow_id).push(run);
  }

  for (const workflow of detail.workflows) {
    const block = el('div', 'workflow-block');

    const head = el('div', 'workflow-head');
    head.appendChild(el('span', 'workflow-name', workflow.name));
    head.appendChild(el(
      'span',
      'chip chip-meta',
      workflow.type === 'TOUR' ? 'full site tour' : `confidence ${pct(workflow.confidence)}`
    ));
    const button = el('button', 'btn', 'Record video');
    button.type = 'button';
    button.addEventListener('click', () => queueRun(workflow.id, button));
    head.appendChild(button);
    block.appendChild(head);

    const steps = el('ol', 'steps');
    for (const step of workflow.steps) {
      const parts = [`${step.step_number}.`];
      if (step.action_type) parts.push(step.action_type);
      if (step.entity_name) parts.push(step.entity_name);
      parts.push(`— ${step.page_title || step.page_url || 'unknown page'}`);
      steps.appendChild(el('li', null, parts.join(' ')));
    }
    if (workflow.steps.length === 0) {
      steps.appendChild(el('li', null, 'No steps recorded for this workflow.'));
    }
    block.appendChild(steps);

    const runs = runsByWorkflow.get(workflow.id) || [];
    if (runs.length === 0) {
      block.appendChild(el('p', 'empty-state', 'No recordings yet.'));
    } else {
      const grid = el('div', 'runs');
      runs.forEach((run) => grid.appendChild(runCard(run)));
      block.appendChild(grid);
    }

    panel.appendChild(block);
  }
}

/* -------------------------------------------------------------------- graph */

async function ensureGraph() {
  const panel = panelFor('graph');
  if (!panel || !state.detail) return;

  if (state.graph && state.graphProjectId === state.detail.job.project_id) {
    renderGraph(panel);
    return;
  }

  panel.replaceChildren(el('p', 'empty-state', 'Loading knowledge graph…'));
  try {
    const graph = await getJSON(`/api/graph/${state.detail.job.project_id}`);
    state.graph = graph;
    state.graphProjectId = state.detail.job.project_id;
    renderGraph(panel);
  } catch (err) {
    panel.replaceChildren(el('div', 'error-box', `Failed to load graph: ${err.message}`));
  }
}

/** Nodes come back keyed by properties.id; drop edges whose endpoints we cannot resolve. */
function buildGraphModel(graph) {
  const nodes = [];
  const byId = new Map();
  for (const raw of graph.nodes || []) {
    const id = raw.properties && raw.properties.id;
    if (!id || byId.has(id)) continue;
    const label = (raw.labels && raw.labels[0]) || 'Node';
    const node = { id, label, properties: raw.properties };
    byId.set(id, node);
    nodes.push(node);
  }

  const links = [];
  for (const edge of graph.edges || []) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || source === target) continue;
    links.push({ source, target, type: edge.type, properties: edge.properties || {} });
  }
  return { nodes, links };
}

function nodeCaption(node) {
  const p = node.properties || {};
  switch (node.label) {
    case 'Page':
      return p.title || p.url || 'page';
    case 'Entity':
      return p.name || 'entity';
    case 'Action':
      return p.actionType || 'action';
    case 'Workflow':
      return p.name || 'workflow';
    case 'WorkflowStep':
      return `step ${p.stepNumber ?? '?'}`;
    case 'Component':
      return p.label || p.type || 'component';
    default:
      return node.label;
  }
}

function styleFor(label) {
  return LABEL_STYLE[label] || { color: '#6f93a0', radius: 6 };
}

function stopSimulation() {
  if (state.simulation) {
    cancelAnimationFrame(state.simulation);
    state.simulation = null;
  }
  state.reheat = null;
}

function renderGraph(panel) {
  stopSimulation();
  panel.replaceChildren();

  const model = buildGraphModel(state.graph);
  if (model.nodes.length === 0) {
    panel.appendChild(el('p', 'empty-state', 'The graph projection is empty — it is written when a crawl completes.'));
    return;
  }

  // Toolbar: per-label visibility toggles doubling as the legend.
  const toolbar = el('div', 'graph-toolbar');
  const counts = new Map();
  model.nodes.forEach((n) => counts.set(n.label, (counts.get(n.label) || 0) + 1));
  for (const [label, count] of Array.from(counts.entries()).sort()) {
    const item = el('label', 'legend-item');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !state.hiddenLabels.has(label);
    box.addEventListener('change', () => {
      if (box.checked) state.hiddenLabels.delete(label);
      else state.hiddenLabels.add(label);
      renderGraph(panel);
    });
    const dot = el('span', 'legend-dot');
    dot.style.background = styleFor(label).color;
    item.append(box, dot, el('span', null, `${label} (${count})`));
    toolbar.appendChild(item);
  }
  toolbar.appendChild(el('span', null, `${model.links.length} relationships · drag to pan, scroll to zoom`));
  panel.appendChild(toolbar);

  const visibleNodes = model.nodes.filter((n) => !state.hiddenLabels.has(n.label));
  const capped = visibleNodes.slice(0, MAX_GRAPH_NODES);
  if (capped.length < visibleNodes.length) {
    panel.appendChild(el('p', 'empty-state', `Showing the first ${MAX_GRAPH_NODES} of ${visibleNodes.length} nodes.`));
  }
  const included = new Set(capped);
  const visibleLinks = model.links.filter((l) => included.has(l.source) && included.has(l.target));

  const stage = el('div', 'graph-stage');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'graph-canvas');
  svg.setAttribute('width', '100%');
  const inspector = el('div', 'graph-inspector');
  inspector.appendChild(el('p', 'empty-state', 'Click a node to inspect its properties.'));
  stage.append(svg, inspector);
  panel.appendChild(stage);

  const width = svg.clientWidth || 900;
  const height = 560;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(viewport);
  const edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  viewport.append(edgeLayer, nodeLayer);

  // Seed positions on a circle so the layout unfolds deterministically.
  capped.forEach((node, i) => {
    const angle = (i / capped.length) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.35;
    node.x = width / 2 + Math.cos(angle) * radius;
    node.y = height / 2 + Math.sin(angle) * radius;
    node.vx = 0;
    node.vy = 0;
    node.fixed = false;
  });

  const linkEls = visibleLinks.map((link) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'graph-edge');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = link.type;
    line.appendChild(title);
    edgeLayer.appendChild(line);
    return { link, line };
  });

  const nodeEls = capped.map((node) => {
    const style = styleFor(node.label);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'graph-node');

    // Invisible but hit-testable disc: small nodes are otherwise fiddly to click or drag.
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('class', 'graph-hit');
    hit.setAttribute('r', String(style.radius + 7));
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(style.radius));
    circle.setAttribute('fill', style.color);
    g.appendChild(circle);

    const caption = nodeCaption(node);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(style.radius + 4));
    text.setAttribute('y', '3');
    text.textContent = caption.length > 28 ? `${caption.slice(0, 27)}…` : caption;
    g.appendChild(text);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${node.label}: ${caption}`;
    g.appendChild(title);

    nodeLayer.appendChild(g);
    return { node, g, circle };
  });

  attachInspector(nodeEls, linkEls, inspector);
  const transform = attachDragging(svg, viewport, nodeEls);
  attachPanZoom(svg, transform);

  runSimulation(capped, visibleLinks, width, height, () => {
    linkEls.forEach(({ link, line }) => {
      line.setAttribute('x1', link.source.x);
      line.setAttribute('y1', link.source.y);
      line.setAttribute('x2', link.target.x);
      line.setAttribute('y2', link.target.y);
    });
    nodeEls.forEach(({ node, g }) => g.setAttribute('transform', `translate(${node.x},${node.y})`));
  });
}

/**
 * Minimal force-directed layout: all-pairs repulsion, spring attraction along edges and
 * a pull toward the centre, cooled by a decaying alpha so it settles instead of jittering.
 */
function runSimulation(nodes, links, width, height, onTick) {
  const cx = width / 2;
  const cy = height / 2;
  const repulsion = 3000;
  const springLength = 70;
  const springStrength = 0.02;
  const centerPull = 0.008;
  let alpha = 1;

  function tick() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = 1;
        }
        const force = repulsion / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const link of links) {
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - springLength) * springStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      link.source.vx += fx;
      link.source.vy += fy;
      link.target.vx -= fx;
      link.target.vy -= fy;
    }

    for (const node of nodes) {
      node.vx += (cx - node.x) * centerPull;
      node.vy += (cy - node.y) * centerPull;
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx * alpha;
      node.y += node.vy * alpha;
    }

    onTick();
    alpha *= 0.985;
    // Dragging re-heats the layout (see attachDragging), so keep ticking until it cools.
    state.simulation = alpha > 0.02 ? requestAnimationFrame(tick) : null;
  }

  state.reheat = () => {
    alpha = Math.max(alpha, 0.4);
    if (!state.simulation) state.simulation = requestAnimationFrame(tick);
  };
  state.simulation = requestAnimationFrame(tick);
}

function attachInspector(nodeEls, linkEls, inspector) {
  for (const { node, g } of nodeEls) {
    g.addEventListener('click', (event) => {
      event.stopPropagation();
      const neighbours = new Set([node]);
      linkEls.forEach(({ link, line }) => {
        const touches = link.source === node || link.target === node;
        line.classList.toggle('highlight', touches);
        if (touches) {
          neighbours.add(link.source);
          neighbours.add(link.target);
        }
      });
      nodeEls.forEach((entry) => entry.g.classList.toggle('faded', !neighbours.has(entry.node)));

      inspector.replaceChildren();
      inspector.appendChild(el('h3', null, node.label));
      const pairs = Object.entries(node.properties || {})
        .filter(([key]) => key !== 'projectId')
        .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value]);
      inspector.appendChild(definitionList(pairs, 'kv-inspector'));

      const related = linkEls
        .filter(({ link }) => link.source === node || link.target === node)
        .map(({ link }) =>
          link.source === node
            ? `→ ${link.type} → ${nodeCaption(link.target)}`
            : `← ${link.type} ← ${nodeCaption(link.source)}`
        );
      if (related.length > 0) {
        inspector.appendChild(el('h3', null, `Relationships (${related.length})`));
        const list = el('ul', 'steps');
        related.forEach((line) => list.appendChild(el('li', null, line)));
        inspector.appendChild(list);
      }
    });
  }
}

function attachPanZoom(svg, t) {
  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      // The cursor is in CSS pixels; the viewport transform is in viewBox units.
      const px = (event.clientX - rect.left) * ((svg.viewBox.baseVal.width || rect.width) / rect.width);
      const py = (event.clientY - rect.top) * ((svg.viewBox.baseVal.height || rect.height) / rect.height);
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k = Math.min(Math.max(t.k * factor, 0.15), 5);
      // Keep the point under the cursor stationary while zooming.
      t.x = px - ((px - t.x) * k) / t.k;
      t.y = py - ((py - t.y) * k) / t.k;
      t.k = k;
      t.apply();
    },
    { passive: false }
  );
}

function attachDragging(svg, viewport, nodeEls) {
  const transform = {
    x: 0,
    y: 0,
    k: 1,
    apply() {
      viewport.setAttribute('transform', `translate(${this.x},${this.y}) scale(${this.k})`);
    }
  };
  transform.apply();

  let panning = null;
  let dragging = null;

  function toGraphCoords(event) {
    const rect = svg.getBoundingClientRect();
    // The SVG is laid out at CSS size but drawn in viewBox units; convert through both.
    const scaleX = (svg.viewBox.baseVal.width || rect.width) / rect.width;
    const scaleY = (svg.viewBox.baseVal.height || rect.height) / rect.height;
    const vx = (event.clientX - rect.left) * scaleX;
    const vy = (event.clientY - rect.top) * scaleY;
    return { x: (vx - transform.x) / transform.k, y: (vy - transform.y) / transform.k };
  }

  for (const entry of nodeEls) {
    entry.g.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      entry.g.setPointerCapture(event.pointerId);
      dragging = entry;
      entry.node.fixed = true;
    });
    entry.g.addEventListener('pointermove', (event) => {
      if (dragging !== entry) return;
      const point = toGraphCoords(event);
      entry.node.x = point.x;
      entry.node.y = point.y;
      if (state.reheat) state.reheat();
    });
    const release = (event) => {
      if (dragging !== entry) return;
      entry.g.releasePointerCapture(event.pointerId);
      entry.node.fixed = false;
      dragging = null;
      if (state.reheat) state.reheat();
    };
    entry.g.addEventListener('pointerup', release);
    entry.g.addEventListener('pointercancel', release);
  }

  svg.addEventListener('pointerdown', (event) => {
    if (dragging) return;
    panning = { x: event.clientX - transform.x, y: event.clientY - transform.y };
    svg.classList.add('dragging');
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!panning) return;
    transform.x = event.clientX - panning.x;
    transform.y = event.clientY - panning.y;
    transform.apply();
  });
  const endPan = (event) => {
    if (!panning) return;
    panning = null;
    svg.classList.remove('dragging');
    svg.releasePointerCapture(event.pointerId);
  };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);

  return transform;
}

/* ------------------------------------------------------------------ polling */

async function refresh() {
  try {
    const data = await getJSON('/api/admin/requests');
    state.totals = data.totals;
    state.requests = data.requests;
    renderTotals();
    renderList();
  } catch (err) {
    els.list.replaceChildren(el('div', 'error-box', `Failed to load requests: ${err.message}`));
  }

  if (!state.selectedId || !state.detail) return;

  try {
    const detail = await getJSON(`/api/admin/requests/${state.selectedId}`);
    state.detail = detail;

    // Re-render only what changed: rebuilding the recordings panel would restart any
    // video the user is watching, and rebuilding the graph would reset its layout.
    renderOverview(panelFor('overview'), detail);
    renderPages(panelFor('pages'), detail);

    const recSig = recordingsSignature(detail);
    if (recSig !== state.signatures.recordings) {
      state.signatures.recordings = recSig;
      renderRecordings(panelFor('recordings'), detail);
    }

    const graphSig = graphSignature(detail);
    if (graphSig !== state.signatures.graph) {
      state.signatures.graph = graphSig;
      state.graph = null;
      if (state.activeTab === 'graph') ensureGraph();
    }

    const statusChip = els.detail.querySelector('.detail-status');
    if (statusChip) {
      statusChip.className = `chip status-${detail.job.status}`;
      statusChip.textContent = detail.job.status;
    }
  } catch (err) {
    /* transient failure; the next poll retries */
  }
}

// Guarded: admin.js is also loaded standalone (no admin index.html around it) by pages
// that just want createVideoPlayer(), e.g. the demo-caption-viewer recordings pages.
if (els.filter) {
  els.filter.addEventListener('input', () => {
    state.filter = els.filter.value;
    renderList();
  });

  setInterval(() => {
    if (els.autoRefresh.checked && !document.hidden) refresh();
  }, POLL_MS);

  refresh();
}
