/**
 * Voice ranking is name-heuristic guesswork — the Web Speech API reports
 * neither quality nor gender — so it is worth pinning down. `tts.js` only
 * touches browser globals inside functions, so it imports cleanly in Node.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sortVoices, voiceQuality, isMaleVoice } from '../src/speech/tts.js';

const voice = (name, lang = 'en-US', localService = false) => ({ name, lang, localService });

const EDGE_AND_SAPI = [
  voice('Microsoft Ana Online (Natural) - English (United States)'),
  voice('Microsoft Aria Online (Natural) - English (United States)'),
  voice('Microsoft Guy Online (Natural) - English (United States)'),
  voice('Microsoft David Desktop - English (United States)', 'en-US', true),
  voice('Microsoft Zira Desktop - English (United States)', 'en-US', true),
  voice('Microsoft Hedda - German (Germany)', 'de-DE', true),
];

test('the best-sounding English male voice ranks first', () => {
  const [first] = sortVoices(EDGE_AND_SAPI);
  assert.match(first.name, /Guy/);
});

test('quality outranks gender', () => {
  // A male SAPI voice must not beat a female neural one; the whole point of
  // the ranking is that it sounds better.
  const sorted = sortVoices([
    voice('Microsoft David Desktop', 'en-US', true),
    voice('Microsoft Aria Online (Natural)'),
  ]);
  assert.match(sorted[0].name, /Aria/);
});

test('English outranks everything', () => {
  const sorted = sortVoices([
    voice('Microsoft Conrad Online (Natural) - German', 'de-DE'),
    voice('Microsoft David Desktop', 'en-US', true),
  ]);
  assert.match(sorted[0].name, /David/);
});

test('"female" is not read as "male"', () => {
  assert.equal(isMaleVoice(voice('Google UK English Female')), false);
  assert.equal(isMaleVoice(voice('Google UK English Male')), true);
});

test('gender is matched on whole names only', () => {
  // Guard against a substring match firing on an unrelated name.
  assert.equal(isMaleVoice(voice('Microsoft Guy Online (Natural)')), true);
  assert.equal(isMaleVoice(voice('Microsoft Jenny Online (Natural)')), false);
  assert.equal(isMaleVoice(voice('Microsoft Samantha')), false, 'Sam should not match Samantha');
});

test('quality tiers run neural > online > google > sapi', () => {
  assert.ok(
    voiceQuality(voice('Microsoft Guy Online (Natural)')) >
      voiceQuality(voice('Google US English')),
  );
  assert.ok(
    voiceQuality(voice('Google US English')) >
      voiceQuality(voice('Microsoft David Desktop', 'en-US', true)),
  );
});

test('an unrecognised name keeps its place rather than erroring', () => {
  assert.equal(isMaleVoice(voice('Some Unlisted Voice')), false);
  assert.equal(isMaleVoice({ name: undefined, lang: 'en-US' }), false);
  assert.doesNotThrow(() => sortVoices([voice('Odd One'), voice('Another')]));
});
