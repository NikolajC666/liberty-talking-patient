/**
 * The animation model is deterministic — `update()` takes an explicit clock
 * rather than reading one — so the spring behaviour can be pinned down without
 * a browser.
 *
 * These guard the properties that stop the mouth overacting, which was the
 * failure the trapezoid-envelope version had.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../src/speech/visemes.js';
import { createLipsync } from '../src/speech/lipsync.js';
import { SALIENCE } from '../src/speech/visemes.js';

const STEP_MS = 16;

/** Play an utterance on a synthetic clock and record what the face did. */
function play(text, { durationMs = 3000, settings = {}, endAt = null } = {}) {
  const lipsync = createLipsync();
  Object.assign(lipsync.settings, settings);

  const track = buildTrack(text);
  lipsync.start(track, 0, 1);

  const peaks = new Map();
  let maxSeen = 0;
  let lastPose = {};

  for (let t = 0; t <= durationMs; t += STEP_MS) {
    if (endAt !== null && t >= endAt && t - STEP_MS < endAt) lipsync.end(t);
    const pose = {};
    lipsync.update(t, pose);
    lastPose = pose;
    for (const [name, value] of Object.entries(pose)) {
      peaks.set(name, Math.max(peaks.get(name) ?? 0, value));
      maxSeen = Math.max(maxSeen, value);
    }
  }

  return { peaks, maxSeen, lastPose, lipsync, track };
}

test('no blendshape is ever driven past 1', () => {
  // A spring can overshoot; blendshape values above 1 distort the face.
  const { maxSeen } = play('Nurse, I have a sharp pain in my chest and I feel sick.', {
    settings: { responseMs: 20, intensity: 1.5 },
  });
  assert.ok(maxSeen <= 1, `peaked at ${maxSeen}`);
});

test('a slower spring undershoots more', () => {
  // This is the whole point of the model: shapes the mouth cannot reach in the
  // time available should not be reached.
  const fast = play('pat a cat', { settings: { responseMs: 20 } });
  const slow = play('pat a cat', { settings: { responseMs: 220 } });

  assert.ok(
    slow.peaks.get('viseme_aa') < fast.peaks.get('viseme_aa'),
    `slow ${slow.peaks.get('viseme_aa')} should undershoot fast ${fast.peaks.get('viseme_aa')}`,
  );
});

test('externally invisible consonants stay quiet', () => {
  // Velars are articulated out of sight; driving them hard is what made the
  // face chatter.
  const { peaks } = play('a cat');
  assert.ok(peaks.get('viseme_kk') < peaks.get('viseme_aa'));
  assert.ok(peaks.get('viseme_kk') <= SALIENCE.viseme_kk);
});

test('bilabials still close the lips properly', () => {
  // The counterpart risk: damping everything would leave "m" and "b" open,
  // which is the single most noticeable lip-sync error there is.
  const { peaks } = play('mama papa');
  assert.ok(peaks.get('viseme_PP') > 0.6, `PP only reached ${peaks.get('viseme_PP')}`);
});

test('the mouth returns to rest after the utterance', () => {
  const { lastPose } = play('I feel sick.', { durationMs: 4000, endAt: 900 });
  assert.deepEqual(lastPose, {}, 'every channel should have relaxed to zero');
});

test('only one viseme is targeted at a time', () => {
  // The old model held overlapping envelopes, so the mouth tried to make
  // several shapes at once. Now non-target channels are on their way to zero,
  // so the total should stay near a single shape's worth.
  const lipsync = createLipsync();
  const track = buildTrack('the patient is short of breath');
  lipsync.start(track, 0, 1);

  let worst = 0;
  for (let t = 0; t <= 3000; t += STEP_MS) {
    const pose = {};
    lipsync.update(t, pose);
    const visemeTotal = Object.entries(pose)
      .filter(([name]) => name.startsWith('viseme_'))
      .reduce((sum, [, value]) => sum + value, 0);
    worst = Math.max(worst, visemeTotal);
  }

  assert.ok(worst < 1.8, `overlapping viseme weight reached ${worst.toFixed(2)}`);
});

test('boundary events re-anchor the schedule', () => {
  const lipsync = createLipsync();
  const text = 'one two three';
  const track = buildTrack(text);
  lipsync.start(track, 0, 1);

  // Claim "three" starts far later than the estimate predicted.
  const third = track.words[2];
  const estimated = third.startMs;
  lipsync.boundary(third.start, 2000);

  assert.equal(third.startMs, 2000);
  assert.ok(estimated < 2000, 'the estimate should have been earlier than the truth');
  assert.equal(lipsync.inspect().source, 'boundary-corrected');
});

test('unobserved words after a correction shift with it', () => {
  const lipsync = createLipsync();
  const track = buildTrack('one two three four');
  lipsync.start(track, 0, 1);

  const before = track.words[3].startMs;
  lipsync.boundary(track.words[1].start, 1500);

  assert.ok(track.words[3].startMs > before, 'later words should be pushed back too');
});
