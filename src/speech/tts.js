/**
 * Thin driver over the Web Speech API's synthesis half.
 *
 * Three platform quirks are handled here rather than leaking upward:
 *
 *  - `getVoices()` is empty on first call in Chrome until `voiceschanged` fires.
 *  - Chrome silently truncates utterances after roughly 15 seconds unless
 *    `resume()` is poked periodically. Long-standing bug, still present.
 *  - `cancel()` immediately followed by `speak()` can drop the new utterance,
 *    so we let the event loop turn over in between.
 *
 * What is *not* handled, because it cannot be: there is no way to obtain the
 * synthesised audio. `speechSynthesis` writes straight to the output device and
 * exposes no MediaStream, so Web Audio analysis of the voice is impossible.
 */

const KEEPALIVE_MS = 8000;

export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function createTTS() {
  let current = null;
  let keepalive = null;

  /** Resolve once the browser has actually populated its voice list. */
  function ready() {
    return new Promise((resolve) => {
      if (!isSupported()) return resolve([]);

      const voices = speechSynthesis.getVoices();
      if (voices.length) return resolve(voices);

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(speechSynthesis.getVoices());
      };

      speechSynthesis.addEventListener('voiceschanged', done);
      // Safari never fires the event when the list is already warm.
      setTimeout(done, 1500);
    });
  }

  function stopKeepalive() {
    if (keepalive === null) return;
    clearInterval(keepalive);
    keepalive = null;
  }

  function cancel() {
    stopKeepalive();
    current = null;
    if (isSupported()) speechSynthesis.cancel();
  }

  /**
   * @param {string} text
   * @param {{voice?: SpeechSynthesisVoice, rate?: number, pitch?: number}} options
   * @param {{onStart?: Function, onBoundary?: Function, onEnd?: Function, onError?: Function}} handlers
   */
  function speak(text, options = {}, handlers = {}) {
    if (!isSupported()) {
      handlers.onError?.(new Error('This browser has no speechSynthesis support.'));
      return;
    }

    speechSynthesis.cancel();
    stopKeepalive();

    // Give the cancel a tick to land before queueing the replacement.
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      if (options.voice) utterance.voice = options.voice;
      utterance.rate = options.rate ?? 1;
      utterance.pitch = options.pitch ?? 1;
      utterance.lang = options.voice?.lang ?? 'en-US';
      current = utterance;

      utterance.onstart = () => {
        keepalive = setInterval(() => {
          // Poking resume() is what stops Chrome cutting off long sentences.
          if (speechSynthesis.speaking) speechSynthesis.resume();
          else stopKeepalive();
        }, KEEPALIVE_MS);
        handlers.onStart?.(performance.now());
      };

      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return;
        // We pass our own clock reading: browsers disagree on whether
        // event.elapsedTime is in seconds or milliseconds.
        handlers.onBoundary?.(event.charIndex, performance.now());
      };

      utterance.onend = () => {
        stopKeepalive();
        current = null;
        handlers.onEnd?.(performance.now());
      };

      utterance.onerror = (event) => {
        stopKeepalive();
        current = null;
        // Cancelling on purpose surfaces as an error; that is not a failure.
        if (event.error === 'canceled' || event.error === 'interrupted') {
          handlers.onEnd?.(performance.now());
          return;
        }
        handlers.onError?.(new Error(`Speech synthesis failed: ${event.error}`));
      };

      speechSynthesis.speak(utterance);
    }, 30);
  }

  return {
    ready,
    speak,
    cancel,
    get speaking() {
      return Boolean(current) || (isSupported() && speechSynthesis.speaking);
    },
  };
}

/**
 * Rank voices so the ones worth demoing float to the top: English first,
 * on-device before cloud-backed, then alphabetical.
 */
export function sortVoices(voices) {
  return [...voices].sort((a, b) => {
    const english = (v) => (v.lang?.toLowerCase().startsWith('en') ? 0 : 1);
    if (english(a) !== english(b)) return english(a) - english(b);
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
