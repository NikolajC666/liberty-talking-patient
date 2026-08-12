/**
 * The ARKit viseme adapter is what lets a model with no `viseme_*` shapes —
 * MetaPerson, Character Creator, anything rigged for iPhone face capture —
 * drive the same lip-sync as a Ready Player Me avatar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ARKIT_VISEMES, createVisemeAdapter } from '../src/speech/arkitVisemes.js';
import { VISEMES } from '../src/speech/visemes.js';

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

test('bilabials close the mouth rather than opening it', () => {
  const adapter = createVisemeAdapter(fakeAvatar(METAPERSON));
  const out = adapter.translate({ viseme_PP: 1 });
  assert.ok(out.mouthClose > 0.5);
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
