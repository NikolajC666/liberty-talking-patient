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
  viseme_PP: { mouthClose: 0.55, mouthPressLeft: 0.5, mouthPressRight: 0.5 },

  // Labiodental: lower lip tucks under the upper teeth.
  viseme_FF: { mouthRollLower: 0.6, mouthUpperUpLeft: 0.24, mouthUpperUpRight: 0.24, jawOpen: 0.08 },

  // Dental — would be tongue-between-teeth if we had a tongue.
  viseme_TH: { jawOpen: 0.24, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3, mouthShrugLower: 0.2 },

  // Alveolar stops.
  viseme_DD: { jawOpen: 0.18, mouthShrugUpper: 0.28, mouthPressLeft: 0.12, mouthPressRight: 0.12 },

  // Velar: made at the back of the tongue, so barely anything shows.
  viseme_kk: { jawOpen: 0.26 },

  // Postalveolar: rounded and protruded.
  viseme_CH: { mouthPucker: 0.45, mouthFunnel: 0.35, jawOpen: 0.16, mouthShrugUpper: 0.14 },

  // Sibilants: narrow aperture, teeth nearly together.
  viseme_SS: { mouthStretchLeft: 0.34, mouthStretchRight: 0.34, mouthSmileLeft: 0.16, mouthSmileRight: 0.16, jawOpen: 0.06 },

  viseme_nn: { jawOpen: 0.18, mouthShrugUpper: 0.24 },
  viseme_RR: { mouthPucker: 0.38, mouthFunnel: 0.18, jawOpen: 0.22 },

  // Vowels, by aperture and rounding.
  viseme_aa: { jawOpen: 0.7, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  viseme_E: { jawOpen: 0.3, mouthSmileLeft: 0.26, mouthSmileRight: 0.26, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  viseme_I: { jawOpen: 0.16, mouthSmileLeft: 0.38, mouthSmileRight: 0.38, mouthStretchLeft: 0.14, mouthStretchRight: 0.14 },
  viseme_O: { jawOpen: 0.4, mouthFunnel: 0.58, mouthPucker: 0.3 },
  viseme_U: { jawOpen: 0.12, mouthPucker: 0.68, mouthFunnel: 0.4 },
};

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
      return out;
    },
  };
}
