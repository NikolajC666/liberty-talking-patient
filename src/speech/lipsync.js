/**
 * Drives mouth morph targets from a viseme track.
 *
 * The scheduler works in two layers:
 *
 *   1. On `start`, every word is laid out sequentially using an estimated
 *      milliseconds-per-unit. This alone produces usable lip-sync, and is the
 *      only thing available on voices that never emit boundary events.
 *
 *   2. Each boundary event snaps the word it names to the real clock and
 *      re-lays out everything after it. Error is therefore bounded by one word
 *      no matter how long the utterance — cumulative drift cannot accumulate.
 *
 * The estimate self-calibrates: every observed word gives us a fresh reading of
 * how long a "unit" actually lasts for the current voice and rate, which is fed
 * back into the layout of the words still to come.
 */

import { OPENNESS } from './visemes.js';

/** Starting guess for one duration unit at rate 1.0, in milliseconds. */
const BASE_UNIT_MS = 115;
const MIN_UNIT_MS = 45;
const MAX_UNIT_MS = 320;

/** How strongly each observation pulls the running estimate. */
const CALIBRATION_GAIN = 0.35;

export function createLipsync() {
  let track = null;
  let unitMs = BASE_UNIT_MS;
  let rate = 1;
  let lastBoundaryAt = null;
  let boundaryCount = 0;
  let finishedAt = null;
  let active = [];

  const settings = {
    attackMs: 45,
    decayMs: 90,
    intensity: 1.0,
    jawCoupling: 0.45,
    offsetMs: 0,
  };

  /** Lay out words [from..] end to end, starting from that word's own start. */
  function layout(from) {
    let cursor = track.words[from]?.startMs ?? performance.now();
    for (let i = from; i < track.words.length; i += 1) {
      const word = track.words[i];
      word.startMs = cursor;
      word.endMs = cursor + Math.max(60, word.units * unitMs);
      cursor = word.endMs;
    }
  }

  return {
    settings,

    /** Begin an utterance. `now` is a performance.now() timestamp. */
    start(newTrack, now, playbackRate = 1) {
      track = newTrack;
      rate = playbackRate || 1;
      unitMs = BASE_UNIT_MS / rate;
      lastBoundaryAt = null;
      boundaryCount = 0;
      finishedAt = null;
      active = [];
      if (track.words.length) {
        track.words[0].startMs = now;
        layout(0);
      }
    },

    /**
     * A word has just begun. We deliberately ignore the event's own
     * `elapsedTime` — browsers disagree on whether it is seconds or
     * milliseconds — and trust our own clock instead.
     */
    boundary(charIndex, now) {
      if (!track) return;

      const i = track.words.findIndex((w) => charIndex >= w.start && charIndex < w.end);
      const word = i >= 0 ? track.words[i] : null;
      if (!word) return;

      boundaryCount += 1;

      // The gap since the previous boundary tells us what a unit really costs.
      if (lastBoundaryAt !== null) {
        const prev = track.words
          .slice(0, i)
          .reverse()
          .find((w) => w.observed);
        if (prev && prev.units > 0) {
          const observedUnit = (now - lastBoundaryAt) / prev.units;
          if (observedUnit > MIN_UNIT_MS && observedUnit < MAX_UNIT_MS) {
            unitMs += (observedUnit - unitMs) * CALIBRATION_GAIN;
          }
          prev.endMs = now;
        }
      }

      word.startMs = now;
      word.observed = true;
      lastBoundaryAt = now;
      layout(i);
    },

    /** The synthesiser has stopped. Let the final shapes decay out naturally. */
    end(now) {
      if (!track) return;
      const last = track.words.at(-1);
      if (last && last.endMs > now) last.endMs = now;
      finishedAt = now;
    },

    /** Hard reset — used by Stop, so the mouth closes immediately. */
    clear() {
      track = null;
      active = [];
      finishedAt = null;
    },

    /**
     * Write this frame's mouth shapes into `pose`.
     * @param {number} now performance.now()
     * @param {Record<string, number>} pose accumulator shared with the idle system
     */
    update(now, pose) {
      active = [];
      if (!track) return;

      const t = now + settings.offsetMs;
      const { attackMs, decayMs, intensity, jawCoupling } = settings;
      let jaw = 0;

      for (const word of track.words) {
        if (word.startMs === null) continue;
        // Skip words wholly outside the envelope window.
        if (word.endMs + decayMs < t || word.startMs - attackMs > t) continue;

        const span = Math.max(1, word.endMs - word.startMs);
        let cursor = word.startMs;

        for (const viseme of word.visemes) {
          const dur = (viseme.units / word.units) * span;
          const s = cursor;
          const e = cursor + dur;
          cursor = e;

          if (t < s - attackMs || t > e + decayMs) continue;

          // Trapezoid envelope: ramp in before the slot, hold, ramp out after.
          const rampIn = attackMs > 0 ? (t - (s - attackMs)) / attackMs : t >= s ? 1 : 0;
          const rampOut = decayMs > 0 ? (e + decayMs - t) / decayMs : t <= e ? 1 : 0;
          const env = Math.max(0, Math.min(1, rampIn, rampOut));
          if (env <= 0) continue;

          const value = env * viseme.weight * intensity;
          // Overlapping shapes take the strongest rather than summing, which
          // would push blendshapes past 1 and distort the face.
          pose[viseme.name] = Math.max(pose[viseme.name] ?? 0, value);
          jaw = Math.max(jaw, (OPENNESS[viseme.name] ?? 0) * value * jawCoupling);

          if (env > 0.5) active.push(viseme.name);
        }
      }

      if (jaw > 0) pose.jawOpen = Math.max(pose.jawOpen ?? 0, jaw);

      // Once everything has decayed away, drop the track so we stop iterating.
      if (finishedAt !== null && now > finishedAt + decayMs + 120) {
        track = null;
      }
    },

    /** Snapshot for the debug panel. */
    inspect() {
      return {
        track,
        unitMs,
        rate,
        boundaryCount,
        active: active[active.length - 1] ?? null,
        source: boundaryCount > 0 ? 'boundary-corrected' : track ? 'estimated' : '—',
      };
    },
  };
}
