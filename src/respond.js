/**
 * The seam for an AI patient.
 *
 * Right now the avatar says exactly what you type. Everything in the UI goes
 * through `getResponse`, so turning this into a conversational patient is a
 * change to this one file: call the Claude API (via a small local proxy so the
 * key never reaches the browser), give it a patient persona and the case notes,
 * and return its reply. Nothing else in the app has to change — the lip-sync
 * pipeline only ever sees a finished string.
 *
 * Kept deliberately async so that swap doesn't ripple into call sites.
 */

/**
 * @param {string} input Text the user typed.
 * @returns {Promise<string>} What the patient should say aloud.
 */
export async function getResponse(input) {
  return input;
}
