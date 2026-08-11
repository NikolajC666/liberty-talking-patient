/**
 * Avatar loading and pose application.
 *
 * Both the real Ready Player Me glTF and the procedural stand-in expose the
 * same small interface, so nothing downstream cares which one is on screen:
 *
 *   root                 Object3D to add to the scene
 *   bones                { head, neck, spine, eyeL, eyeR } — any may be null
 *   morphNames           every blendshape found on the model
 *   has(name)            whether a blendshape exists
 *   applyPose(pose)      write this frame's blendshape values, zeroing the rest
 *   headAnchor(target)   world position to frame the camera on
 *   isPlaceholder
 *
 * `applyPose` takes an object of name -> 0..1 that the idle and lip-sync systems
 * both write into. Zeroing everything not in the pose each frame is what keeps
 * the two systems from fighting over shared targets like `jawOpen`.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Ready Player Me rigs are mixamo-named; fall back through likely spellings. */
const BONE_ALIASES = {
  head: ['Head', 'mixamorigHead'],
  neck: ['Neck', 'mixamorigNeck'],
  spine: ['Spine2', 'Spine1', 'Spine', 'mixamorigSpine2'],
  eyeL: ['LeftEye', 'mixamorigLeftEye'],
  eyeR: ['RightEye', 'mixamorigRightEye'],
};

export async function loadAvatar(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;

  /** name -> [{ mesh, index }] — a blendshape usually spans head *and* teeth. */
  const targets = new Map();
  const bones = { head: null, neck: null, spine: null, eyeL: null, eyeR: null };

  root.traverse((node) => {
    if (node.isBone || node.isObject3D) {
      for (const [key, names] of Object.entries(BONE_ALIASES)) {
        if (!bones[key] && names.includes(node.name)) bones[key] = node;
      }
    }

    if (node.isMesh || node.isSkinnedMesh) {
      // Head meshes routinely leave the camera frustum's bounding sphere when
      // the neck bone rotates, and pop out of view. Cheaper to always draw.
      node.frustumCulled = false;
      node.castShadow = true;
      node.receiveShadow = true;

      if (node.material) {
        for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
          mat.envMapIntensity = 0.85;
        }
      }

      const dict = node.morphTargetDictionary;
      if (!dict) return;
      for (const [name, index] of Object.entries(dict)) {
        if (!targets.has(name)) targets.set(name, []);
        targets.get(name).push({ mesh: node, index });
      }
    }
  });

  const entries = [...targets.entries()];
  const restRotations = captureRest(bones);

  return {
    root,
    bones,
    restRotations,
    isPlaceholder: false,
    morphNames: entries.map(([name]) => name),
    has: (name) => targets.has(name),

    applyPose(pose) {
      for (const [name, slots] of entries) {
        const value = pose[name] ?? 0;
        for (const { mesh, index } of slots) {
          mesh.morphTargetInfluences[index] = value;
        }
      }
    },

    headAnchor(target) {
      if (bones.head) return bones.head.getWorldPosition(target);
      return new THREE.Box3().setFromObject(root).getCenter(target);
    },
  };
}

/**
 * A crude but honest stand-in so the whole pipeline runs before an avatar has
 * been fetched. It has no blendshapes, so it interprets the pose semantically:
 * jaw opening, mouth width, lip rounding, eyelids.
 */
export function createPlaceholderAvatar() {
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: 0.75, metalness: 0.0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c18, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.35 });
  const gown = new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.9 });

  const root = new THREE.Group();

  const torso = new THREE.Group();
  torso.position.y = 1.35;
  root.add(torso);

  const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.24, 6, 20), gown);
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.y = -0.06;
  shoulders.scale.set(1, 1.5, 0.7);
  torso.add(shoulders);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.12, 20), skin);
  neck.position.y = 0.1;
  torso.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.2;
  torso.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 32, 24), skin);
  skull.scale.set(0.95, 1.18, 1.02);
  head.add(skull);

  const jaw = new THREE.Group();
  jaw.position.set(0, -0.045, 0);
  head.add(jaw);

  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.082, 24, 18), skin);
  chin.scale.set(1.0, 0.62, 1.0);
  chin.position.set(0, -0.045, 0.008);
  jaw.add(chin);

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), dark);
  mouth.position.set(0, -0.038, 0.096);
  mouth.scale.set(1.05, 0.16, 0.45);
  jaw.add(mouth);

  const eyes = [-1, 1].map((side) => {
    const group = new THREE.Group();
    group.position.set(side * 0.038, 0.022, 0.086);
    head.add(group);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.016, 18, 14), white);
    group.add(ball);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 14, 12), dark);
    iris.position.z = 0.011;
    group.add(iris);

    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0175, 18, 14), skin);
    lid.scale.set(1, 0.02, 1);
    lid.position.y = 0.016;
    group.add(lid);

    return { group, lid };
  });

  const bones = { head, neck: null, spine: torso, eyeL: eyes[0].group, eyeR: eyes[1].group };
  const supported = new Set([
    'jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight',
    'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U', 'viseme_PP',
  ]);

  return {
    root,
    bones,
    restRotations: captureRest(bones),
    isPlaceholder: true,
    morphNames: [...supported],
    has: (name) => supported.has(name),

    applyPose(pose) {
      const open = pose.jawOpen ?? 0;
      const wide = Math.max(pose.viseme_aa ?? 0, pose.viseme_E ?? 0, pose.viseme_I ?? 0);
      const round = Math.max(pose.viseme_O ?? 0, pose.viseme_U ?? 0);
      const shut = pose.viseme_PP ?? 0;

      jaw.rotation.x = open * 0.3;
      mouth.scale.set(
        1.05 + wide * 0.4 - round * 0.45,
        0.16 + open * 1.5 * (1 - shut),
        0.45 + round * 0.25,
      );

      eyes[0].lid.scale.y = 0.02 + (pose.eyeBlinkLeft ?? 0) * 1.0;
      eyes[1].lid.scale.y = 0.02 + (pose.eyeBlinkRight ?? 0) * 1.0;
      eyes[0].lid.position.y = 0.016 - (pose.eyeBlinkLeft ?? 0) * 0.014;
      eyes[1].lid.position.y = 0.016 - (pose.eyeBlinkRight ?? 0) * 0.014;
    },

    headAnchor(target) {
      return head.getWorldPosition(target);
    },
  };
}

/** Remember each bone's authored rotation so idle motion can be an offset. */
function captureRest(bones) {
  const rest = {};
  for (const [key, bone] of Object.entries(bones)) {
    if (bone) rest[key] = bone.rotation.clone();
  }
  return rest;
}
