export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

function escapeVtt(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
}

/**
 * Builds one caption line per step, from the narration decided once at script
 * generation/heal time (see deterministic-script-engine.ts/script-healer.ts) and stored
 * on the step -- there's no live per-run narration call anymore, so narration is always
 * present by construction.
 */
export function buildCaptionText(stepNumber: number, actionSkipped: boolean, narration: string): string {
  const suffix = actionSkipped ? ' (action skipped for safety)' : '';
  return escapeVtt(`Step ${stepNumber}: ${narration}${suffix}`);
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
