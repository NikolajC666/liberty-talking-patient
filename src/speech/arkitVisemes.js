/**
 * Synthesise the fifteen Oculus visemes out of ARKit blendshapes.
 *
 * Ready Player Me bakes `viseme_*` shapes into its exports, but most character
 * pipelines do not — MetaPerson, Character Creator, Daz and anything rigged for
 * iPhone face capture ship the 52 ARKit shapes instead. This module lets the
 * same lip-sync drive either, so the choice of avatar vendor stops being a
 * constraint on the speech code.
 *
 * Each viseme is a pose: a set of ARKit shapes at fixed relative weights. The
 * weight the lip-sync spring has arrived at scales the whole pose, so all the
 * salience and undershoot work upstream is preserved untouched.
 *
 * Note there is no `tongueOut` in this set — MetaPerson omits ARKit's 52nd
 * shape — so TH and the alveolars are approximated with jaw and lip movement.
 * Given how little of the tongue is visible at conversational distance, that
 * costs less than it sounds.
 */

export const ARKIT_VISEMES = {
  viseme_sil: {},

  // Bilabials: the lips must actually meet.
  viseme_PP: { mouthClose: 0.9, mouthPressLeft: 0.4, mouthPressRight: 0.4 },

  // Labiodental: lower lip tucks under the upper teeth.
  viseme_FF: { mouthRollLower: 0.6, mouthUpperUpLeft: 0.22, mouthUpperUpRight: 0.22, jawOpen: 0.06 },

  // Dental — would be tongue-between-teeth if we had a tongue.
  viseme_TH: { jawOpen: 0.2, mouthLowerDownLeft: 0.25, mouthLowerDownRight: 0.25, mouthShrugLower: 0.15 },

  // Alveolar stops.
  viseme_DD: { jawOpen: 0.16, mouthShrugUpper: 0.2, mouthPressLeft: 0.1, mouthPressRight: 0.1 },

  // Velar: made at the back of the tongue, so barely anything shows.
  viseme_kk: { jawOpen: 0.24 },

  // Postalveolar: rounded and protruded.
  viseme_CH: { mouthPucker: 0.45, mouthFunnel: 0.35, jawOpen: 0.14, mouthShrugUpper: 0.12 },

  // Sibilants: narrow aperture, teeth nearly together.
  viseme_SS: { mouthStretchLeft: 0.32, mouthStretchRight: 0.32, mouthSmileLeft: 0.14, mouthSmileRight: 0.14, jawOpen: 0.05 },

  viseme_nn: { jawOpen: 0.15, mouthShrugUpper: 0.16 },
  viseme_RR: { mouthPucker: 0.38, mouthFunnel: 0.18, jawOpen: 0.2 },

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
        for (const [shape, weight] of poses[key] ?? []) {
          out[shape] = Math.max(out[shape] ?? 0, weight * value);
        }
      }
      return out;
    },
  };
}
