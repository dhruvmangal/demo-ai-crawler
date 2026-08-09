import { chromium, Page } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { StepMetadata, HealAudit } from '../types/workflow-scripts';
import { buildCaptionText, buildVtt, Cue } from './caption-builder';
import { ScriptHealer } from '../agent/script-healer';

export interface RecordingResult {
  videoPath: string;
  captionsPath: string;
}

export interface ScriptRecordingResult extends RecordingResult {
  healed: boolean;
  stepMetadata: StepMetadata[];
  heals: HealAudit[];
}

const STEP_DWELL_MS = 1200; // time to hold each step on screen so the video/captions are watchable
const MIN_CUE_MS = 1500;

/** A compiled step's code threw, and the healer either couldn't fix it or its fix also failed. */
export class StepExecutionError extends Error {
  constructor(message: string, public readonly stepNumber: number) {
    super(message);
    this.name = 'StepExecutionError';
  }
}

/**
 * Executes a persisted, pre-verified Playwright script (from workflow_scripts) in a
 * fresh headless browser -- independent of the user's live tab, since Playwright's
 * built-in video recording needs a context it launched itself -- recording video and
 * building a WebVTT caption track. Each step's code was resolved from the crawl-time
 * knowledge base at generation time (DeterministicScriptEngine, no LLM) or fixed up at
 * heal time (ScriptHealer, LLM-based); replaying it here involves no LLM call unless a
 * step's selector has gone stale since, in which case the healer repairs it in place,
 * mid-recording, using this same browser context.
 */
export class WorkflowRecorder {
  constructor(private recordingsDir: string) {}

  public async record(runId: string, scriptRow: { id: string; stepMetadata: StepMetadata[] }): Promise<ScriptRecordingResult> {
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

    // Work on a copy so a healed step's mutated code/narration doesn't leak back into
    // the caller's own reference before it's explicitly persisted.
    const stepMetadata: StepMetadata[] = scriptRow.stepMetadata.map(s => ({ ...s }));
    const heals: HealAudit[] = [];

    try {
      for (const step of stepMetadata) {
        // MIN_CUE_MS can push a cue's end past this step's real wall-clock duration
        // (e.g. a step with no navigation/action finishes in ~STEP_DWELL_MS < MIN_CUE_MS),
        // so clamp the next cue's start to the previous cue's end rather than real time.
        const cueStartMs = Math.max(Date.now() - recordingStart, cursorMs);

        try {
          await WorkflowRecorder.runCompiledStep(page, step.code);
        } catch (err: any) {
          const healResult = await ScriptHealer.heal(step, err, page);
          if (!healResult) {
            throw new StepExecutionError(err?.message || String(err), step.stepNumber);
          }
          heals.push({ stepNumber: step.stepNumber, errorMessage: err?.message || String(err), diffSummary: healResult.diffSummary });
          step.code = healResult.code;
          step.narration = healResult.narration;
          try {
            await WorkflowRecorder.runCompiledStep(page, step.code);
          } catch (retryErr: any) {
            throw new StepExecutionError(retryErr?.message || String(retryErr), step.stepNumber);
          }
        }

        await page.waitForTimeout(STEP_DWELL_MS);

        const cueEndMs = Math.max(Date.now() - recordingStart, cueStartMs + MIN_CUE_MS);
        cursorMs = cueEndMs;
        cues.push({ startMs: cueStartMs, endMs: cueEndMs, text: buildCaptionText(step.stepNumber, step.skipped, step.narration) });
      }
    } finally {
      await context.close(); // finalizes the video file
      await browser.close();
    }

    const recordedPath = await video?.path();
    if (!recordedPath) {
      throw new Error('Playwright did not produce a video recording for this run.');
    }

    // Chromium's own webm writer streams frames without knowing the total length
    // upfront, so it never finalizes a proper container Duration header -- ffprobe can
    // still recover the real duration by scanning packets, but players that trust the
    // header (browser <video> included) show a 0-duration, unseekable video even though
    // the frame data is complete. Remuxing through ffmpeg (`-c copy`, no re-encode,
    // baked into the mcr.microsoft.com/playwright base image already) writes a correct
    // header without touching the video data.
    const videoPath = path.join(this.recordingsDir, `${runId}.webm`);
    execFileSync('ffmpeg', ['-y', '-i', recordedPath, '-c', 'copy', videoPath]);
    fs.unlinkSync(recordedPath);

    const captionsPath = path.join(this.recordingsDir, `${runId}.vtt`);
    fs.writeFileSync(captionsPath, buildVtt(cues), 'utf-8');

    return { videoPath, captionsPath, healed: heals.length > 0, stepMetadata, heals };
  }

  // node:vm's compileFunction has no `async` option, so an async function body can't be
  // compiled through it directly; the AsyncFunction constructor is the standard way to
  // compile one from a string body without falling back to string-concatenation + eval.
  private static readonly AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (page: Page, ctx: unknown) => Promise<void>;

  private static async runCompiledStep(page: Page, code: string): Promise<void> {
    const fn = new WorkflowRecorder.AsyncFunction('page', 'ctx', code);
    await fn(page, {});
  }
}
