import { WorkflowRunStep } from '../types/workflow-runs';

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

function escapeVtt(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
}

/** Builds one caption line per step from the AI descriptions/entities already collected during the crawl. */
export function buildCaptionText(step: WorkflowRunStep, actionSkipped: boolean): string {
  const parts: string[] = [];

  if (step.actionType && step.entityName) {
    parts.push(`${step.actionType} ${step.entityName}`);
  } else if (step.actionType) {
    parts.push(step.actionType);
  }

  const description = step.pageAiDescription || step.pageAiSummary;
  if (description) {
    parts.push(description);
  } else if (step.pageTitle) {
    parts.push(`Viewing ${step.pageTitle}`);
  }

  const body = parts.length > 0 ? parts.join(' — ') : step.pageUrl || 'Unknown step';
  const suffix = actionSkipped ? ' (action skipped for safety)' : '';
  return escapeVtt(`Step ${step.stepNumber}: ${body}${suffix}`);
}

function msToVttTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n: number, len: number) => String(n).padStart(len, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

export function buildVtt(cues: Cue[]): string {
  let out = 'WEBVTT\n\n';
  cues.forEach((cue, i) => {
    out += `${i + 1}\n${msToVttTimestamp(cue.startMs)} --> ${msToVttTimestamp(cue.endMs)}\n${cue.text}\n\n`;
  });
  return out;
}
