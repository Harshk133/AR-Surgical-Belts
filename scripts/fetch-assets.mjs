// Copies the MediaPipe WASM runtime into /public and downloads the pose models,
// so the app serves every computer-vision asset from its own origin.
//
//   node scripts/fetch-assets.mjs            -> wasm + models
//   node scripts/fetch-assets.mjs --wasm-only (used by npm postinstall)
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe/wasm');
const modelDir = join(root, 'public/models');

const MODELS = {
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};

async function exists(p) {
  try {
    const s = await stat(p);
    return s.isDirectory() || s.size > 0;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    console.warn('[assets] @mediapipe/tasks-vision not installed yet; skipping wasm copy');
    return;
  }
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('[assets] copied MediaPipe wasm -> public/mediapipe/wasm');
}

async function fetchModels() {
  await mkdir(modelDir, { recursive: true });
  for (const [name, url] of Object.entries(MODELS)) {
    const dst = join(modelDir, name);
    if (await exists(dst)) {
      console.log(`[assets] ${name} already present`);
      continue;
    }
    console.log(`[assets] downloading ${name} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    await writeFile(dst, Buffer.from(await res.arrayBuffer()));
    console.log(`[assets] saved public/models/${name}`);
  }
}

try {
  await copyWasm();
  if (!process.argv.includes('--wasm-only')) await fetchModels();
} catch (err) {
  console.error('[assets] failed:', err.message);
  process.exitCode = process.argv.includes('--wasm-only') ? 0 : 1;
}
