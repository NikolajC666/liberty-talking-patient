# Talking patient — browser lip-sync spike

**Live demo: https://nikolajc666.github.io/liberty-talking-patient/**

A browser talking head for nursing simulation: type a line, the patient says it,
the mouth follows. Built with three.js and the Web Speech API, no API keys, no
game engine, no per-seat licence.

Use Chrome or Edge — the demo depends on `speechSynthesis`, and voice quality
and boundary-event support both vary by browser.

Drag to turn the patient (±20° each way), double-click to centre, and press
**D** for the instrumentation panel.

This is a **feasibility spike**. The point is not the demo — it is the answer to
"how good does browser lip-sync get, and where does it break?". That answer
lives in [FINDINGS.md](FINDINGS.md).

`example.webp` is the vSim for Nursing reference this is aiming at.

## Running it

```sh
npm install
npm run fetch-avatar avatarsdk
npm run dev
```

### Avatars

`fetch-avatar` takes either a preset or a Ready Player Me link.

| Preset | |
| --- | --- |
| `avatarsdk` | Avatar SDK — photogrammetric, most realistic (12 MB) |
| `avaturn` | Avaturn — realistic, separate tongue mesh (14 MB) |
| `brunette` | Ready Player Me — stylised, smallest (4.7 MB) |
| `mpfb` | MakeHuman — 14 visemes only (37 MB) |

Presets come from the MIT-licensed
[met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead)
repository. All carry the fifteen Oculus visemes plus ARKit shapes on a
mixamo-named rig, which is what this app expects. They are **sample assets —
check licensing before shipping anything built on them.**

To use your own, create one at [readyplayer.me](https://readyplayer.me) (no
account needed for the demo creator) and pass its `.glb` URL. The script adds
`morphTargets=ARKit,Oculus Visemes` for you — **without those parameters the
model has no visemes and the mouth cannot move** — then verifies the blendshapes
actually arrived.

Note that `readyplayer.me` is DNS-blocked on the Laerdal corporate network, so
the presets are the only route that works from a company machine.

Skip this step entirely and the app runs a crude procedural head, so the
pipeline is testable before any avatar exists.

Press **D** or the Debug button for the instrumentation panel.

```sh
npm test          # viseme rules
npm run build     # production bundle
npm run deploy    # build and publish to GitHub Pages
```

`npm run deploy` pushes `dist/` to the `gh-pages` branch. Fetch an avatar first,
or the deployed site ships the placeholder head.

There is also `.github/workflows/deploy.yml`, which does the same thing on every
push to `main` and fetches the avatar itself. It is currently untracked, because
GitHub rejects pushes that touch workflow files unless the token carries the
`workflow` scope. To switch over: `gh auth refresh -s workflow`, then delete the
`.github/workflows/` line from `.gitignore` and commit.

## How it works

```
you type
   │
   ├─ respond.js ......... getResponse(text)   ← seam for an AI patient
   │
   ├─ visemes.js ......... text → viseme track, in relative time units
   │
   ├─ tts.js ............. speechSynthesis speaks it, emitting word boundaries
   │
   ├─ lipsync.js ......... stretches the track onto the real clock; every
   │                       boundary event re-anchors it and recalibrates
   │
   └─ avatar.js .......... blendshape values written to the glTF each frame
```

Every frame builds a fresh `pose` object of blendshape-name → 0..1. `idle.js`
and `lipsync.js` both write into it before `avatar.applyPose()` applies it and
zeroes everything else. Neither system owns the face, so a blink and a viseme
can never stomp each other.

### The central trick

`speechSynthesis` will not tell you where the phonemes are, and will not give
you the audio to work it out yourself. What it *does* give is a word-boundary
event. So the mouth shapes are predicted from the spelling and then **re-anchored
to the real clock on every word**, with the observed word durations feeding back
into the estimate for the words still to come.

The consequence worth testing: timing error is bounded by one word, so a long
paragraph cannot drift out of sync the way a fire-and-forget schedule would.

## Layout

| Path | |
| --- | --- |
| `src/main.js` | boot, render loop, pose composition |
| `src/scene.js` | renderer, portrait-lens camera, three-point lighting |
| `src/avatar.js` | glTF loading and the procedural fallback head |
| `src/controls.js` | clamped drag-to-turn, pivoted at the head |
| `src/idle.js` | blinking, breathing, head drift, saccades |
| `src/speech/visemes.js` | text → viseme track (pure, unit-tested) |
| `src/speech/lipsync.js` | scheduling, boundary correction, blending |
| `src/speech/tts.js` | Web Speech driver and its browser quirks |
| `src/respond.js` | the AI-patient seam |
| `src/ui.js` | composer and instrumentation panel |

## Known limits

Read FINDINGS.md before showing this to anyone. The two that matter most:

- **A Ready Player Me avatar will not look like `example.webp`.** It is
  stylised-realistic and skews young; the reference is a photoreal elderly
  patient. This spike answers the lip-sync question, not the photorealism one.
- **"No cloud" depends on the voice.** Chrome's `Google …` voices synthesise
  server-side even though they need no API key. The voice picker labels which
  are on-device.
