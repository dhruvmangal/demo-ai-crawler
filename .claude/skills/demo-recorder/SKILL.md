---
name: demo-recorder
description: Execute a generated Playwright demo script (from demo-script-generator) inside a single recorded browser session, build a matching WebVTT caption track using this app's own caption-builder conventions, and heal any step that throws live before giving up. Use after the script exists, to actually produce the video.
---

# Recording the session

## One browser, one context, one page, for the whole run

```js
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: recordingsDir, size: { width: 1280, height: 720 } }
});
const page = await context.newPage();
page.setDefaultNavigationTimeout(30000);
page.setDefaultTimeout(10000);
const video = page.video();
```

Never launch a fresh browser per step -- that's what makes this one
continuous video instead of several disjointed clips. This mirrors
`src/recorder/workflow-recorder.ts` exactly; match it rather than
inventing different launch options.

## Dwell time: generous and content-proportional

After each step function returns, hold the frame before moving on --
roughly **2500-4000ms** depending on what the step actually shows (a bare
navigation needs less than a search-results reveal or a visual toggle).
A flat sub-second dwell (or worse, none) produces an unwatchable
flash-cut video. If you're recording N steps, the total video should
read as long as it takes a person to actually follow what happened, not
just as long as the automation took to execute.

## Cue timing and WebVTT format

Mirror `src/recorder/caption-builder.ts` exactly, don't invent a
different scheme:

```js
const cueStartMs = Math.max(Date.now() - recordingStart, cursorMs);
// ... run the step, then dwell ...
const cueEndMs = Math.max(Date.now() - recordingStart, cueStartMs + 1500);
cursorMs = cueEndMs;
```

The `max(..., cueStart + 1500)` clamp is what guarantees cues never
overlap even when a step finishes faster than 1500ms.

WebVTT output:
```
WEBVTT

1
00:00:00.000 --> 00:00:03.831
Step 1: <narration>

2
...
```
Escape `&`, `<`, `>` in caption text and collapse whitespace to a single
space, same as `escapeVtt` in `caption-builder.ts`.

## Healing a step that throws mid-recording

This is different from the pre-recording verification `demo-caption-writer`
already did -- that caught most problems before they got here, but
genuine mid-recording failures still happen (timing races, a page that
hadn't finished loading). When a step throws:

1. Diagnose live, in that same page/context -- don't open a second
   browser. Check visibility, whether the element moved, whether a
   viewport-driven CSS rule is hiding it (this exact thing happened with
   a Docusaurus mobile-only TOC toggle button that existed in the DOM but
   was hidden by a media query at 1280x720).
2. Fix and retry the step once.
3. If it still fails, fall back to a safe no-op for that step (skip the
   action, keep the narration or soften it to describe what's actually
   shown) and keep going -- don't abandon the whole recording over one
   step. Note what happened for the final report.

## Finalize the video -- remux it, don't just rename it

```js
} finally {
  await context.close(); // finalizes the video file
  await browser.close();
}
const recordedPath = await video.path();
```

**Don't `fs.renameSync` the raw Playwright output straight to its final
name.** Chromium's webm writer streams frames without knowing the total
length upfront, so it never finalizes a proper container Duration header.
`ffprobe` can still recover the real duration by scanning packets, but
players that trust the header instead -- browser `<video>` elements
included -- show a 0-duration, unseekable video even though the frame
data is completely intact. This is a real, observed failure mode, not a
hypothetical one: it's exactly what "the video is 0 seconds" looks like
to a user even when the recording actually worked.

Fix it by remuxing through `ffmpeg` (baked into the
`mcr.microsoft.com/playwright` base image already -- no install needed)
instead of a plain rename:

```js
const { execFileSync } = require('child_process');
const videoPath = path.join(recordingsDir, `${runId}.webm`);
execFileSync('ffmpeg', ['-y', '-i', recordedPath, '-c', 'copy', videoPath]);
fs.unlinkSync(recordedPath);
```

`-c copy` remuxes without re-encoding -- same video data, correct header,
no quality loss, and it's fast even for longer recordings.

```js
fs.writeFileSync(path.join(recordingsDir, `${runId}.vtt`), vttContent, 'utf-8');
```

`recordingsDir` is `/usr/src/app/recordings` inside the container --
shared across `crawler-app`/`admin`/`crawl-worker`/`workflow-agent-worker`
via one Docker volume, served at `http://localhost:3000/recordings/<file>`.

Once both files exist, follow the `demo-caption-viewer` skill -- a
`.webm` and `.vtt` sitting next to each other does **not** mean captions
show up when played; that pairing has to be wired explicitly.
