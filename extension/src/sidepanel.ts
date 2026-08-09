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
import { AuthService, AuthUser } from './auth';

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

  <div class="hud-user-bar" id="hud-user-bar">
    <div class="user-info" id="user-info">
      <div class="user-avatar-placeholder" id="user-avatar-ph">?</div>
      <img id="user-avatar" class="user-avatar hidden" alt="User avatar" />
      <span class="user-name" id="user-display-name">UNAUTHENTICATED</span>
      <span class="provider-badge hidden" id="user-provider-badge">GUEST</span>
    </div>
    <button class="auth-header-btn" id="auth-toggle-btn">SIGN IN</button>
  </div>

  <section id="view-auth" class="view hidden">
    <div class="auth-box">
      <h2 class="auth-box-title">AUTHENTICATION MATRIX</h2>
      <p class="auth-box-desc">Connect with your identity provider to synchronize crawl graphs, workflows, and cloud agents.</p>

      <div id="auth-login-options">
        <button id="google-login-btn" class="hud-button auth-btn auth-btn-google">
          <svg class="auth-icon" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          CONTINUE WITH GOOGLE
        </button>

        <div class="auth-divider">OR</div>

        <button id="github-login-btn" class="hud-button auth-btn auth-btn-github">
          <svg class="auth-icon" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          CONTINUE WITH GITHUB
        </button>
      </div>

      <div id="auth-profile-details" class="profile-card hidden">
        <div class="profile-header">
          <img id="profile-avatar" class="profile-avatar-large" alt="User avatar" />
          <div class="profile-details">
            <h3 id="profile-name">User Name</h3>
            <p id="profile-email">user@example.com</p>
          </div>
        </div>
        <div class="profile-metadata">
          <span id="profile-provider-info">PROVIDER: GOOGLE</span>
          <span id="profile-auth-time">AUTHENTICATED: JUST NOW</span>
        </div>
        <button id="logout-btn" class="hud-button hud-button-ghost">SIGN OUT</button>
      </div>
    </div>
    <button id="auth-close-btn" class="hud-button hud-button-ghost">BACK TO DASHBOARD</button>
  </section>

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
  viewAuth: document.getElementById('view-auth')!,
  viewIdle: document.getElementById('view-idle')!,
  viewScanning: document.getElementById('view-scanning')!,
  viewError: document.getElementById('view-error')!,
  viewResults: document.getElementById('view-results')!,
  viewRecording: document.getElementById('view-recording')!,
  viewRecordingResults: document.getElementById('view-recording-results')!,
  userAvatarPh: document.getElementById('user-avatar-ph')!,
  userAvatar: document.getElementById('user-avatar') as HTMLImageElement,
  userDisplayName: document.getElementById('user-display-name')!,
  userProviderBadge: document.getElementById('user-provider-badge')!,
  authToggleBtn: document.getElementById('auth-toggle-btn')!,
  authLoginOptions: document.getElementById('auth-login-options')!,
  authProfileDetails: document.getElementById('auth-profile-details')!,
  googleLoginBtn: document.getElementById('google-login-btn')!,
  githubLoginBtn: document.getElementById('github-login-btn')!,
  profileAvatar: document.getElementById('profile-avatar') as HTMLImageElement,
  profileName: document.getElementById('profile-name')!,
  profileEmail: document.getElementById('profile-email')!,
  profileProviderInfo: document.getElementById('profile-provider-info')!,
  profileAuthTime: document.getElementById('profile-auth-time')!,
  logoutBtn: document.getElementById('logout-btn')!,
  authCloseBtn: document.getElementById('auth-close-btn')!,
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
  recordNeuronMount: document.getElementById('record-neuron-mount')!,
  recordStatusText: document.getElementById('record-status-text')!,
  recordCancelBtn: document.getElementById('record-cancel-btn')!,
  recordVideo: document.getElementById('record-video') as HTMLVideoElement,
  recordBackBtn: document.getElementById('record-back-btn')!
};

let neuronField: NeuronField | null = null;
let recordingNeuronField: NeuronField | null = null;
let activePoll: { cancel: () => void } | null = null;
let activeRecordPoll: { cancel: () => void } | null = null;
let currentJob: CrawlJob | null = null;
let selectedWorkflowId: string | null = null;
let currentUser: AuthUser | null = null;
let previousView: View = 'idle';

const STATUS_LABEL: Record<CrawlJob['status'], string> = {
  PENDING: 'QUEUED FOR ANALYSIS…',
  RUNNING: 'CRAWLING NEURAL PATHWAYS…',
  AWAITING_CREDENTIALS: 'AWAITING CREDENTIALS…',
  ENRICHING: 'SYNTHESIZING KNOWLEDGE GRAPH…',
  COMPLETED: 'ANALYSIS COMPLETE',
  FAILED: 'ANALYSIS FAILED'
};

type View = 'auth' | 'idle' | 'scanning' | 'error' | 'results' | 'recording' | 'recording-results';

function showView(view: View) {
  if (view !== 'auth') {
    previousView = view;
  }
  els.viewAuth.classList.toggle('hidden', view !== 'auth');
  els.viewIdle.classList.toggle('hidden', view !== 'idle');
  els.viewScanning.classList.toggle('hidden', view !== 'scanning');
  els.viewError.classList.toggle('hidden', view !== 'error');
  els.viewResults.classList.toggle('hidden', view !== 'results');
  els.viewRecording.classList.toggle('hidden', view !== 'recording');
  els.viewRecordingResults.classList.toggle('hidden', view !== 'recording-results');

  const active = view === 'scanning' || view === 'recording';
  els.status.textContent =
    view === 'idle'
      ? 'STANDBY'
      : view === 'auth'
      ? 'AUTH'
      : view === 'error'
      ? 'ERROR'
      : active
      ? 'ACTIVE'
      : 'ONLINE';
  els.status.classList.toggle('hud-status-active', active);
  els.status.classList.toggle('hud-status-error', view === 'error');
}

function updateUserUI(user: AuthUser | null) {
  currentUser = user;
  if (user) {
    els.userDisplayName.textContent = user.name.toUpperCase();
    els.authToggleBtn.textContent = 'ACCOUNT';
    els.userProviderBadge.textContent = user.provider.toUpperCase();
    els.userProviderBadge.className = `provider-badge provider-badge-${user.provider}`;
    els.userProviderBadge.classList.remove('hidden');

    if (user.avatarUrl) {
      els.userAvatar.src = user.avatarUrl;
      els.userAvatar.classList.remove('hidden');
      els.userAvatarPh.classList.add('hidden');
    } else {
      els.userAvatarPh.textContent = user.name.charAt(0).toUpperCase();
      els.userAvatarPh.classList.remove('hidden');
      els.userAvatar.classList.add('hidden');
    }

    // Profile card details
    els.authLoginOptions.classList.add('hidden');
    els.authProfileDetails.classList.remove('hidden');
    els.profileName.textContent = user.name;
    els.profileEmail.textContent = user.email;
    els.profileAvatar.src = user.avatarUrl || 'icons/icon48.png';
    els.profileProviderInfo.textContent = `PROVIDER: ${user.provider.toUpperCase()}`;
    els.profileAuthTime.textContent = `SESSION: ${new Date(user.authenticatedAt).toLocaleTimeString()}`;
  } else {
    els.userDisplayName.textContent = 'UNAUTHENTICATED';
    els.authToggleBtn.textContent = 'SIGN IN';
    els.userProviderBadge.classList.add('hidden');
    els.userAvatarPh.textContent = '?';
    els.userAvatarPh.classList.remove('hidden');
    els.userAvatar.classList.add('hidden');

    els.authLoginOptions.classList.remove('hidden');
    els.authProfileDetails.classList.add('hidden');
  }
}

async function initAuth() {
  const user = await AuthService.getStoredUser();
  updateUserUI(user);
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

// Authentication Event Handlers
els.authToggleBtn.addEventListener('click', () => {
  showView('auth');
});

els.authCloseBtn.addEventListener('click', () => {
  showView(previousView);
});

els.googleLoginBtn.addEventListener('click', async () => {
  try {
    els.googleLoginBtn.textContent = 'CONNECTING TO GOOGLE…';
    const user = await AuthService.loginWithGoogle();
    updateUserUI(user);
    showView('idle');
  } catch (err: any) {
    showError(err?.message || 'Google Authentication failed.');
  } finally {
    els.googleLoginBtn.innerHTML = `
      <svg class="auth-icon" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
      </svg>
      CONTINUE WITH GOOGLE
    `;
  }
});

els.githubLoginBtn.addEventListener('click', async () => {
  try {
    els.githubLoginBtn.textContent = 'CONNECTING TO GITHUB…';
    const user = await AuthService.loginWithGitHub();
    updateUserUI(user);
    showView('idle');
  } catch (err: any) {
    showError(err?.message || 'GitHub Authentication failed.');
  } finally {
    els.githubLoginBtn.innerHTML = `
      <svg class="auth-icon" viewBox="0 0 24 24">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
      </svg>
      CONTINUE WITH GITHUB
    `;
  }
});

els.logoutBtn.addEventListener('click', async () => {
  await AuthService.logout();
  updateUserUI(null);
  showView('idle');
});

// Crawl & UI Event Handlers
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

initAuth();
getActiveTabUrl().then((url) => {
  if (url) els.targetUrl.value = url;
});
