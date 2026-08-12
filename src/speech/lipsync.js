/**
 * Drives mouth morph targets from a viseme track.
 *
 * SCHEDULING works in two layers:
 *
 *   1. On `start`, every word is laid out sequentially using an estimated
 *      milliseconds-per-unit. This alone produces usable lip-sync, and is the
 *      only thing available on voices that never emit boundary events.
 *
 *   2. Each boundary event snaps the word it names to the real clock and
 *      re-lays out everything after it. Error is therefore bounded by one word
 *      no matter how long the utterance — cumulative drift cannot accumulate.
 *
 * ANIMATION is a critically-damped spring per morph channel, seeking whichever
 * viseme the schedule says is current. This replaced an earlier scheme that
 * gave each viseme its own trapezoid envelope, which made the mouth visibly
 * overact: every phoneme reached its full shape regardless of how long it
 * actually lasted.
 *
 * A spring has mass. A 40 ms consonant between two vowels physically cannot
 * arrive before it is asked to leave again, so articulatory undershoot emerges
 * from the model rather than being dialled in — which is what real articulators
 * do. Combined with the visual-salience weights in `visemes.js`, this is most
 * of the difference between "chattering" and "speaking".
 */

import { OPENNESS, SALIENCE } from './visemes.js';

/** Starting guess for one duration unit at rate 1.0, in milliseconds. */
const BASE_UNIT_MS = 115;
const MIN_UNIT_MS = 45;
const MAX_UNIT_MS = 320;

/** How strongly each observed word pulls the running estimate. */
const CALIBRATION_GAIN = 0.35;

/**
 * The jaw shuts faster than it drops — and a bilabial that fails to close
 * because the jaw is still lagging open reads as a mistake. Closing motions get
 * a stiffer spring than opening ones.
 */
const CLOSING_STIFFNESS = 1.7;

/** Below this a channel is treated as at rest and dropped. */
const EPSILON = 1e-3;

/**
 * One implicit-Euler step of a critically damped spring. Unconditionally
 * stable, which matters because frame times spike.
 */
function springStep(x, v, target, omega, dt) {
  const nextV = (v - dt * omega * omega * (x - target)) / (1 + 2 * omega * dt + omega * omega * dt * dt);
  return [x + dt * nextV, nextV];
}

export function createLipsync() {
  let track = null;
  let unitMs = BASE_UNIT_MS;
  let rate = 1;
  let lastBoundaryAt = null;
  let boundaryCount = 0;
  let finishedAt = null;
  let lastFrameAt = null;
  let activeName = null;

  /** name -> { value, velocity } for every channel currently in motion. */
  const channels = new Map();

  const settings = {
    /** Spring settle time in ms; lower is snappier, higher undershoots more. */
    responseMs: 85,
    intensity: 1.0,
    jawCoupling: 0.25,
    offsetMs: 0,
    /**
     * Pin a single viseme on, ignoring the schedule. Purely diagnostic: it is
     * the only way to look at one mouth shape long enough to judge it, rather
     * than trying to catch it in a 60 ms window mid-sentence.
     */
    hold: null,
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

  /** Which viseme the schedule says we should be making at time `t`. */
  function visemeAt(t) {
    if (!track) return null;

    for (const word of track.words) {
      if (word.startMs === null || t < word.startMs || t >= word.endMs) continue;

      const span = Math.max(1, word.endMs - word.startMs);
      let cursor = word.startMs;
      for (const viseme of word.visemes) {
        const end = cursor + (viseme.units / word.units) * span;
        if (t < end) return viseme;
        cursor = end;
      }
      return word.visemes.at(-1) ?? null;
    }
    return null;
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
        const prev = track.words.slice(0, i).reverse().find((w) => w.observed);
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

    /** The synthesiser has stopped. Springs relax to rest on their own. */
    end(now) {
      if (!track) return;
      const last = track.words.at(-1);
      if (last && last.endMs > now) last.endMs = now;
      finishedAt = now;
    },

    /** Hard reset — used by Stop. Springs still relax rather than snapping. */
    clear() {
      track = null;
      finishedAt = null;
      activeName = null;
    },

    /**
     * Write this frame's mouth shapes into `pose`.
     * @param {number} now performance.now()
     * @param {Record<string, number>} pose accumulator shared with the idle system
     */
    update(now, pose) {
      const dt = lastFrameAt === null ? 1 / 60 : Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      const { responseMs, intensity, jawCoupling } = settings;
      const viseme = settings.hold
        ? { name: settings.hold, weight: 1, units: 1 }
        : visemeAt(now + settings.offsetMs);
      activeName = viseme?.name ?? null;

      // Targets: the current viseme at its visual-salience weight, and a jaw
      // opening to match. Everything else seeks zero.
      const targets = new Map();
      if (viseme && viseme.name !== 'viseme_sil') {
        const weight = (SALIENCE[viseme.name] ?? 0.6) * viseme.weight * intensity;
        targets.set(viseme.name, weight);
        const jaw = (OPENNESS[viseme.name] ?? 0) * weight * jawCoupling;
        if (jaw > 0) targets.set('jawOpen', jaw);
      }

      // Springs need to keep running for channels that are on their way back to
      // rest, so integrate the union of live channels and current targets.
      for (const name of targets.keys()) {
        if (!channels.has(name)) channels.set(name, { value: 0, velocity: 0 });
      }

      const omegaBase = (2 * Math.PI) / Math.max(0.016, responseMs / 1000);

      for (const [name, channel] of channels) {
        const target = targets.get(name) ?? 0;
        const omega = target < channel.value ? omegaBase * CLOSING_STIFFNESS : omegaBase;
        const [value, velocity] = springStep(channel.value, channel.velocity, target, omega, dt);
        channel.value = value;
        channel.velocity = velocity;

        if (target === 0 && Math.abs(value) < EPSILON && Math.abs(velocity) < EPSILON) {
          channels.delete(name);
          continue;
        }

        // Clamp: a spring can overshoot past 1, which distorts a blendshape.
        const clamped = Math.max(0, Math.min(1, value));
        if (clamped > 0) pose[name] = Math.max(pose[name] ?? 0, clamped);
      }

      // Once the utterance is over and the face has settled, drop the track.
      if (finishedAt !== null && now > finishedAt && channels.size === 0) {
        track = null;
        finishedAt = null;
      }
    },

    /** Snapshot for the debug panel. */
    inspect() {
      return {
        track,
        unitMs,
        rate,
        boundaryCount,
        active: activeName,
        channels: channels.size,
        source: boundaryCount > 0 ? 'boundary-corrected' : track ? 'estimated' : '—',
      };
    },
  };
}
