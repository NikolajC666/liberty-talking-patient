/**
 * `visemes.js` is pure text-in / track-out, so it is the one part of the
 * pipeline that can be pinned down without a browser. These tests guard the
 * rules that are easy to break while tuning: digraphs, silent 'e', doubled
 * letters, and charIndex alignment with the boundary events.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack, wordToVisemes, VISEMES, OPENNESS, SALIENCE } from '../src/speech/visemes.js';

const shapes = (word) => wordToVisemes(word).map((v) => v.name.replace('viseme_', ''));

test('maps a simple word phoneme by phoneme', () => {
  assert.deepEqual(shapes('pat'), ['PP', 'aa', 'DD']);
});

test('treats digraphs as single shapes', () => {
  assert.deepEqual(shapes('the'), ['TH', 'E']);
  assert.deepEqual(shapes('shop'), ['CH', 'O', 'PP']);
  assert.deepEqual(shapes('phone'), ['FF', 'O', 'nn']);
});

test('drops a silent trailing e only when a vowel already carries the word', () => {
  assert.deepEqual(shapes('make'), ['PP', 'E', 'kk']); // 'a' then hard 'k', final e dropped
  assert.deepEqual(shapes('be'), ['PP', 'E']); // too short to drop
  assert.ok(shapes('the').includes('E')); // no earlier vowel, so 'e' survives
});

test('collapses doubled letters into one mouth movement', () => {
  assert.deepEqual(shapes('call'), ['kk', 'aa', 'nn']);
  assert.deepEqual(shapes('miss'), ['PP', 'I', 'SS']);
});

test('softens c and g before front vowels', () => {
  assert.equal(shapes('cell')[0], 'SS');
  assert.equal(shapes('cat')[0], 'kk');
  assert.equal(shapes('gent')[0], 'CH');
  assert.equal(shapes('got')[0], 'kk');
});

test('every emitted viseme is one the avatar actually has', () => {
  const sentence = 'Nurse, I have a sharp pain in my chest and I feel sick.';
  for (const word of buildTrack(sentence).words) {
    for (const viseme of word.visemes) {
      assert.ok(VISEMES.includes(viseme.name), `unknown viseme ${viseme.name}`);
      assert.ok(viseme.name in OPENNESS, `no openness for ${viseme.name}`);
      assert.ok(viseme.name in SALIENCE, `no salience for ${viseme.name}`);
      assert.ok(viseme.units > 0);
    }
  }
});

test('word offsets line up with the original string', () => {
  // Boundary events report a charIndex into the text we handed the synthesiser,
  // so these offsets have to survive punctuation exactly.
  const text = "Nurse, I can't catch my breath.";
  const track = buildTrack(text);

  assert.deepEqual(
    track.words.map((w) => w.text),
    ['Nurse,', 'I', "can't", 'catch', 'my', 'breath.'],
  );

  for (const word of track.words) {
    assert.equal(text.slice(word.start, word.end), word.text);
  }
});

test('punctuation becomes silence', () => {
  const [comma] = buildTrack('Nurse, please').words;
  assert.equal(comma.visemes.at(-1).name, 'viseme_sil');

  const [full] = buildTrack('Stop. Please').words;
  assert.ok(full.visemes.at(-1).units > comma.visemes.at(-1).units, 'a full stop holds longer');
});

test('digits are spoken, not skipped', () => {
  assert.deepEqual(shapes('5'), shapes('five'));
});

test('a punctuation-only token still occupies time', () => {
  const track = buildTrack('well ... maybe');
  assert.equal(track.words.length, 3);
  assert.ok(track.words[1].units > 0);
});

test('track units are the sum of their parts', () => {
  const track = buildTrack('I have a sharp pain in my chest.');
  const summed = track.words.reduce((total, w) => total + w.units, 0);
  assert.ok(Math.abs(track.units - summed) < 1e-9);
});
