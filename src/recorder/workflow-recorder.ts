import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { WorkflowRunStep } from '../types/workflow-runs';
import { buildCaptionText, buildVtt, Cue } from './caption-builder';
import { WorkflowOrchestrator } from '../agent/workflow-orchestrator';

export interface RecordingResult {
  videoPath: string;
  captionsPath: string;
}

const STEP_DWELL_MS = 1200; // time to hold each step on screen so the video/captions are watchable
const MIN_CUE_MS = 1500;

/**
 * Replays a workflow's steps in a fresh headless browser (independent of the user's
 * live tab -- Playwright's built-in video recording needs a context it launched itself),
 * recording video and building a WebVTT caption track. Each step is carried out by
 * WorkflowOrchestrator -- an LLM-driven agent that acts through a Playwright tool
 * surface and narrates what it did, rather than blindly replaying a stored selector.
 */
export class WorkflowRecorder {
  constructor(private recordingsDir: string) {}

  public async record(runId: string, steps: WorkflowRunStep[]): Promise<RecordingResult> {
    fs.mkdirSync(this.recordingsDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: this.recordingsDir, size: { width: 1280, height: 720 } }
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(30000);
    page.setDefaultTimeout(10000);
    const video = page.video();

    const recordingStart = Date.now();
    const cues: Cue[] = [];
    let cursorMs = 0; // end of the previously pushed cue, so cues never overlap

    try {
      for (const step of steps) {
        // MIN_CUE_MS can push a cue's end past this step's real wall-clock duration
        // (e.g. a step with no navigation/action finishes in ~STEP_DWELL_MS < MIN_CUE_MS),
        // so clamp the next cue's start to the previous cue's end rather than real time.
        const cueStartMs = Math.max(Date.now() - recordingStart, cursorMs);

        const { narration, actionSkipped } = await WorkflowOrchestrator.runStep(page, step);
        await page.waitForTimeout(STEP_DWELL_MS);

        const cueEndMs = Math.max(Date.now() - recordingStart, cueStartMs + MIN_CUE_MS);
        cursorMs = cueEndMs;
        cues.push({ startMs: cueStartMs, endMs: cueEndMs, text: buildCaptionText(step, actionSkipped, narration) });
      }
    } finally {
      await context.close(); // finalizes the video file
      await browser.close();
    }

    const recordedPath = await video?.path();
    if (!recordedPath) {
      throw new Error('Playwright did not produce a video recording for this run.');
    }

    const videoPath = path.join(this.recordingsDir, `${runId}.webm`);
    fs.renameSync(recordedPath, videoPath);

    const captionsPath = path.join(this.recordingsDir, `${runId}.vtt`);
    fs.writeFileSync(captionsPath, buildVtt(cues), 'utf-8');

    return { videoPath, captionsPath };
  }
}
