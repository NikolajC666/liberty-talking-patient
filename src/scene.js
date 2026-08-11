/**
 * Renderer, camera and lighting.
 *
 * Framing is the one thing here worth arguing about: a 28mm-equivalent field of
 * view at close range gives the barrel distortion of a webcam, which reads as
 * amateur. A narrow FOV further back compresses the face the way a portrait
 * lens does, and costs nothing.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Metres from the head. Tuned for head-and-shoulders at the FOV below. */
const CAMERA_DISTANCE = 0.72;
const CAMERA_FOV = 28;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is deprecated in current three; PCF plus a generous map
  // size and a soft-edged key light is close enough at this framing.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151c);

  // Image-based lighting does most of the work on skin; the directional lights
  // below are there for shape, not for exposure.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 30);
  camera.position.set(0, 1.6, CAMERA_DISTANCE);

  const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
  key.position.set(-0.9, 2.4, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 6;
  key.shadow.bias = -0.0012;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd8e6ff, 0.7);
  fill.position.set(1.6, 1.4, 1.2);
  scene.add(fill);

  // Rim light separates the head from the backdrop — the single cheapest thing
  // that stops a render looking flat.
  const rim = new THREE.DirectionalLight(0xbcd4ff, 1.6);
  rim.position.set(0.6, 2.0, -2.0);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0x5a6472, 0.4));

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 4),
    new THREE.MeshStandardMaterial({ color: 0x1b222c, roughness: 1 }),
  );
  backdrop.position.set(0, 1.4, -1.1);
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  function resize() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    scene,
    camera,
    renderer,
    resize,

    /** Point the camera at a world-space head position. */
    frameOn(anchor) {
      camera.position.set(anchor.x, anchor.y + 0.012, anchor.z + CAMERA_DISTANCE);
      camera.lookAt(anchor.x, anchor.y - 0.05, anchor.z);
      backdrop.position.set(anchor.x, anchor.y - 0.2, anchor.z - 1.1);
      key.target.position.copy(anchor);
      key.target.updateMatrixWorld();
      scene.add(key.target);
    },

    render() {
      renderer.render(scene, camera);
    },
  };
}
