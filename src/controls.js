/**
 * Drag to turn the patient.
 *
 * The model rotates rather than the camera. Under fixed studio lights that
 * gives a turntable look — the key light rakes across the face as it turns,
 * which is exactly what you want when inspecting a mouth. Orbiting the camera
 * instead would carry the lighting around with it and the face would stay
 * flatly lit from every angle.
 *
 * Rotation happens about a pivot placed at the head, not at the model's origin
 * between its feet, or the head would swing out of a close frame.
 *
 * The mapping is direct manipulation: whichever way you drag, the face follows
 * your cursor. Both axes are clamped, then eased, so releasing mid-drag settles
 * rather than stopping dead.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Degrees of travel per pixel dragged. ~130 px covers the full range. */
const SENSITIVITY = 0.15;

/** How quickly the eased rotation catches up with the target, per second. */
const EASING = 14;

/**
 * @param {HTMLElement} element surface to listen on
 * @param {THREE.Object3D} pivot object to rotate, positioned at the head
 * @param {{ limitDeg?: number }} options
 */
export function createRotationControls(element, pivot, { limitDeg = 20 } = {}) {
  const limit = limitDeg * DEG;

  let targetYaw = 0;
  let targetPitch = 0;
  let yaw = 0;
  let pitch = 0;

  let pointerId = null;
  let lastX = 0;
  let lastY = 0;

  const clamp = (value) => Math.max(-limit, Math.min(limit, value));

  function onPointerDown(event) {
    if (pointerId !== null || event.button !== 0) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    element.setPointerCapture(pointerId);
    element.classList.add('grabbing');
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId) return;

    // Drag right and the face turns right; drag down and it tips down. Both
    // are the object's own surface following the cursor.
    targetYaw = clamp(targetYaw + (event.clientX - lastX) * SENSITIVITY * DEG);
    targetPitch = clamp(targetPitch + (event.clientY - lastY) * SENSITIVITY * DEG);

    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onPointerUp(event) {
    if (event.pointerId !== pointerId) return;
    element.releasePointerCapture(pointerId);
    element.classList.remove('grabbing');
    pointerId = null;
  }

  function recentre() {
    targetYaw = 0;
    targetPitch = 0;
  }

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('dblclick', recentre);

  return {
    recentre,

    /** @param {number} dt seconds since last frame */
    update(dt) {
      const k = 1 - Math.exp(-EASING * dt);
      yaw += (targetYaw - yaw) * k;
      pitch += (targetPitch - pitch) * k;
      pivot.rotation.set(pitch, yaw, 0);
    },

    get angles() {
      return { yaw: yaw / DEG, pitch: pitch / DEG };
    },
  };
}

/**
 * Re-parent an avatar under a pivot at its head, so rotation happens about the
 * head rather than the feet. Returns the pivot, ready to add to the scene.
 */
export function createHeadPivot(avatar) {
  const anchor = avatar.headAnchor(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.position.copy(anchor);
  avatar.root.position.sub(anchor);
  pivot.add(avatar.root);
  return { pivot, anchor };
}
