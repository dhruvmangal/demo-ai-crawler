---
name: demo-caption-viewer
description: Given an existing <runId>.webm + <runId>.vtt pair in this app's recordings volume, produce a small standalone HTML viewer that actually wires the captions into video playback -- the same <video><track> pairing this app's own admin UI uses. A raw .webm never carries an external .vtt automatically, no matter what plays it. Use whenever a recording's captions aren't showing up, or right after demo-recorder finishes.
---

# Making captions actually show up

WebVTT is a sidecar file. Writing `<runId>.webm` and `<runId>.vtt` next
to each other in the recordings folder does **nothing** on its own --
opening the raw `.webm` URL directly, or playing it in a native video
player, will never show captions, because nothing has told any player
that the two files are related. This is true even though the caption
content is completely correct and the file is reachable.

This app's own admin UI wires the pairing explicitly
(`public/admin/admin.js:435-444`):

```js
video.src = `/recordings/${run.video_path}`;
if (run.captions_path) {
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'Narration';
  track.srclang = 'en';
  track.default = true;
  track.src = `/recordings/${run.captions_path}`;
  video.appendChild(track);
}
```

But that only fires for runs registered as real `workflow_runs` rows --
it won't pick up a `.webm`/`.vtt` pair that was written by hand outside
that flow.

## What to produce

Write a small standalone `<runId>.html` next to the video/captions in the
recordings directory, with the same pairing hardcoded -- but instead of a bare
`<video controls>`, load this app's own Netflix-style player
(`public/admin/admin.js`'s `createVideoPlayer()` + `public/admin/admin.css`)
from the admin backoffice service, which shares the `recordings` volume and
runs alongside crawler-app in the same compose stack. Loading a `<link>`/
`<script src>` across the 3000 -> 3001 origin is fine (that's not subject to
CORS -- only `fetch`/XHR reads are); `admin.js` is guarded to no-op its own
admin-page init when the surrounding page (like this one) has no `#filter`
element, so it's safe to reuse standalone here:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Demo recording</title>
  <link rel="stylesheet" href="http://localhost:3001/admin/admin.css">
  <style>
    body { background: #05080b; margin: 0; padding: 32px; font-family: 'SFMono-Regular', Consolas, monospace; }
    .player { max-width: 900px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="wrap"></div>
  <script src="http://localhost:3001/admin/admin.js"></script>
  <script>
    document.getElementById('wrap').appendChild(createVideoPlayer({
      src: '/recordings/<runId>.webm',
      captionsSrc: '/recordings/<runId>.vtt',
    }));
  </script>
</body>
</html>
```

`createVideoPlayer` already does the `<video>` + `<track>` pairing internally
(see `public/admin/admin.js`), plus play/pause, skip, volume, a CC toggle that
loads/unloads the subtitle track, aspect-ratio cycling and fullscreen -- so
this gets the same elegant player the admin recordings tab uses, for free.

Write it to the same shared recordings volume the video/captions are in
(`/usr/src/app/recordings/<runId>.html` inside any container that shares
the volume), so it's reachable the same way:
`http://localhost:3000/recordings/<runId>.html`.

Opening that URL is what actually makes "captions enabled into the
video" true -- report that URL as the primary way to view the result,
not the raw `.webm` URL. Still mention the raw video/caption URLs too,
since they're useful for downloading or for wiring into a real
`workflow_runs` row later, but they don't show captions by themselves.
