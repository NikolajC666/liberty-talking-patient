/**
 * Boot and the render loop.
 *
 * Each frame builds a fresh `pose` — an object of blendshape name to 0..1 —
 * which the idle system and the lip-sync system both write into before the
 * avatar applies it. Neither owns the face; they compose, and anything absent
 * from the pose is explicitly zeroed. That is what stops a blink from being
 * stomped by a viseme, or `jawOpen` from being fought over.
 */

import { createScene } from './scene.js';
import { loadAvatar, createPlaceholderAvatar } from './avatar.js';
import { createHeadPivot, createRotationControls } from './controls.js';
import { createIdle } from './idle.js';
import { createLipsync } from './speech/lipsync.js';
import { createSpeech, isSupported } from './speech/index.js';
import { createVisemeAdapter } from './speech/arkitVisemes.js';
import { createUI } from './ui.js';

// Resolved against the deploy base so it works under a Pages subpath too.
// First match wins, so a hand-supplied model takes precedence over a preset.
const AVATAR_URLS = ['avatars/patient.fbx', 'avatars/patient.glb'].map(
  (path) => `${import.meta.env.BASE_URL}${path}`,
);
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
  let usingPlaceholder = true;

  for (const url of AVATAR_URLS) {
    if (!(await avatarExists(url))) continue;
    try {
      bootText.textContent = 'Loading avatar…';
      avatar = await loadAvatar(url);
      usingPlaceholder = false;
      console.info(`[avatar] loaded ${url}`);
      break;
    } catch (error) {
      console.error(`Avatar failed to load from ${url}:`, error);
    }
  }

  if (usingPlaceholder) {
    avatar = createPlaceholderAvatar();
    bootText.textContent =
      'No avatar found — running the placeholder head. ' +
      'Run `npm run fetch-avatar <readyplayer.me url>` for the real one.';
  }

  // Rotate about the head rather than the model's origin, which is on the
  // floor between its feet — otherwise turning swings the face out of frame.
  const { pivot, anchor } = createHeadPivot(avatar);
  stage.scene.add(pivot);
  stage.frameOn(anchor);

  const controls = createRotationControls(stage.renderer.domElement, pivot, { limitDeg: 20 });

  // Everything the model actually offers, so the viseme map can be checked
  // against reality rather than assumption.
  console.info(`[avatar] ${avatar.morphNames.length} morph targets`, avatar.morphNames);

  // Models without native visemes get them synthesised from ARKit shapes.
  const visemes = createVisemeAdapter(avatar);
  console.info(
    `[avatar] visemes: ${visemes.native ? 'native Oculus shapes' : 'synthesised from ARKit'}`,
  );

  const missing = ['jawOpen', 'eyeBlinkLeft'].filter((name) => !avatar.has(name));
  if (missing.length && !usingPlaceholder) {
    console.warn('[avatar] expected blendshapes are absent:', missing);
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
    avatar.applyPose(visemes.translate(pose));
    controls.update(dt);

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
