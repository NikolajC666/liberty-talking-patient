/**
 * Boot and the render loop.
 *
 * Each frame builds a fresh `pose` — an object of blendshape name to 0..1 —
 * which the idle system and the lip-sync system both write into before the
 * avatar applies it. Neither owns the face; they compose, and anything absent
 * from the pose is explicitly zeroed. That is what stops a blink from being
 * stomped by a viseme, or `jawOpen` from being fought over.
 */

import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadAvatar, createPlaceholderAvatar } from './avatar.js';
import { createIdle } from './idle.js';
import { createLipsync } from './speech/lipsync.js';
import { createSpeech, isSupported } from './speech/index.js';
import { createUI } from './ui.js';

// Resolved against the deploy base so it works under a Pages subpath too.
const AVATAR_URL = `${import.meta.env.BASE_URL}avatars/patient.glb`;
const EXAMPLE_LINE = "Nurse, I can't catch my breath.";

const stage = createScene(document.getElementById('view'));

/** Has an avatar actually been fetched, or is the placeholder still standing in? */
async function avatarExists(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    // Vite serves index.html for unknown paths in some configurations.
    return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

async function boot() {
  const bootText = document.getElementById('boot-text');

  let avatar;
  let usingPlaceholder = false;

  if (await avatarExists(AVATAR_URL)) {
    try {
      avatar = await loadAvatar(AVATAR_URL);
    } catch (error) {
      console.error('Avatar failed to load:', error);
      usingPlaceholder = true;
    }
  } else {
    usingPlaceholder = true;
  }

  if (usingPlaceholder) {
    avatar = createPlaceholderAvatar();
    bootText.textContent =
      'No avatar found — running the placeholder head. ' +
      'Run `npm run fetch-avatar <readyplayer.me url>` for the real one.';
  }

  stage.scene.add(avatar.root);
  stage.frameOn(avatar.headAnchor(new THREE.Vector3()));

  // Everything the model actually offers, so the viseme map can be checked
  // against reality rather than assumption.
  console.info(
    `[avatar] ${usingPlaceholder ? 'placeholder' : AVATAR_URL} — ` +
      `${avatar.morphNames.length} morph targets`,
    avatar.morphNames,
  );

  const missing = ['viseme_aa', 'viseme_PP', 'jawOpen', 'eyeBlinkLeft'].filter(
    (name) => !avatar.has(name),
  );
  if (missing.length && !usingPlaceholder) {
    console.warn(
      '[avatar] expected blendshapes are absent:',
      missing,
      '— re-fetch with ?morphTargets=ARKit,Oculus Visemes',
    );
  }

  const lipsync = createLipsync();
  const idle = createIdle(avatar);

  let ui;
  const speech = createSpeech({
    lipsync,
    onState: (speaking) => ui?.onSpeakingChange(speaking),
    onError: (error) => {
      console.error(error);
      ui?.bootMessage(error.message, true);
    },
  });

  ui = createUI({ speech, lipsync, idle, avatar });
  await ui.ready();

  if (!isSupported()) {
    ui.bootMessage('This browser has no speechSynthesis support. Try Chrome or Edge.', true);
    return;
  }

  document.getElementById('input').value = EXAMPLE_LINE;
  setTimeout(() => ui.hideBoot(), usingPlaceholder ? 2600 : 200);

  let last = performance.now();
  let fps = 60;

  function frame(now) {
    requestAnimationFrame(frame);

    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.08;

    const pose = {};
    idle.update(dt, pose);
    lipsync.update(now, pose);
    avatar.applyPose(pose);

    stage.render();
    ui.update(now, fps);
  }

  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  const bootText = document.getElementById('boot-text');
  bootText.textContent = `Failed to start: ${error.message}`;
  bootText.classList.add('error');
});
