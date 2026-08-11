/**
 * Text -> timed viseme track.
 *
 * Pure module: no DOM, no three.js, no timing. Given a sentence it returns the
 * *shape* of the mouth movement in relative units; `lipsync.js` stretches that
 * shape onto real clock time using boundary events from the speech synthesiser.
 *
 * We map graphemes (letters) straight to visemes rather than going through a
 * pronunciation dictionary. CMUdict is ~3 MB and would dominate the bundle, and
 * with only fifteen distinguishable mouth shapes the letter approximation is
 * mostly indistinguishable from the real thing. Where it fails is recorded in
 * FINDINGS.md — "one" and "colonel" are the honest counter-examples.
 */

/** The Oculus viseme set that Ready Player Me bakes into its avatars. */
export const VISEMES = [
  'viseme_sil',
  'viseme_PP',
  'viseme_FF',
  'viseme_TH',
  'viseme_DD',
  'viseme_kk',
  'viseme_CH',
  'viseme_SS',
  'viseme_nn',
  'viseme_RR',
  'viseme_aa',
  'viseme_E',
  'viseme_I',
  'viseme_O',
  'viseme_U',
];

/**
 * How far the jaw drops for each shape, 0..1. The viseme blendshape alone moves
 * the lips but barely opens the mouth, so we drive `jawOpen` alongside it.
 */
export const OPENNESS = {
  viseme_sil: 0.0,
  viseme_PP: 0.0,
  viseme_FF: 0.1,
  viseme_TH: 0.22,
  viseme_DD: 0.25,
  viseme_kk: 0.3,
  viseme_CH: 0.25,
  viseme_SS: 0.14,
  viseme_nn: 0.2,
  viseme_RR: 0.3,
  viseme_aa: 1.0,
  viseme_E: 0.5,
  viseme_I: 0.34,
  viseme_O: 0.6,
  viseme_U: 0.28,
};

/**
 * Relative duration of each shape. Vowels are the metrical backbone; plosives
 * are over almost as soon as they start.
 */
const UNITS = {
  viseme_sil: 0.8,
  viseme_PP: 0.45,
  viseme_FF: 0.6,
  viseme_TH: 0.6,
  viseme_DD: 0.45,
  viseme_kk: 0.5,
  viseme_CH: 0.7,
  viseme_SS: 0.7,
  viseme_nn: 0.55,
  viseme_RR: 0.6,
  viseme_aa: 1.0,
  viseme_E: 1.0,
  viseme_I: 1.0,
  viseme_O: 1.0,
  viseme_U: 1.0,
};

const VOWEL_LETTERS = 'aeiouy';

/**
 * Multi-letter spellings, longest first. Order matters: 'ng' has to be tested
 * before 'n', 'tch' before 'ch'.
 */
const CLUSTERS = [
  ['tch', ['viseme_CH']],
  ['dge', ['viseme_CH']],
  ['igh', ['viseme_I']],
  ['ough', ['viseme_O']],
  ['tion', ['viseme_CH', 'viseme_E', 'viseme_nn']],
  ['sion', ['viseme_CH', 'viseme_E', 'viseme_nn']],

  ['th', ['viseme_TH']],
  ['ch', ['viseme_CH']],
  ['sh', ['viseme_CH']],
  ['ph', ['viseme_FF']],
  ['wh', ['viseme_U']],
  ['ck', ['viseme_kk']],
  ['ng', ['viseme_nn', 'viseme_kk']],
  ['qu', ['viseme_kk', 'viseme_U']],
  ['gh', []], // "night", "though" — silent far more often than not
  ['kn', ['viseme_nn']],
  ['wr', ['viseme_RR']],
  ['ps', ['viseme_SS']],

  ['oo', ['viseme_U']],
  ['ou', ['viseme_aa', 'viseme_U']],
  ['ow', ['viseme_aa', 'viseme_U']],
  ['oa', ['viseme_O']],
  ['oi', ['viseme_O', 'viseme_I']],
  ['oy', ['viseme_O', 'viseme_I']],
  ['ee', ['viseme_E']],
  ['ea', ['viseme_E']],
  ['ei', ['viseme_E']],
  ['ie', ['viseme_I']],
  ['ai', ['viseme_E']],
  ['ay', ['viseme_E']],
  ['au', ['viseme_aa']],
  ['aw', ['viseme_aa']],
  ['ew', ['viseme_U']],
  ['ue', ['viseme_U']],
  ['ui', ['viseme_U']],
];

const SINGLES = {
  a: 'viseme_aa',
  e: 'viseme_E',
  i: 'viseme_I',
  o: 'viseme_O',
  u: 'viseme_U',
  b: 'viseme_PP',
  p: 'viseme_PP',
  m: 'viseme_PP',
  f: 'viseme_FF',
  v: 'viseme_FF',
  t: 'viseme_DD',
  d: 'viseme_DD',
  k: 'viseme_kk',
  g: 'viseme_kk',
  q: 'viseme_kk',
  j: 'viseme_CH',
  s: 'viseme_SS',
  z: 'viseme_SS',
  n: 'viseme_nn',
  l: 'viseme_nn',
  r: 'viseme_RR',
  w: 'viseme_U',
  y: 'viseme_I',
  c: 'viseme_kk', // softened to SS before e/i/y below
  h: null, // no distinct mouth shape of its own
};

const DIGITS = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
};

/** Expand digits so "5 mg" reads as "five mg" for the mouth as well as the ear. */
function expandDigits(word) {
  return word.replace(/\d/g, (d) => DIGITS[d] ?? '');
}

/**
 * Words where the trailing 'e' is silent but does *not* lengthen the vowel —
 * the exceptions to magic-e, and common enough to be worth naming. Without
 * this, "have" comes out shaped like "have-as-in-cave".
 */
const SHORT_MAGIC_E = new Set([
  'have', 'give', 'live', 'come', 'some', 'done', 'none', 'gone', 'one',
  'love', 'above', 'glove', 'shove', 'dove', 'move', 'prove', 'lose', 'whose',
  'were', 'there', 'where', 'here', 'are', 'were',
]);

/**
 * A trailing 'e' is usually silent ("make", "breathe") — but only when the word
 * already has a vowel to carry the syllable, which keeps "the" and "be" intact.
 */
function dropsSilentE(letters) {
  if (letters.length < 3 || letters.at(-1) !== 'e') return false;
  const prev = letters.at(-2);
  if (VOWEL_LETTERS.includes(prev)) return false; // "see", "toe" — part of a cluster
  return [...letters.slice(0, -2)].some((c) => VOWEL_LETTERS.includes(c));
}

/**
 * Convert one word to a viseme sequence.
 * @param {string} word Bare word, punctuation already stripped.
 * @returns {{name: string, weight: number, units: number}[]}
 */
export function wordToVisemes(word) {
  const letters = expandDigits(word.toLowerCase()).replace(/[^a-z]/g, '');
  if (!letters) return [];

  const silentE = dropsSilentE(letters);
  const body = silentE ? letters.slice(0, -1) : letters;

  // Magic e: the dropped 'e' lengthens the last vowel, so "make" is shaped
  // "mayk" rather than "mack". Only 'a' changes viseme — i/o/u already map to
  // their long forms — but the rule is applied generally for clarity.
  const lengthenAt =
    silentE && !SHORT_MAGIC_E.has(letters)
      ? [...body].findLastIndex((c) => VOWEL_LETTERS.includes(c))
      : -1;
  const LONG = { a: 'viseme_E', e: 'viseme_E', i: 'viseme_I', o: 'viseme_O', u: 'viseme_U' };

  const out = [];

  for (let i = 0; i < body.length; ) {
    const cluster = CLUSTERS.find(([seq]) => body.startsWith(seq, i));
    if (cluster) {
      for (const name of cluster[1]) push(out, name);
      i += cluster[0].length;
      continue;
    }

    const ch = body[i];
    const next = body[i + 1];

    if (ch === 'x') {
      push(out, 'viseme_kk');
      push(out, 'viseme_SS');
    } else if (ch === 'c') {
      push(out, 'eiy'.includes(next) ? 'viseme_SS' : 'viseme_kk');
    } else if (ch === 'g') {
      push(out, 'eiy'.includes(next) ? 'viseme_CH' : 'viseme_kk');
    } else if (ch === 'y' && i > 0) {
      push(out, 'viseme_I'); // "happy" — a vowel everywhere but word-initially
    } else if (i === lengthenAt && LONG[ch]) {
      push(out, LONG[ch]);
    } else {
      const name = SINGLES[ch];
      if (name) push(out, name);
    }
    i += 1;
  }

  return out;
}

/**
 * Append a viseme, collapsing a repeat into the one already there. Doubled
 * letters ("ll", "tt") are a spelling convention, not two mouth movements.
 */
function push(out, name) {
  if (out.length && out.at(-1).name === name) return;
  out.push({ name, weight: 1, units: UNITS[name] ?? 0.6 });
}

/** How long to hold silence for a given piece of trailing punctuation. */
function pauseUnits(trailing) {
  if (/[.!?…]/.test(trailing)) return 1.8;
  if (/[,;:]/.test(trailing)) return 1.0;
  if (/[—–-]/.test(trailing)) return 1.2;
  return 0;
}

/**
 * Build the full track for an utterance.
 *
 * Word boundaries are found on the *original* string so that `word.start`
 * lines up with the `charIndex` the synthesiser reports in its boundary events.
 *
 * @param {string} text
 * @returns {{text: string, words: object[], units: number}}
 */
export function buildTrack(text) {
  const words = [];
  let total = 0;

  for (const match of text.matchAll(/\S+/g)) {
    const raw = match[0];
    const core = raw.replace(/^[^\p{L}\p{N}']+/u, '').replace(/[^\p{L}\p{N}']+$/u, '');
    const trailing = core ? raw.slice(raw.indexOf(core) + core.length) : raw;
    const visemes = wordToVisemes(core);

    const pause = pauseUnits(trailing);
    if (pause) visemes.push({ name: 'viseme_sil', weight: 1, units: pause });

    // Punctuation-only tokens still occupy time.
    if (!visemes.length) visemes.push({ name: 'viseme_sil', weight: 1, units: 0.6 });

    const units = visemes.reduce((sum, v) => sum + v.units, 0);
    total += units;

    words.push({
      index: words.length,
      text: raw,
      core,
      start: match.index,
      end: match.index + raw.length,
      visemes,
      units,
      // Filled in at runtime by lipsync.js:
      startMs: null,
      endMs: null,
      observed: false,
    });
  }

  return { text, words, units: total };
}
