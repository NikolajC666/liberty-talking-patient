/**
 * Synthesise the fifteen Oculus visemes out of ARKit blendshapes.
 *
 * Ready Player Me bakes `viseme_*` shapes into its exports, but most character
 * pipelines do not — MetaPerson, Character Creator, Daz and anything rigged for
 * iPhone face capture ship the 52 ARKit shapes instead. This module lets the
 * same lip-sync drive either, so the choice of avatar vendor stops being a
 * constraint on the speech code.
 *
 * Each viseme is a pose: a set of ARKit shapes at the amplitude that phoneme
 * reaches when fully articulated. These are absolute targets, not relative
 * ones — `viseme_kk` is `jawOpen: 0.24` because a velar barely shows, and that
 * 0.24 is the finished value rather than a fraction of something larger.
 *
 * **That is why the adapter divides visual salience back out.** `visemes.js`
 * already scaled the incoming weight by salience, which is correct for a
 * native Oculus rig where `viseme_kk` at 1.0 means a fully-formed "k" mouth.
 * Here the pose table encodes the same information, so applying both would
 * attenuate twice — and it did, flattening every consonant to under 0.1 and
 * leaving a face that flapped on vowels and articulated nothing in between.
 *
 * Note there is no `tongueOut` in this set — MetaPerson omits ARKit's 52nd
 * shape — so TH and the alveolars are approximated with jaw and lip movement.
 * Given how little of the tongue is visible at conversational distance, that
 * costs less than it sounds.
 */

import { SALIENCE } from './visemes.js';

export const ARKIT_VISEMES = {
  viseme_sil: {},

  // Bilabials: the lips must actually meet. `mouthClose` is kept moderate — it
  // rolls the lips inward, and pushed hard with the jaw already shut it reads
  // as sucking the lips in rather than pressing them together. Its real job is
  // getting the mouth shut quickly on the way out of an open vowel.
  viseme_PP: { mouthClose: 0.45, mouthPressLeft: 0.4, mouthPressRight: 0.4 },

  // Labiodental: lower lip tucks under the upper teeth.
  viseme_FF: { mouthRollLower: 0.5, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2, jawOpen: 0.08 },

  // Dental. With no tongue to put between the teeth, the honest move is to
  // suggest the gap and stop there — a slight jaw opening and the lower lip
  // easing down. Overshaping this one is worse than undershaping it.
  viseme_TH: { jawOpen: 0.2, mouthLowerDownLeft: 0.16, mouthLowerDownRight: 0.16 },

  // Alveolar stops. Tongue-tip sounds, so almost nothing shows but the jaw.
  viseme_DD: { jawOpen: 0.18, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1 },

  // Velar: made at the back of the tongue, so barely anything shows.
  viseme_kk: { jawOpen: 0.24 },

  // Postalveolar: rounded and protruded.
  viseme_CH: { mouthPucker: 0.4, mouthFunnel: 0.3, jawOpen: 0.14 },

  // Sibilants: narrow aperture, teeth nearly together.
  viseme_SS: { mouthStretchLeft: 0.28, mouthStretchRight: 0.28, mouthSmileLeft: 0.14, mouthSmileRight: 0.14, jawOpen: 0.06 },

  viseme_nn: { jawOpen: 0.16, mouthLowerDownLeft: 0.08, mouthLowerDownRight: 0.08 },
  viseme_RR: { mouthPucker: 0.32, mouthFunnel: 0.16, jawOpen: 0.2 },

  // Vowels, by aperture and rounding.
  viseme_aa: { jawOpen: 0.55, mouthStretchLeft: 0.08, mouthStretchRight: 0.08 },
  viseme_E: { jawOpen: 0.26, mouthSmileLeft: 0.22, mouthSmileRight: 0.22, mouthStretchLeft: 0.16, mouthStretchRight: 0.16 },
  viseme_I: { jawOpen: 0.14, mouthSmileLeft: 0.3, mouthSmileRight: 0.3, mouthStretchLeft: 0.12, mouthStretchRight: 0.12 },
  viseme_O: { jawOpen: 0.34, mouthFunnel: 0.48, mouthPucker: 0.26 },
  viseme_U: { jawOpen: 0.1, mouthPucker: 0.55, mouthFunnel: 0.34 },
};

/**
 * Shapes that move a lip *against* the direction the rest of a pose is moving
 * it, and so must never appear alongside their opposites.
 *
 * `mouthShrugLower` pushes the lower lip up and out — the doubtful-pout shape.
 * Combined with `mouthLowerDown*`, which pulls the same lip down, the result
 * was the lower lip riding up over the upper one on word-final "th". Held long
 * enough in "breath" to be unmistakable.
 */
/** Jaw opening at which `mouthClose` is worth applying at full authored weight. */
const JAW_SEAL_REFERENCE = 0.25;

export const CONFLICTING_SHAPES = [
  ['mouthShrugLower', 'mouthLowerDownLeft'],
  ['mouthShrugLower', 'mouthLowerDownRight'],
  ['mouthShrugUpper', 'mouthUpperUpLeft'],
  ['mouthShrugUpper', 'mouthUpperUpRight'],
  // Rounding versus spreading — a mouth cannot do both.
  ['mouthPucker', 'mouthSmileLeft'],
  ['mouthPucker', 'mouthSmileRight'],
  ['mouthPucker', 'mouthStretchLeft'],
  ['mouthPucker', 'mouthStretchRight'],
];

/**
 * Build a pose translator for a given avatar.
 *
 * Models with native `viseme_*` shapes pass through untouched — they were
 * authored by someone who saw the face, which beats a synthesised
 * approximation. Everything else gets expanded into ARKit shapes.
 *
 * @param {{ has: (name: string) => boolean, morphNames: string[] }} avatar
 * @returns {{ translate: (pose: object) => object, native: boolean }}
 */
export function createVisemeAdapter(avatar) {
  const native = avatar.has('viseme_aa') && avatar.has('viseme_PP');

  if (native) {
    return { native: true, translate: (pose) => pose };
  }

  // Drop any shape this particular model lacks, so a partial ARKit rig
  // degrades quietly instead of silently doing nothing.
  const poses = {};
  for (const [viseme, shapes] of Object.entries(ARKIT_VISEMES)) {
    const usable = Object.entries(shapes).filter(([shape]) => avatar.has(shape));
    if (usable.length) poses[viseme] = usable;
  }

  return {
    native: false,

    translate(pose) {
      const out = {};
      for (const [key, value] of Object.entries(pose)) {
        if (!key.startsWith('viseme_')) {
          // jawOpen, eyeBlink* and friends pass straight through.
          out[key] = Math.max(out[key] ?? 0, value);
          continue;
        }

        // Undo the salience scaling `visemes.js` applied, since the pose table
        // below already accounts for how visible each sound is. See the note
        // at the top of this file. What survives is the spring's undershoot,
        // which is what we want to keep.
        const scale = value / (SALIENCE[key] || 1);

        for (const [shape, weight] of poses[key] ?? []) {
          out[shape] = Math.max(out[shape] ?? 0, Math.min(1, weight * scale));
        }
      }

      // `mouthClose` seals the lips *against* an open jaw — on most rigs it is
      // sculpted as the lower lip travelling up to meet the upper. Applied with
      // the jaw already shut, the lower lip has nowhere to go but over the top
      // one. Scale it by how open the jaw actually is this frame, which is also
      // exactly when it earns its keep: catching the lips up with a jaw that is
      // still springing closed out of a vowel.
      if (out.mouthClose) {
        const scaled = out.mouthClose * Math.min(1, (out.jawOpen ?? 0) / JAW_SEAL_REFERENCE);
        if (scaled > 0.02) out.mouthClose = scaled;
        else delete out.mouthClose;
      }

      return out;
    },
  };
}
