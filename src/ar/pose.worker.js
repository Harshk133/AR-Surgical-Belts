// Pose inference off the main thread, so rendering and UI keep running at display rate.
// Protocol:
//   in  {type:'init', base, variant, segmentation}         out {type:'ready', delegate, variant} | {type:'error'}
//   in  {type:'frame', bitmap, ts}                          out {type:'result', pose, mask, ts, ms, delegate, variant}
//   in  {type:'segmentation', on}
// Self-healing: if the GPU delegate returns empty segmentation masks (seen on some ANGLE/D3D
// setups) it re-creates the landmarker on CPU; if the 'full' model is too slow it drops to 'lite'.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// tasks-vision loads its wasm glue with import() in module workers; ES modules execute only once,
// so a second landmarker (CPU fallback / model downgrade) would find no ModuleFactory. The library
// prefers self.import when present, so give it a cache-busted variant.
let loadCount = 0;
self.import = (url) => import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}instance=${loadCount++}`);

const MASK_MAX_W = 320;
const SLOW_MS = 75;

let fileset;
let landmarker;
let cfg;
let delegate;
let emptyMaskStreak = 0;
let times = [];
let lastTs = 0;
let lastUser = null; // shoulder midpoint of the person we are following

/**
 * Choose which detected person is the user: keep following the same person (nearest to their last
 * position); otherwise take the one closest to the camera (widest shoulders in the image).
 */
function pickUser(people) {
  if (!people.length) return -1;
  const info = people.map((lm) => ({
    mx: (lm[11].x + lm[12].x) / 2,
    my: (lm[11].y + lm[12].y) / 2,
    span: Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y),
  }));
  let best = -1;
  if (lastUser) {
    let bd = 0.12;
    info.forEach((p, i) => {
      const d = Math.hypot(p.mx - lastUser.mx, p.my - lastUser.my);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
  }
  if (best < 0) best = info.reduce((b, p, i) => (p.span > info[b].span ? i : b), 0);
  lastUser = info[best];
  return best;
}

async function create(variant, wantDelegate) {
  landmarker?.close();
  landmarker = null;
  const order = wantDelegate ? [wantDelegate] : ['GPU', 'CPU'];
  let lastErr;
  for (const d of order) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: new URL(`${cfg.base}models/pose_landmarker_${variant}.task`, self.location.origin).href, delegate: d },
        runningMode: 'VIDEO',
        numPoses: 2, // so we can follow the nearest person and use only *their* mask
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: cfg.segmentation,
      });
      delegate = d;
      cfg.variant = variant;
      times = [];
      emptyMaskStreak = 0;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function copyMask(m) {
  const sw = m.width;
  const sh = m.height;
  const step = Math.max(1, Math.ceil(sw / (cfg.maskMaxW || MASK_MAX_W)));
  const w = Math.floor(sw / step);
  const h = Math.floor(sh / step);
  const src = m.getAsFloat32Array();
  const dst = new Uint8Array(w * h);
  let max = 0;
  for (let y = 0; y < h; y++) {
    const row = y * step * sw;
    for (let x = 0; x < w; x++) {
      const v = (src[row + x * step] * 255) | 0;
      dst[y * w + x] = v;
      if (v > max) max = v;
    }
  }
  return { data: dst, width: w, height: h, max };
}

async function onFrame({ bitmap, ts }) {
  if (!landmarker) {
    bitmap.close();
    return;
  }
  const t0 = performance.now();
  let pose = null;
  let mask = null;
  const t = Math.max(Math.round(ts), lastTs + 1);
  lastTs = t;
  try {
    landmarker.detectForVideo(bitmap, t, (res) => {
      const i = pickUser(res.landmarks || []);
      if (i >= 0) {
        // plain objects survive structured cloning; drop extra fields
        pose = {
          landmarks: res.landmarks[i].map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
          world: res.worldLandmarks[i].map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
        };
      }
      // per-person mask: other people in the room never merge into the user's outline
      const m = i >= 0 ? res.segmentationMasks?.[i] : null;
      if (m && cfg.segmentation) mask = copyMask(m);
    });
  } finally {
    bitmap.close();
  }
  const ms = performance.now() - t0;
  self.postMessage({ type: 'result', pose, mask, ts, ms, delegate, variant: cfg.variant }, mask ? [mask.data.buffer] : []);

  // ---- self-healing ------------------------------------------------------------------------
  if (cfg.segmentation && delegate === 'GPU' && pose) {
    emptyMaskStreak = mask && mask.max === 0 ? emptyMaskStreak + 1 : 0;
    if (emptyMaskStreak >= 5) {
      self.postMessage({ type: 'notice', message: 'GPU segmentation masks are empty on this device; switching to CPU (lite model).' });
      await create('lite', 'CPU');
      self.postMessage({ type: 'ready', delegate, variant: cfg.variant });
      return;
    }
  }
  times.push(ms);
  if (cfg.variant === 'full' && cfg.autoDowngrade && times.length === 30) {
    const med = [...times].sort((a, b) => a - b)[15];
    if (med > SLOW_MS) {
      self.postMessage({ type: 'notice', message: `Full model median ${med.toFixed(0)} ms; switching to lite.` });
      await create('lite', delegate);
      self.postMessage({ type: 'ready', delegate, variant: cfg.variant });
    }
  }
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  // serialize everything so frames never run during re-creation
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') {
        cfg = { base: msg.base, segmentation: msg.segmentation, autoDowngrade: msg.autoDowngrade !== false, maskMaxW: msg.maskMaxW };
        // absolute URL: keeps Vite's dev server from rewriting the loader's dynamic import()
        fileset = await FilesetResolver.forVisionTasks(new URL(`${msg.base}mediapipe/wasm`, self.location.origin).href, true);
        await create(msg.variant);
        self.postMessage({ type: 'ready', delegate, variant: cfg.variant });
      } else if (msg.type === 'frame') {
        await onFrame(msg);
      } else if (msg.type === 'segmentation') {
        cfg.segmentation = msg.on;
        await landmarker?.setOptions({ outputSegmentationMasks: msg.on });
        emptyMaskStreak = 0;
      }
    } catch (err) {
      if (msg.bitmap) msg.bitmap.close?.();
      self.postMessage({ type: msg.type === 'init' ? 'error' : 'frameError', message: String(err?.message || err) });
    }
  });
};
