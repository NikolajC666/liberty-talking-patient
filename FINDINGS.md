# Findings

The question this spike exists to answer: **can open-source web 3D produce a
convincing talking patient, and what would production need that a prototype can
fake?**

This document has two halves. The first is settled — it follows from the
platform APIs and from code that is written and tested. The second needs a
browser and a pair of eyes, and is marked accordingly. Nothing below is a
guess dressed up as a measurement.

---

## Part 1 — Settled

### 1. The synthesised audio is unreachable. This is the constraint everything else follows from.

`speechSynthesis` writes straight to the output device. It exposes no
`MediaStream`, no `AudioNode`, no buffer. There is no supported route into Web
Audio.

Every technique that analyses the voice to drive the mouth — amplitude
envelopes, formant tracking, neural audio-to-viseme — is therefore **off the
table for Web Speech**, not because it is hard but because the bytes do not
exist in the page. Any approach that wants them needs a TTS engine that hands
back audio: a cloud API, or a local model like Piper.

This is the single most important thing to know before choosing a production
path, and it is invisible until you try.

### 2. What the API does give: word boundaries, with caveats.

`SpeechSynthesisUtterance.onboundary` fires per word with a `charIndex` into the
original string. That is enough to anchor a predicted mouth-shape sequence to
real time.

Two traps, both handled in `src/speech/tts.js`:

- **`elapsedTime` units are not portable.** The spec says seconds;
  implementations have shipped milliseconds. We ignore the field entirely and
  take our own `performance.now()` reading when the event arrives.
- **Chrome truncates long utterances** at roughly 15 seconds unless `resume()`
  is called periodically. A long-standing bug; the keepalive in `tts.js` is the
  standard workaround.

Also: `getVoices()` returns empty on first call in Chrome until `voiceschanged`
fires, and `cancel()` immediately followed by `speak()` can drop the new
utterance.

### 3. Boundary correction bounds the error at one word.

`src/speech/lipsync.js` lays out the whole utterance up front from an estimated
milliseconds-per-unit, then each boundary event snaps that word to the real
clock and re-lays out everything after it. Every observed word also updates the
running estimate, so the prediction improves as the sentence goes on.

The structural consequence: **error cannot accumulate.** A fire-and-forget
schedule drifts without limit over a paragraph; this one is re-anchored several
times a second. Worst case is one word of lag, and only until the next boundary.

It also degrades rather than fails. On a voice that emits no boundary events at
all, the estimated layout still runs and the readout says `estimated` instead of
`boundary-corrected`.

### 4. Letter-to-viseme is a real approximation, and its failures are specific.

We map spelling to mouth shapes directly rather than shipping a pronunciation
dictionary — CMUdict is ~3 MB, and with only fifteen distinguishable shapes the
approximation mostly survives. `src/speech/visemes.js` handles digraphs, silent
and magic `e`, doubled letters, soft `c`/`g`, and digits, all unit-tested.

Where it is wrong, it is wrong predictably:

| Case | Example | What happens |
| --- | --- | --- |
| Irregular vowels | "one", "colonel" | Shaped as spelled; visibly wrong |
| Magic-e exceptions | "have", "give" | Handled by a short exception list — which is inherently incomplete |
| Unstressed schwa | "the", "about" | Over-articulated; the mouth is too busy |
| Silent letters beyond `gh`/`kn` | "psalm", "debt" | Extra shapes appear |
| Non-English | any | Not modelled at all |

The honest summary: this is a *spelling* model, not a pronunciation model. It
is right often enough for a prototype and would not survive scrutiny in a
shipped product. A production build should use a phonemiser, and if it is
already paying for cloud TTS it should take the phoneme timings from there.

### 5. Over-articulation was the first problem, not inaccuracy. **(Observed)**

First look at the running app: the mouth was *excessive* and the shapes were
wrong. Two separate faults, and the excessive one turned out to dominate — a
face that overacts reads as wrong even where the shape is right.

Three causes, all in the animation layer rather than the phonetics:

1. **Every viseme reached full amplitude**, regardless of how long its slot
   was. A 40 ms consonant was drawn as emphatically as a 200 ms vowel.
2. **Independent trapezoid envelopes per viseme.** With attack and decay
   overlapping, several shapes were held at once — the mouth attempting three
   phonemes simultaneously.
3. **Every consonant weighted like a vowel**, with `jawOpen` stacked on top.

The fix was to make the articulators behave like objects with mass. Each morph
channel is now a critically-damped spring seeking whichever single viseme the
schedule says is current; everything else seeks zero. A shape the mouth has no
time to reach simply is not reached, so undershoot falls out of the model rather
than being tuned in. Closing motions get a stiffer spring than opening ones,
because a bilabial that fails to shut is the most visible error there is.

Alongside it, visemes are now weighted by **visual salience** — how much of the
articulation is externally visible. Velars (`k`, `g`) are made at the back of
the tongue and show almost nothing; alveolars (`t`, `d`, `n`, `l`) little more.
What a viewer reads is vowels, bilabials and labiodentals. This is why viseme
sets are equivalence classes in the first place, and driving the invisible
consonants at full weight is what produced the chatter.

The general lesson, which would apply to any avatar work: **most of what reads
as "bad lip-sync" is an animation problem, not a phonetics problem.** Worth
exhausting the animation model before spending money on better phonemes.

### 6. Idle motion matters more than lip-sync quality.

Not measurable, but worth stating because it drives where effort goes. A head
that moves only when speaking reads as a mannequin between lines, and no amount
of mouth accuracy rescues that. Blinking, breathing and sub-degree head drift
are perhaps sixty lines of code (`src/idle.js`) and do more for believability
than the entire viseme pipeline.

### 7. Cost and footprint.

- Bundle: **624 kB, 161 kB gzipped**, almost all three.js.
- Dependencies: two (`three`, `vite`).
- Licence cost: zero. Ready Player Me avatars are free to use; three.js is MIT.
- Runtime network calls: **none**, once the avatar is on disk — with the
  exception in §8.

### 8. Ready Player Me is DNS-blocked on the Laerdal network.

`models.readyplayer.me` and `readyplayer.me` do not resolve from a company
machine. npm, GitHub and everything else tested resolve normally, so this is
targeted filtering rather than a general restriction. No API key or account
would change it.

Worth knowing before anyone plans a workflow around the RPM creator: on a
Laerdal laptop, avatars have to arrive by some other route.

The workaround in use is `npm run fetch-avatar <preset>`, which pulls
ready-rigged sample avatars from the MIT-licensed met4citizen/TalkingHead
repository on GitHub. Four were verified to carry all fifteen Oculus visemes,
`jawOpen`, `eyeBlinkLeft` and a mixamo-named rig — so they drop into this app
with no code change:

| Preset | Morphs | Visemes | Size |
| --- | --- | --- | --- |
| `avatarsdk` (default) | 66 | 15 | 12 MB |
| `avaturn` | 72 | 15 | 14 MB |
| `brunette` (RPM) | 72 | 15 | 4.7 MB |
| `mpfb` | 66 | 14 | 37 MB |

These are demo assets bundled in an MIT-licensed repository. The repository
licence covers the code; the assets came from four different avatar vendors and
their terms have not been checked. Fine for an internal spike. **Do not ship on
them.**

### 9. Voice privacy and voice quality are inversely correlated, and the API only reports one of them. **(Observed)**

`voice.localService` tells you *where* synthesis happens. Nothing in the Web
Speech API tells you how good a voice sounds — and on Windows the two run
opposite to each other.

The only on-device voices installed on a standard Laerdal machine are:

```
Microsoft David Desktop   en-US   Male
Microsoft Zira Desktop    en-US   Female
```

Both are 2013-era concatenative SAPI voices. Meanwhile Microsoft's genuinely
natural neural voices — `Microsoft … Online (Natural)` — are exposed free and
without an API key **through Edge's Web Speech implementation**, and are
server-side. Chrome does not expose them at all; it offers Google's network
voices, which land in between.

So "keep it on-device" and "make it sound human" are, on this platform, direct
opposites. That is a procurement question rather than a technical one, and it
needs deciding before anyone demos patient dialogue.

The picker originally defaulted to an on-device English voice, which reliably
selected the worst-sounding option on the machine while appearing to be a
neutral default. It now ranks by inferred quality (`voiceQuality()` in
`tts.js`) and states plainly, per voice, whether audio leaves the device — the
tradeoff is surfaced rather than made silently.

Gender is not reported either. `SpeechSynthesisVoice` carries only `name`,
`lang`, `localService` and `default`, so selecting a male voice for a male
patient means matching against a list of known voice names — brittle by
construction, and worth knowing about if voice selection ever needs to be
driven by scenario metadata.

### 10. Oculus visemes are the exception; ARKit is the industry default. **(Observed)**

The pipeline was built against Ready Player Me's fifteen `viseme_*` blendshapes.
A MetaPerson export from Avatar SDK turned out to carry **51 ARKit shapes and
zero visemes** — and MetaPerson is far more representative. Character Creator,
Daz and anything rigged for iPhone face capture all ship ARKit; Ready Player Me
is the outlier for baking visemes in.

The visemes can be synthesised. Each is a fixed pose over ARKit shapes —
`viseme_PP` is `mouthClose` plus `mouthPress*`, `viseme_U` is `mouthPucker` plus
`mouthFunnel` — scaled by whatever weight the lip-sync spring has arrived at, so
the salience and undershoot work upstream survives untouched
(`src/speech/arkitVisemes.js`).

Two things this cost, both minor:

- **No tongue.** MetaPerson omits ARKit's 52nd shape, `tongueOut`, so `TH` and
  the alveolars are approximated with jaw and lip movement. At conversational
  distance this is nearly free.
- **Format.** MetaPerson exports FBX, not glTF. `FBXLoader` handles it including
  embedded textures, at ~63 kB of bundle. Two gotchas: FBX has no reliable unit
  convention (models arrive in centimetres and need rescaling to metres), and
  the loader produces Phong materials that ignore PBR maps, so they need
  promoting to `MeshStandardMaterial`.

The useful conclusion: **an avatar only needs one of the two blendshape
conventions**, and the speech code no longer constrains the choice of character
vendor. Given §8 — that the reference patient is an elderly man none of the
free presets resemble — keeping that door open matters more than it first
appeared.

### 11. If better audio is needed, the ladder is short.

| Option | Keys | Local | Phoneme timings | Notes |
| --- | --- | --- | --- | --- |
| Edge neural voices | no | no | **unverified** | Free, already wired up |
| Kokoro-82M in-browser | no | yes | no (audio only) | ~90 MB model, WebGPU |
| Azure Speech | yes | no | **yes** | Also SSML speaking styles |
| ElevenLabs | yes | no | no (audio only) | Most realistic and emotive |

Everything below the first row returns an **audio buffer**, which breaks the
constraint in §1: once the audio is in the page, Web Audio can analyse it and
lip-sync stops being a prediction problem.

**Open question, deliberately unresolved:** whether nursing simulation needs
*expressive* delivery — breathless, weak, in pain — rather than merely natural
delivery. A flawlessly smooth neural voice saying "I can't catch my breath" may
be less useful than a rougher one that sounds distressed. Web Speech exposes
rate and pitch and nothing else; Azure has speaking styles and ElevenLabs has
emotional control. Judged not to matter for the spike; likely to matter for a
product.

---

## Part 2 — To measure in the browser

These need the app running and someone watching. Procedure and what to look for:

### A. Does the sync actually read as correct?

Open the debug panel, speak `Nurse, I can't catch my breath.` and watch the
timeline strip. Amber ticks are real boundary events; blue blocks are the
predicted viseme windows.

- Are the amber ticks landing near the start of their word's blocks?
- Perceptually, does the mouth lead or lag? Use the **lead/lag** slider to find
  the offset that looks right, then record it — a consistent non-zero value
  means there is a fixed latency worth compensating for by default.

### B. Does the one-word-error claim hold over a paragraph?

Speak sixty or so words. Compare the sync in the first sentence and the last.
If the claim in §3 is right there should be no perceptible difference.

### C. Which voices emit boundary events?

Step through the voice list. The **Timing source** readout says
`boundary-corrected` or `estimated`. Note which voices fall back — and whether
the fallback is obviously worse to watch, or only obviously worse on the
timeline.

**The one that matters most:** do Edge's `Online (Natural)` neural voices emit
boundary events? If they do, this platform gives good audio *and* accurate sync
for free, and the case for paying for Azure weakens considerably. If they do
not, then §9's privacy-versus-quality tradeoff gains a third axis — better audio
costs sync accuracy too — and the argument for a TTS that returns real viseme
timings gets much stronger.

### D. Calibrated unit.

The **Calibrated unit** readout converges on the real cost of a duration unit
for the current voice and rate. If it settles far from the 115 ms starting
guess, that constant should be retuned.

### E. Cross-browser.

Run in Chrome and Edge. Different voice sets, different boundary behaviour,
possibly different truncation. Differences here are findings, not bugs.

### F. Tablet.

The reference is a tablet screenshot. Check the frame rate and whether the
composer and debug panel are usable at that size.

---

## Recommendation, pending Part 2

For a **prototype or an internal demo**, this stack is sufficient and costs
nothing.

For **production**, the ranking changes on §1 alone. If the audio matters — and
for patient dialogue it does — Web Speech's inability to hand back its own audio
makes it a dead end. The natural next step is Azure Speech, which emits real
viseme events with timings, removing both the phonemiser problem (§4) and the
prediction machinery (§3) at the cost of a key and a proxy. `src/speech/tts.js`
is the only file that would change.

On the avatar: none of the presets in §8 will pass for the patient in
`example.webp`. They are healthy adults in street clothes; the reference is a
photoreal elderly patient, supine, in a gown, on oxygen. Closing that gap is a
character-art problem, not a code problem — the pipeline here is indifferent to
which glTF it drives, provided the fifteen visemes are present.

The realistic commercial path to a photoreal, age-appropriate character with
ARKit blendshapes is Character Creator 4 or Daz, exported to glTF. MetaHuman is
the obvious wish and is licence-restricted outside Unreal, so it is not
available here.

The encouraging half of that: swapping avatars is one command and no code, and
four vendors' rigs were verified interchangeable. Whatever art route Laerdal
picks, the lip-sync work is not thrown away.
