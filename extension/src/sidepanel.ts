import {
  CrawlJob,
  RECORDINGS_BASE,
  WorkflowRun,
  getGraph,
  pollCrawlJob,
  pollWorkflowRun,
  runWorkflow,
  startCrawl,
  submitCredentials
} from './api';
import { buildPageTree, extractWorkflows, renderTree, renderWorkflows, WorkflowSummary } from './render';
import { NeuronField } from './neuronField';

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="hud-header">
    <div class="hud-title">
      <span class="hud-glyph">◈</span>
      <div>
        <h1>Narreto</h1>
        <p class="hud-subtitle">SITE INTELLIGENCE INTERFACE</p>
      </div>
    </div>
    <div class="hud-status" id="hud-status">STANDBY</div>
  </header>

  <section id="view-idle" class="view">
    <label class="field-label" for="target-url">TARGET URL</label>
    <input id="target-url" class="hud-input" type="url" placeholder="https://example.com" />
    <button id="scan-btn" class="hud-button">INITIATE SCAN</button>
  </section>

  <section id="view-scanning" class="view hidden">
    <div id="neuron-mount" class="neuron-mount"></div>
    <p class="scan-status" id="scan-status-text">QUEUED FOR ANALYSIS…</p>
    <div id="credentials-box" class="credentials-box hidden">
      <p class="field-label">SITE REQUIRES AUTHENTICATION</p>
      <input id="cred-username" class="hud-input" type="text" placeholder="username" />
      <input id="cred-password" class="hud-input" type="password" placeholder="password" />
      <button id="cred-submit" class="hud-button">SUBMIT CREDENTIALS</button>
    </div>
    <button id="cancel-btn" class="hud-button hud-button-ghost">CANCEL</button>
  </section>

  <section id="view-error" class="view hidden">
    <p class="error-text" id="error-text"></p>
    <button id="retry-btn" class="hud-button">RETRY</button>
  </section>

  <section id="view-results" class="view hidden">
    <div class="results-header">
      <h2>PAGE TREE</h2>
      <button id="new-scan-btn" class="hud-button hud-button-ghost">NEW SCAN</button>
    </div>
    <div id="tree-container" class="tree-container"></div>

    <h2 class="workflows-heading">WORKFLOWS</h2>
    <p id="workflow-selection" class="workflow-selection hidden"></p>
    <div id="workflow-container" class="workflow-container"></div>
    <button id="record-btn" class="hud-button hud-button-record hidden">RECORD WORKFLOW</button>
  </section>

  <section id="view-recording" class="view hidden">
    <div id="record-neuron-mount" class="neuron-mount"></div>
    <p class="scan-status" id="record-status-text">QUEUED FOR RECORDING…</p>
    <button id="record-cancel-btn" class="hud-button hud-button-ghost">BACK</button>
  </section>

  <section id="view-recording-results" class="view hidden">
    <div class="results-header">
      <h2>WORKFLOW RECORDING</h2>
      <button id="record-back-btn" class="hud-button hud-button-ghost">BACK TO RESULTS</button>
    </div>
    <video id="record-video" class="record-video" controls></video>
  </section>
`;

const els = {
  status: document.getElementById('hud-status')!,
  viewIdle: document.getElementById('view-idle')!,
  viewScanning: document.getElementById('view-scanning')!,
  viewError: document.getElementById('view-error')!,
  viewResults: document.getElementById('view-results')!,
  targetUrl: document.getElementById('target-url') as HTMLInputElement,
  scanBtn: document.getElementById('scan-btn')!,
  cancelBtn: document.getElementById('cancel-btn')!,
  neuronMount: document.getElementById('neuron-mount')!,
  scanStatusText: document.getElementById('scan-status-text')!,
  credentialsBox: document.getElementById('credentials-box')!,
  credUsername: document.getElementById('cred-username') as HTMLInputElement,
  credPassword: document.getElementById('cred-password') as HTMLInputElement,
  credSubmit: document.getElementById('cred-submit')!,
  errorText: document.getElementById('error-text')!,
  retryBtn: document.getElementById('retry-btn')!,
  newScanBtn: document.getElementById('new-scan-btn')!,
  treeContainer: document.getElementById('tree-container')!,
  workflowContainer: document.getElementById('workflow-container')!,
  workflowSelection: document.getElementById('workflow-selection')!,
  recordBtn: document.getElementById('record-btn') as HTMLButtonElement,
  viewRecording: document.getElementById('view-recording')!,
  recordNeuronMount: document.getElementById('record-neuron-mount')!,
  recordStatusText: document.getElementById('record-status-text')!,
  recordCancelBtn: document.getElementById('record-cancel-btn')!,
  viewRecordingResults: document.getElementById('view-recording-results')!,
  recordVideo: document.getElementById('record-video') as HTMLVideoElement,
  recordBackBtn: document.getElementById('record-back-btn')!
};

let neuronField: NeuronField | null = null;
let recordingNeuronField: NeuronField | null = null;
let activePoll: { cancel: () => void } | null = null;
let activeRecordPoll: { cancel: () => void } | null = null;
let currentJob: CrawlJob | null = null;
let selectedWorkflowId: string | null = null;

const STATUS_LABEL: Record<CrawlJob['status'], string> = {
  PENDING: 'QUEUED FOR ANALYSIS…',
  RUNNING: 'CRAWLING NEURAL PATHWAYS…',
  AWAITING_CREDENTIALS: 'AWAITING CREDENTIALS…',
  COMPLETED: 'ANALYSIS COMPLETE',
  FAILED: 'ANALYSIS FAILED'
};

type View = 'idle' | 'scanning' | 'error' | 'results' | 'recording' | 'recording-results';

function showView(view: View) {
  els.viewIdle.classList.toggle('hidden', view !== 'idle');
  els.viewScanning.classList.toggle('hidden', view !== 'scanning');
  els.viewError.classList.toggle('hidden', view !== 'error');
  els.viewResults.classList.toggle('hidden', view !== 'results');
  els.viewRecording.classList.toggle('hidden', view !== 'recording');
  els.viewRecordingResults.classList.toggle('hidden', view !== 'recording-results');

  const active = view === 'scanning' || view === 'recording';
  els.status.textContent =
    view === 'idle' ? 'STANDBY' : view === 'error' ? 'ERROR' : active ? 'ACTIVE' : 'ONLINE';
  els.status.classList.toggle('hud-status-active', active);
  els.status.classList.toggle('hud-status-error', view === 'error');
}

async function getActiveTabUrl(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url && /^https?:\/\//.test(tab.url) ? tab.url : '';
  } catch {
    return '';
  }
}

function resetScanningUI() {
  els.credentialsBox.classList.add('hidden');
  els.scanStatusText.textContent = STATUS_LABEL.PENDING;
}

async function beginScan(targetUrl: string) {
  showView('scanning');
  resetScanningUI();
  neuronField = new NeuronField(els.neuronMount);
  neuronField.start();

  try {
    const job = await startCrawl(targetUrl);
    currentJob = job;
    activePoll = pollCrawlJob(job.id, onJobUpdate);
  } catch (err: any) {
    stopScanningAnimation();
    showError(err?.message || 'Failed to start crawl.');
  }
}

function stopScanningAnimation() {
  activePoll?.cancel();
  activePoll = null;
  neuronField?.dispose();
  neuronField = null;
}

async function onJobUpdate(job: CrawlJob) {
  currentJob = job;
  els.scanStatusText.textContent = STATUS_LABEL[job.status] || job.status;
  els.credentialsBox.classList.toggle('hidden', job.status !== 'AWAITING_CREDENTIALS');

  if (job.status === 'COMPLETED') {
    stopScanningAnimation();
    try {
      const graph = await getGraph(job.project_id);
      renderResults(graph);
      showView('results');
    } catch (err: any) {
      showError(err?.message || 'Crawl completed, but results could not be loaded.');
    }
  } else if (job.status === 'FAILED') {
    stopScanningAnimation();
    showError(job.error_message || 'Crawl failed.');
  }
}

function renderResults(graph: Awaited<ReturnType<typeof getGraph>>) {
  const roots = buildPageTree(graph);
  renderTree(els.treeContainer, roots);

  const workflows = extractWorkflows(graph);
  els.workflowSelection.classList.add('hidden');
  els.recordBtn.classList.add('hidden');
  selectedWorkflowId = null;
  renderWorkflows(els.workflowContainer, workflows, onWorkflowSelected);
}

function onWorkflowSelected(workflow: WorkflowSummary) {
  els.workflowSelection.textContent = `SELECTED: ${workflow.name}`;
  els.workflowSelection.classList.remove('hidden');
  selectedWorkflowId = workflow.id;
  els.recordBtn.classList.remove('hidden');
  if (currentJob) {
    chrome.storage.local.set({
      [`selectedWorkflow:${currentJob.project_id}`]: { id: workflow.id, name: workflow.name }
    });
  }
}

const RECORD_STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  PENDING: 'QUEUED FOR RECORDING…',
  RUNNING: 'RECORDING WORKFLOW — REPLAYING STEPS…',
  COMPLETED: 'RECORDING COMPLETE',
  FAILED: 'RECORDING FAILED'
};

function stopRecordingAnimation() {
  activeRecordPoll?.cancel();
  activeRecordPoll = null;
  recordingNeuronField?.dispose();
  recordingNeuronField = null;
}

async function beginRecording(workflowId: string) {
  showView('recording');
  els.recordStatusText.textContent = RECORD_STATUS_LABEL.PENDING;
  recordingNeuronField = new NeuronField(els.recordNeuronMount);
  recordingNeuronField.start();

  try {
    const run = await runWorkflow(workflowId);
    activeRecordPoll = pollWorkflowRun(run.id, onRecordUpdate);
  } catch (err: any) {
    stopRecordingAnimation();
    showError(err?.message || 'Failed to start recording.');
  }
}

function onRecordUpdate(run: WorkflowRun) {
  els.recordStatusText.textContent = RECORD_STATUS_LABEL[run.status] || run.status;

  if (run.status === 'COMPLETED') {
    stopRecordingAnimation();
    els.recordVideo.querySelectorAll('track').forEach((t) => t.remove());
    els.recordVideo.src = `${RECORDINGS_BASE}/${run.video_path}`;
    if (run.captions_path) {
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'English';
      track.srclang = 'en';
      track.src = `${RECORDINGS_BASE}/${run.captions_path}`;
      track.default = true;
      els.recordVideo.appendChild(track);
    }
    showView('recording-results');
  } else if (run.status === 'FAILED') {
    stopRecordingAnimation();
    showError(run.error_message || 'Recording failed.');
  }
}

function showError(message: string) {
  els.errorText.textContent = message;
  showView('error');
}

els.scanBtn.addEventListener('click', () => {
  const url = els.targetUrl.value.trim();
  if (!url) return;
  beginScan(url);
});

els.cancelBtn.addEventListener('click', () => {
  stopScanningAnimation();
  showView('idle');
});

els.retryBtn.addEventListener('click', () => showView('idle'));

els.newScanBtn.addEventListener('click', () => {
  currentJob = null;
  selectedWorkflowId = null;
  showView('idle');
});

els.recordBtn.addEventListener('click', () => {
  if (!selectedWorkflowId) return;
  beginRecording(selectedWorkflowId);
});

els.recordCancelBtn.addEventListener('click', () => {
  stopRecordingAnimation();
  showView('results');
});

els.recordBackBtn.addEventListener('click', () => {
  els.recordVideo.pause();
  showView('results');
});

els.credSubmit.addEventListener('click', async () => {
  if (!currentJob) return;
  const username = els.credUsername.value.trim();
  const password = els.credPassword.value;
  if (!username || !password) return;
  try {
    await submitCredentials(currentJob.id, username, password);
    els.credentialsBox.classList.add('hidden');
    els.credUsername.value = '';
    els.credPassword.value = '';
  } catch (err: any) {
    showError(err?.message || 'Failed to submit credentials.');
  }
});

getActiveTabUrl().then((url) => {
  if (url) els.targetUrl.value = url;
});
