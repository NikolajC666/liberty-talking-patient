/**
 * Orchestrates one utterance: text in, synthesised speech out, viseme track
 * scheduled against it.
 *
 * This is the seam the plan called for. Everything upstream talks to
 * `speech.say(text)`; swapping Web Speech for a cloud voice with real phoneme
 * timings means replacing `tts.js` and the `boundary` calls below, and nothing
 * else in the app needs to know.
 */

import { buildTrack } from './visemes.js';
import { createTTS, isSupported, sortVoices } from './tts.js';

export { isSupported };

export function createSpeech({ lipsync, onState, onError } = {}) {
  const tts = createTTS();
  let voices = [];
  let speaking = false;

  function setSpeaking(value) {
    if (speaking === value) return;
    speaking = value;
    onState?.(value);
  }

  return {
    /** Populate the voice list. Resolves to the sorted voices. */
    async init() {
      voices = sortVoices(await tts.ready());
      return voices;
    },

    get voices() {
      return voices;
    },

    get speaking() {
      return speaking;
    },

    /**
     * Say something.
     * @param {string} text
     * @param {{voice?: SpeechSynthesisVoice, rate?: number, pitch?: number}} options
     */
    say(text, options = {}) {
      const trimmed = text.trim();
      if (!trimmed) return;

      const track = buildTrack(trimmed);
      const rate = options.rate ?? 1;

      tts.speak(trimmed, options, {
        onStart: (now) => {
          lipsync.start(track, now, rate);
          setSpeaking(true);
        },
        onBoundary: (charIndex, now) => lipsync.boundary(charIndex, now),
        onEnd: (now) => {
          lipsync.end(now);
          setSpeaking(false);
        },
        onError: (error) => {
          lipsync.clear();
          setSpeaking(false);
          onError?.(error);
        },
      });
    },

    stop() {
      tts.cancel();
      lipsync.clear();
      setSpeaking(false);
    },
  };
}
