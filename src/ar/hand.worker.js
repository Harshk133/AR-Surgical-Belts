// Hand inference off the main thread (thumb wrist brace).
// Protocol (mirrors pose.worker.js):
//   in  {type:'init', base, segmentation}        out {type:'ready', delegate} | {type:'error'}
//   in  {type:'frame', bitmap, ts}               out {type:'result', hands, mask, ts, ms, delegate}
//   in  {type:'segmentation', on}
// hands: [{ landmarks[21], world[21], label, score }]. The person mask (selfie segmenter) is used to
// measure the wrist / forearm outline and to trim the brace to the arm silhouette.
// Self-healing: if the GPU segmenter returns empty masks while a hand is visible, it moves to CPU.
import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';

// See pose.worker.js: a second task instance needs a fresh wasm glue module.
let loadCount = 0;
self.import = (url) => import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}instance=${loadCount++}`);

const MASK_MAX_W = 480; // wrists are small in the frame: keep more mask detail than the torso does

let fileset;
let hands;
let segmenter;
let cfg;
let delegate;
let segDelegate;
let emptyMaskStreak = 0;
let lastTs = 0;

const modelUrl = (name) => new URL(`${cfg.base}models/${name}`, self.location.origin).href;

async function createHands() {
  hands?.close();
  hands = null;
  let lastErr;
  for (const d of ['GPU', 'CPU']) {
    try {
      hands = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl('hand_landmarker.task'), delegate: d },
        runningMode: 'VIDEO',
        numHands: 2, // the second hand is used as an occluder and to let the user pick a side
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      delegate = d;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function createSegmenter(only) {
  segmenter?.close();
  segmenter = null;
  let lastErr;
  for (const d of only ? [only] : ['GPU', 'CPU']) {
    try {
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl('selfie_segmenter.tflite'), delegate: d },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      segDelegate = d;
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
  const step = Math.max(1, Math.ceil(sw / MASK_MAX_W));
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

const plain = (arr) => arr.map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));

async function onFrame({ bitmap, ts }) {
  if (!hands) {
    bitmap.close();
    return;
  }
  const t0 = performance.now();
  const t = Math.max(Math.round(ts), lastTs + 1);
  lastTs = t;
  let out = [];
  let mask = null;
  try {
    const res = hands.detectForVideo(bitmap, t);
    out = (res.landmarks || []).map((lm, i) => {
      const cat = (res.handedness || res.handednesses || [])[i]?.[0];
      return {
        landmarks: plain(lm),
        world: plain(res.worldLandmarks[i]),
        label: cat?.categoryName || 'Unknown',
        score: cat?.score ?? 0,
      };
    });
    if (segmenter && cfg.segmentation && out.length) {
      segmenter.segmentForVideo(bitmap, t, (r) => {
        const masks = r.confidenceMasks || [];
        const m = masks[masks.length - 1]; // single-class model: the one mask is "person"
        if (m) mask = copyMask(m);
      });
    }
  } finally {
    bitmap.close();
  }
  const ms = performance.now() - t0;
  self.postMessage({ type: 'result', hands: out, mask, ts, ms, delegate }, mask ? [mask.data.buffer] : []);

  if (mask && segDelegate === 'GPU') {
    emptyMaskStreak = mask.max === 0 ? emptyMaskStreak + 1 : 0;
    if (emptyMaskStreak >= 5) {
      self.postMessage({ type: 'notice', message: 'GPU segmentation masks are empty on this device; switching the segmenter to CPU.' });
      await createSegmenter('CPU');
    }
  }
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === 'init') {
        cfg = { base: msg.base, segmentation: msg.segmentation };
        fileset = await FilesetResolver.forVisionTasks(new URL(`${msg.base}mediapipe/wasm`, self.location.origin).href, true);
        await createHands();
        try {
          await createSegmenter();
        } catch (err) {
          // the brace still works from landmarks alone; only outline fitting is lost
          self.postMessage({ type: 'notice', message: `Segmenter unavailable: ${err?.message || err}` });
        }
        self.postMessage({ type: 'ready', delegate });
      } else if (msg.type === 'frame') {
        await onFrame(msg);
      } else if (msg.type === 'segmentation') {
        cfg.segmentation = msg.on;
      }
    } catch (err) {
      if (msg.bitmap) msg.bitmap.close?.();
      self.postMessage({ type: msg.type === 'init' ? 'error' : 'frameError', message: String(err?.message || err) });
    }
  });
};
