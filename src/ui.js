/**
 * DOM wiring: composer, voice selection, and the instrumentation panel.
 *
 * The debug panel is not decoration — it is the deliverable of a feasibility
 * spike. The timeline strip shows scheduled viseme windows against the boundary
 * events that corrected them, which is the only way to see whether the "drift
 * cannot exceed one word" claim actually holds.
 */

import { getResponse } from './respond.js';

const $ = (id) => document.getElementById(id);

export function createUI({ speech, lipsync, idle, avatar }) {
  const els = {
    boot: $('boot'),
    bootText: $('boot-text'),
    caption: $('caption'),
    composer: $('composer'),
    input: $('input'),
    speak: $('speak'),
    stop: $('stop'),
    debug: $('debug'),
    debugToggle: $('debug-toggle'),
    debugClose: $('debug-close'),
    voice: $('voice'),
    voiceNote: $('voice-note'),
    timeline: $('timeline'),
    freezeIdle: $('freeze-idle'),
  };

  const ctx = els.timeline.getContext('2d');
  let lastTrack = null;
  let readoutAt = 0;
  const voiceOptions = { rate: 1, pitch: 1 };

  /* ---------- composer ---------- */

  els.composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    if (!text) return;

    // Everything routes through the AI seam, even while it is the identity
    // function — so wiring in a real patient later changes nothing here.
    const line = await getResponse(text);
    showCaption(line);
    speech.say(line, { voice: selectedVoice(), ...voiceOptions });
  });

  els.stop.addEventListener('click', () => {
    speech.stop();
    hideCaption();
  });

  function onSpeakingChange(speaking) {
    els.stop.disabled = !speaking;
    els.speak.disabled = false;
    if (!speaking) hideCaption();
  }

  function showCaption(text) {
    els.caption.textContent = text;
    els.caption.classList.add('visible');
  }

  function hideCaption() {
    els.caption.classList.remove('visible');
  }

  /* ---------- voices ---------- */

  function selectedVoice() {
    return speech.voices[Number(els.voice.value)] ?? undefined;
  }

  function populateVoices() {
    els.voice.innerHTML = '';
    speech.voices.forEach((voice, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${voice.name}${voice.localService ? '' : ' — cloud'}`;
      els.voice.append(option);
    });

    // Prefer an on-device English voice: no network, and the boundary events
    // are more reliable than the cloud voices'.
    const preferred = speech.voices.findIndex(
      (v) => v.localService && v.lang?.toLowerCase().startsWith('en'),
    );
    els.voice.value = String(preferred >= 0 ? preferred : 0);
    describeVoice();
  }

  function describeVoice() {
    const voice = selectedVoice();
    if (!voice) {
      els.voiceNote.textContent = 'No voices available in this browser.';
      els.voiceNote.className = 'note warn';
      return;
    }
    if (voice.localService) {
      els.voiceNote.textContent = `${voice.lang} · on-device, nothing leaves the machine.`;
      els.voiceNote.className = 'note';
    } else {
      els.voiceNote.textContent = `${voice.lang} · synthesised server-side despite needing no API key.`;
      els.voiceNote.className = 'note warn';
    }
  }

  els.voice.addEventListener('change', describeVoice);

  /* ---------- sliders ---------- */

  function slider(id, apply, format = (v) => v.toFixed(2)) {
    const input = $(id);
    const output = $(`${id}-out`);
    const handle = () => {
      const value = Number(input.value);
      output.textContent = format(value);
      apply(value);
    };
    input.addEventListener('input', handle);
    handle();
  }

  const ms = (v) => String(Math.round(v));

  slider('rate', (v) => { voiceOptions.rate = v; });
  slider('pitch', (v) => { voiceOptions.pitch = v; });
  slider('attack', (v) => { lipsync.settings.attackMs = v; }, ms);
  slider('decay', (v) => { lipsync.settings.decayMs = v; }, ms);
  slider('intensity', (v) => { lipsync.settings.intensity = v; });
  slider('jaw', (v) => { lipsync.settings.jawCoupling = v; });
  slider('offset', (v) => { lipsync.settings.offsetMs = v; }, ms);

  els.freezeIdle.addEventListener('change', () => {
    idle.frozen = els.freezeIdle.checked;
  });

  /* ---------- debug panel ---------- */

  const setDebug = (open) => {
    els.debug.hidden = !open;
    els.debugToggle.textContent = open ? 'Hide debug' : 'Debug';
  };

  els.debugToggle.addEventListener('click', () => setDebug(els.debug.hidden));
  els.debugClose.addEventListener('click', () => setDebug(false));

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'd' || event.target === els.input) return;
    setDebug(els.debug.hidden);
  });

  /* ---------- timeline ---------- */

  const WINDOW_BEFORE = 1000;
  const WINDOW_AFTER = 2000;

  function drawTimeline(now, info) {
    const { width, height } = els.timeline;
    ctx.clearRect(0, 0, width, height);

    const track = info.track ?? lastTrack;
    if (info.track) lastTrack = info.track;
    if (!track) {
      ctx.fillStyle = '#586069';
      ctx.font = '12px system-ui';
      ctx.fillText('Speak a line to see its viseme schedule.', 12, height / 2);
      return;
    }

    const t0 = now - WINDOW_BEFORE;
    const span = WINDOW_BEFORE + WINDOW_AFTER;
    const x = (t) => ((t - t0) / span) * width;

    for (const word of track.words) {
      if (word.startMs === null) continue;
      if (word.endMs < t0 || word.startMs > t0 + span) continue;

      const wordSpan = Math.max(1, word.endMs - word.startMs);
      let cursor = word.startMs;

      // Word label above its viseme blocks.
      ctx.fillStyle = '#8b949e';
      ctx.font = '11px system-ui';
      ctx.fillText(word.text, x(word.startMs) + 2, 13);

      for (const viseme of word.visemes) {
        const dur = (viseme.units / word.units) * wordSpan;
        const left = x(cursor);
        const right = x(cursor + dur);
        cursor += dur;

        const silent = viseme.name === 'viseme_sil';
        ctx.fillStyle = silent ? '#1d242e' : '#2f6fb5';
        ctx.fillRect(left, 22, Math.max(1, right - left - 1), 34);

        if (right - left > 26) {
          ctx.fillStyle = silent ? '#586069' : '#dbeafe';
          ctx.font = '10px system-ui';
          ctx.fillText(viseme.name.replace('viseme_', ''), left + 4, 42);
        }
      }

      // Amber tick wherever a real boundary event snapped the schedule.
      if (word.observed) {
        ctx.fillStyle = '#d9a441';
        ctx.fillRect(x(word.startMs) - 1, 18, 2, 46);
        ctx.beginPath();
        ctx.arc(x(word.startMs), 68, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Playhead.
    const px = x(now);
    ctx.fillStyle = '#e6edf3';
    ctx.fillRect(px, 14, 1.5, 54);

    ctx.fillStyle = '#586069';
    ctx.font = '10px system-ui';
    ctx.fillText('-1s', 2, height - 4);
    ctx.fillText('now', px + 4, height - 4);
    ctx.fillText('+2s', width - 22, height - 4);
  }

  /* ---------- readout ---------- */

  function updateReadout(info, fps) {
    $('r-boundaries').textContent = String(info.boundaryCount);
    $('r-source').textContent = info.source;
    $('r-unit').textContent = `${Math.round(info.unitMs)} ms/unit`;
    $('r-viseme').textContent = info.active ? info.active.replace('viseme_', '') : '—';
    $('r-fps').textContent = String(Math.round(fps));
  }

  return {
    onSpeakingChange,

    async ready() {
      await speech.init();
      populateVoices();
      $('r-morphs').textContent = avatar.isPlaceholder
        ? 'placeholder'
        : String(avatar.morphNames.length);
    },

    bootMessage(text, isError = false) {
      els.bootText.textContent = text;
      els.bootText.classList.toggle('error', isError);
    },

    hideBoot() {
      els.boot.classList.add('fading');
      setTimeout(() => { els.boot.hidden = true; }, 400);
    },

    /** Called every frame; heavy DOM writes are throttled internally. */
    update(now, fps) {
      if (els.debug.hidden) return;
      const info = lipsync.inspect();
      drawTimeline(now, info);
      if (now - readoutAt > 200) {
        readoutAt = now;
        updateReadout(info, fps);
      }
    },
  };
}
