/**
 * The ARKit viseme adapter is what lets a model with no `viseme_*` shapes —
 * MetaPerson, Character Creator, anything rigged for iPhone face capture —
 * drive the same lip-sync as a Ready Player Me avatar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARKIT_VISEMES,
  CONFLICTING_SHAPES,
  createVisemeAdapter,
} from '../src/speech/arkitVisemes.js';
import { VISEMES, SALIENCE } from '../src/speech/visemes.js';

/** The 51 shapes the MetaPerson export actually carries — ARKit minus tongueOut. */
const METAPERSON = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft',
  'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft',
  'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight',
];

const fakeAvatar = (names) => ({
  morphNames: names,
  has: (name) => names.includes(name),
});

test('a model with native visemes is left alone', () => {
  const adapter = createVisemeAdapter(fakeAvatar([...VISEMES, 'jawOpen']));
  assert.equal(adapter.native, true);

  const pose = { viseme_aa: 0.8, jawOpen: 0.3 };
  assert.equal(adapter.translate(pose), pose, 'should be the very same object');
});

test('a MetaPerson rig gets its visemes synthesised', () => {
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  assert.equal(adapter.native, false);

  const out = adapter.translate({ viseme_aa: 1 });
  assert.ok(out.jawOpen > 0.5, 'an open vowel should drop the jaw');
  assert.equal(out.viseme_aa, undefined, 'the viseme key must not survive translation');
});

test('every viseme maps onto shapes the MetaPerson rig actually has', () => {
  // A viseme silently mapping to nothing would freeze the mouth on that sound.
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  for (const viseme of VISEMES) {
    if (viseme === 'viseme_sil') continue;
    const out = adapter.translate({ [viseme]: 1 });
    assert.ok(Object.keys(out).length > 0, `${viseme} maps to nothing`);
  }
});

test('salience is not applied twice', () => {
  // Regression. The pose table already encodes how visible each sound is, and
  // visemes.js has scaled by salience before we see it. Applying both flattened
  // every consonant to under 0.1 — a face that flapped on vowels and
  // articulated nothing in between.
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));

  for (const viseme of VISEMES) {
    const authored = ARKIT_VISEMES[viseme];
    if (!Object.keys(authored ?? {}).length) continue;

    // What lipsync emits when the spring is fully arrived: the salience value.
    const out = adapter.translate({ [viseme]: SALIENCE[viseme] });

    for (const [shape, weight] of Object.entries(authored)) {
      assert.ok(
        Math.abs(out[shape] - weight) < 1e-9,
        `${viseme}.${shape}: got ${out[shape].toFixed(3)}, authored ${weight}`,
      );
    }
  }
});

test('quiet consonants still register visibly', () => {
  // The specific symptom of the double-attenuation bug, which pushed these to
  // 0.06-0.08. The floor is set well below the authored values so that tuning
  // amplitude down stays possible; it is only here to catch collapse.
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  for (const viseme of ['viseme_kk', 'viseme_DD', 'viseme_nn', 'viseme_SS']) {
    const out = adapter.translate({ [viseme]: SALIENCE[viseme] });
    const peak = Math.max(...Object.values(out));
    assert.ok(peak > 0.12, `${viseme} peaks at only ${peak.toFixed(3)}`);
  }
});

test('no pose pulls the same lip in two directions', () => {
  // Regression. viseme_TH fired mouthShrugLower (lower lip up and out) at the
  // same time as mouthLowerDown* (lower lip down). On word-final "th" — as in
  // "breath" — the lower lip rode up over the upper one.
  for (const [viseme, pose] of Object.entries(ARKIT_VISEMES)) {
    for (const [a, b] of CONFLICTING_SHAPES) {
      assert.ok(
        !(pose[a] && pose[b]),
        `${viseme} drives both ${a} and ${b}, which fight each other`,
      );
    }
  }
});

test('no single shape is driven to an extreme', () => {
  // Blendshapes are sculpted for their maximum to be an exaggeration. Anything
  // near 1.0 in normal speech is going to look like mugging.
  for (const [viseme, pose] of Object.entries(ARKIT_VISEMES)) {
    for (const [shape, weight] of Object.entries(pose)) {
      assert.ok(weight <= 0.6, `${viseme}.${shape} is ${weight}, too strong for speech`);
    }
  }
});

test('bilabials close the mouth rather than opening it', () => {
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const out = adapter.translate({ viseme_PP: 1 });
  assert.ok(out.mouthClose >= 0.35, `mouthClose only ${out.mouthClose}`);
  assert.ok(out.mouthPressLeft > 0, 'the lips should press, not just close');
  assert.ok(!out.jawOpen, 'a closed lip shape must not also drop the jaw');
});

test('rounded vowels pucker and funnel', () => {
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const u = adapter.translate({ viseme_U: 1 });
  const i = adapter.translate({ viseme_I: 1 });

  assert.ok(u.mouthPucker > 0.5);
  assert.ok(i.mouthSmileLeft > (i.mouthPucker ?? 0), 'a close front vowel spreads, not rounds');
});

test('the viseme weight scales the whole pose', () => {
  // The spring and salience work upstream has to survive translation intact.
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const full = adapter.translate({ viseme_O: 1 });
  const half = adapter.translate({ viseme_O: 0.5 });

  for (const [shape, value] of Object.entries(full)) {
    assert.ok(Math.abs(half[shape] - value * 0.5) < 1e-9, `${shape} did not scale linearly`);
  }
});

test('non-viseme channels pass straight through', () => {
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const out = adapter.translate({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 });
  assert.equal(out.eyeBlinkLeft, 0.9);
  assert.equal(out.eyeBlinkRight, 0.9);
});

test('jawOpen takes the strongest contributor, not the sum', () => {
  // viseme_aa contributes jawOpen, and lipsync writes its own. Summing would
  // push the blendshape past 1 and distort the face.
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const out = adapter.translate({ viseme_aa: 1, jawOpen: 0.4 });
  assert.equal(out.jawOpen, ARKIT_VISEMES.viseme_aa.jawOpen);
  assert.ok(out.jawOpen <= 1);
});

test('a rig missing some shapes degrades instead of breaking', () => {
  const sparse = createVisemeAdapter(fakeAvatar(['jawOpen', 'mouthClose', 'eyeBlinkLeft']));
  const out = sparse.translate({ viseme_O: 1 });
  assert.equal(out.jawOpen, ARKIT_VISEMES.viseme_O.jawOpen);
  assert.equal(out.mouthFunnel, undefined, 'a shape the rig lacks is simply skipped');
});
