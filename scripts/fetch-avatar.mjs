/**
 * One-time avatar download.
 *
 *   npm run fetch-avatar avatarsdk                              (a preset)
 *   npm run fetch-avatar https://models.readyplayer.me/<id>.glb
 *   npm run fetch-avatar <id>
 *
 * Two routes in:
 *
 * 1. A preset — a ready-rigged sample avatar from the MIT-licensed
 *    met4citizen/TalkingHead repository. All of them carry the fifteen Oculus
 *    visemes plus ARKit shapes on a mixamo-named rig, which is what this app
 *    expects. Useful because Ready Player Me's domain is DNS-blocked on some
 *    corporate networks, Laerdal's among them.
 *
 * 2. A Ready Player Me URL or avatar id. Create one at https://readyplayer.me
 *    (no account needed for the demo creator) and paste the .glb link. The
 *    blendshape query parameters are added for you — without them the model
 *    arrives with no visemes at all and the mouth cannot move.
 *
 * These are sample assets, fine for a spike. Check licensing before shipping
 * anything built on them.
 *
 * This is the only network call in the project. Once the file is on disk the
 * app runs entirely offline.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = resolve(ROOT, 'public/avatars/patient.glb');

/** ARKit gives us expressions and eyelids; Oculus Visemes gives us the mouth. */
const REQUIRED_PARAMS = {
  morphTargets: 'ARKit,Oculus Visemes',
  textureAtlas: '1024',
  lod: '0',
};

const TALKING_HEAD = 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/';

/** Verified to carry 15 Oculus visemes, jawOpen, eyeBlinkLeft and a mixamo rig. */
const PRESETS = {
  avatarsdk: { file: 'avatarsdk.glb', note: 'Avatar SDK — photogrammetric, most realistic' },
  avaturn: { file: 'avaturn.glb', note: 'Avaturn — realistic, separate tongue mesh' },
  brunette: { file: 'brunette.glb', note: 'Ready Player Me — stylised, smallest download' },
  mpfb: { file: 'mpfb.glb', note: 'MakeHuman — 14 visemes only, 37 MB' },
};

function usage(message) {
  console.error(`\n  ${message}\n`);
  console.error('  Usage: npm run fetch-avatar <preset | readyplayer.me url | avatar id>\n');
  console.error('  Presets:');
  for (const [name, { note }] of Object.entries(PRESETS)) {
    console.error(`    ${name.padEnd(11)} ${note}`);
  }
  console.error('\n  Or create your own at https://readyplayer.me and paste the .glb link.\n');
  process.exit(1);
}

function normalise(input) {
  const preset = PRESETS[input.toLowerCase()];
  if (preset) return new URL(TALKING_HEAD + preset.file);

  // A bare avatar id, as shown in the Ready Player Me URL bar.
  if (/^[a-f0-9]{16,32}$/i.test(input)) {
    return withParams(new URL(`https://models.readyplayer.me/${input}.glb`));
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    usage(`Not a URL or avatar id: ${input}`);
  }

  // Viewer links (readyplayer.me/avatar?id=...) rather than model links.
  const id = url.searchParams.get('id');
  if (id && !url.pathname.endsWith('.glb')) {
    return withParams(new URL(`https://models.readyplayer.me/${id}.glb`));
  }

  if (!url.pathname.endsWith('.glb')) {
    usage(`That URL does not point at a .glb file: ${input}`);
  }

  return withParams(url);
}

function withParams(url) {
  for (const [key, value] of Object.entries(REQUIRED_PARAMS)) {
    url.searchParams.set(key, value);
  }
  return url;
}

const input = process.argv[2];
if (!input) usage('No avatar URL given.');

const url = normalise(input);
console.log(`Fetching ${url.href}`);

const response = await fetch(url);
if (!response.ok) {
  usage(`Download failed: ${response.status} ${response.statusText}`);
}

const bytes = Buffer.from(await response.arrayBuffer());

// A glTF binary starts with the magic string "glTF". Anything else is an error
// page that arrived with a 200.
if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
  usage('The server returned something that is not a .glb file.');
}

// Read the glTF JSON chunk and confirm the blendshapes are actually in there.
// An avatar without visemes loads perfectly happily and then sits there with a
// closed mouth, which is a confusing thing to debug.
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
const morphs = new Set((gltf.meshes ?? []).flatMap((mesh) => mesh.extras?.targetNames ?? []));
const visemes = [...morphs].filter((name) => name.startsWith('viseme_'));

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, bytes);

const { size } = await stat(DEST);
console.log(`\nSaved public/avatars/patient.glb (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  ${morphs.size} morph targets, ${visemes.length} visemes`);
console.log(`  jawOpen: ${morphs.has('jawOpen')}   eyeBlinkLeft: ${morphs.has('eyeBlinkLeft')}`);

if (visemes.length < 15) {
  console.warn(
    '\n  Warning: fewer than 15 visemes. If this came from Ready Player Me, re-fetch\n' +
      '  with ?morphTargets=ARKit,Oculus Visemes — the mouth will barely move without them.',
  );
}

console.log('\nRun `npm run dev` and it will be picked up automatically.');
