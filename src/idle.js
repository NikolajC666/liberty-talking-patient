/**
 * Idle life: blinking, breathing, head drift, eye saccades.
 *
 * This matters more than it sounds. A head that only moves when it speaks reads
 * as a mannequin between lines, and no amount of lip-sync quality rescues that
 * impression. Everything here is deliberately small — if you can consciously
 * notice any single channel, it is turned up too far.
 *
 * Blendshape output goes into the shared `pose` object; skeletal motion is
 * written directly onto bones as an offset from their authored rest rotation.
 */

const BLINK_MIN_S = 2.0;
const BLINK_MAX_S = 6.5;
const BLINK_CLOSE_S = 0.06;
const BLINK_HOLD_S = 0.02;
const BLINK_OPEN_S = 0.12;

const SACCADE_MIN_S = 1.4;
const SACCADE_MAX_S = 5.0;

const BREATH_PERIOD_S = 4.2;

function between(min, max) {
  return min + Math.random() * (max - min);
}

/** Cheap layered-sine stand-in for smooth noise. Deterministic, no allocation. */
function drift(t, a, b, c) {
  return (
    Math.sin(t / a) * 0.6 +
    Math.sin(t / b + 1.7) * 0.3 +
    Math.sin(t / c + 4.1) * 0.1
  );
}

export function createIdle(avatar) {
  const { bones, restRotations } = avatar;

  let blinkAt = between(BLINK_MIN_S, BLINK_MAX_S);
  let blinkPhase = 0; // seconds into the current blink, or -1 when not blinking
  let blinking = false;

  let saccadeAt = between(SACCADE_MIN_S, SACCADE_MAX_S);
  let gaze = { x: 0, y: 0 };
  let gazeTarget = { x: 0, y: 0 };

  let elapsed = 0;

  const state = {
    frozen: false,

    /**
     * @param {number} dt seconds since last frame
     * @param {Record<string, number>} pose shared blendshape accumulator
     */
    update(dt, pose) {
      if (state.frozen) {
        restore();
        return;
      }

      elapsed += dt;

      blink(dt, pose);
      breathe();
      look(dt);
    },
  };

  function blink(dt, pose) {
    if (!blinking) {
      blinkAt -= dt;
      if (blinkAt <= 0) {
        blinking = true;
        blinkPhase = 0;
      } else {
        return;
      }
    }

    blinkPhase += dt;
    const total = BLINK_CLOSE_S + BLINK_HOLD_S + BLINK_OPEN_S;

    let amount;
    if (blinkPhase < BLINK_CLOSE_S) {
      amount = blinkPhase / BLINK_CLOSE_S;
    } else if (blinkPhase < BLINK_CLOSE_S + BLINK_HOLD_S) {
      amount = 1;
    } else {
      amount = 1 - (blinkPhase - BLINK_CLOSE_S - BLINK_HOLD_S) / BLINK_OPEN_S;
    }

    if (blinkPhase >= total) {
      blinking = false;
      // Blinks cluster in reality; occasionally follow one straight with another.
      blinkAt = Math.random() < 0.14 ? between(0.18, 0.4) : between(BLINK_MIN_S, BLINK_MAX_S);
      amount = 0;
    }

    const value = Math.max(0, Math.min(1, amount));
    pose.eyeBlinkLeft = Math.max(pose.eyeBlinkLeft ?? 0, value);
    pose.eyeBlinkRight = Math.max(pose.eyeBlinkRight ?? 0, value);
  }

  function breathe() {
    const phase = (elapsed / BREATH_PERIOD_S) * Math.PI * 2;
    // Asymmetric: the in-breath is quicker than the out-breath.
    const breath = Math.sin(phase) * 0.5 + Math.sin(phase * 2) * 0.12;

    if (bones.spine && restRotations.spine) {
      bones.spine.rotation.x = restRotations.spine.x + breath * 0.014;
    }

    if (bones.head && restRotations.head) {
      const t = elapsed;
      bones.head.rotation.x =
        restRotations.head.x + drift(t, 7.3, 3.1, 11.7) * 0.018 - breath * 0.008;
      bones.head.rotation.y = restRotations.head.y + drift(t + 30, 9.1, 4.3, 13.3) * 0.03;
      bones.head.rotation.z = restRotations.head.z + drift(t + 60, 11.9, 5.7, 8.3) * 0.012;
    }

    if (bones.neck && restRotations.neck) {
      bones.neck.rotation.y = restRotations.neck.y + drift(elapsed + 15, 9.1, 4.3, 13.3) * 0.012;
    }
  }

  function look(dt) {
    saccadeAt -= dt;
    if (saccadeAt <= 0) {
      saccadeAt = between(SACCADE_MIN_S, SACCADE_MAX_S);
      // Mostly small readjustments, occasionally a wider glance away.
      const reach = Math.random() < 0.2 ? 0.12 : 0.045;
      gazeTarget = { x: (Math.random() - 0.5) * reach, y: (Math.random() - 0.5) * reach * 0.6 };
    }

    // Saccades are near-instant; 25 ms to arrive is about right.
    const k = Math.min(1, dt / 0.025);
    gaze.x += (gazeTarget.x - gaze.x) * k;
    gaze.y += (gazeTarget.y - gaze.y) * k;

    for (const key of ['eyeL', 'eyeR']) {
      const bone = bones[key];
      const rest = restRotations[key];
      if (!bone || !rest) continue;
      bone.rotation.x = rest.x + gaze.y;
      bone.rotation.y = rest.y + gaze.x;
    }
  }

  /** Snap every driven bone back to its authored rotation. */
  function restore() {
    for (const [key, rest] of Object.entries(restRotations)) {
      const bone = bones[key];
      if (bone) bone.rotation.copy(rest);
    }
  }

  return state;
}
