// MediaPipe Pose Landmarker running in a Web Worker (on-device inference).
// Frames are submitted as downscaled ImageBitmaps with at most one in flight; the latest result
// is picked up by the render loop. Landmarks are normalized, so downscaling doesn't change them.
import { isLikelyMobile } from './device.js';

const BASE = import.meta.env.BASE_URL;
const INPUT_WIDTH = 640;

export class PoseTracker {
  constructor() {
    this.worker = null;
    this.busy = false;
    this.delegate = null;
    this.variant = null;
    this.segmentation = false;
    this.latest = null; // { pose, ts, ms, seq }
    this.seq = 0;
    this.mask = null; // { data, width, height, version }
    this.onNotice = null;
  }

  init({ variant = isLikelyMobile() ? 'lite' : 'full', segmentation = true, maskMaxW } = {}) {
    this.segmentation = segmentation;
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('./pose.worker.js', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(err);
        return;
      }
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error('Body tracking took too long to start.')), 45000);
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(e.message || 'Tracking worker failed to load.'));
      };
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timeout);
          this.delegate = m.delegate;
          this.variant = m.variant;
          resolve(this);
        } else if (m.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(m.message));
        } else if (m.type === 'result') {
          this.busy = false;
          this.delegate = m.delegate;
          this.variant = m.variant;
          this.latest = { pose: m.pose, ts: m.ts, ms: m.ms, seq: ++this.seq };
          if (m.mask) {
            this.mask = { data: m.mask.data, width: m.mask.width, height: m.mask.height, version: this.seq };
          } else if (this.segmentation && this.mask && !m.pose) {
            this.mask.data.fill(0);
            this.mask.version = this.seq;
          }
        } else if (m.type === 'frameError') {
          this.busy = false;
          console.warn('[PoseTracker]', m.message);
        } else if (m.type === 'notice') {
          console.info('[PoseTracker]', m.message);
          this.onNotice?.(m.message);
        }
      };
      worker.postMessage({ type: 'init', base: BASE, variant, segmentation, maskMaxW });
    });
  }

  /** Submit a frame if the worker is idle. Returns true if submitted. */
  submit(source, w, h, ts) {
    if (!this.worker || this.busy) return false;
    this.busy = true;
    const scale = Math.min(1, INPUT_WIDTH / w);
    createImageBitmap(source, {
      resizeWidth: Math.round(w * scale),
      resizeHeight: Math.round(h * scale),
      resizeQuality: 'medium',
    }).then(
      (bitmap) => (this.worker ? this.worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]) : bitmap.close()),
      () => (this.busy = false),
    );
    return true;
  }

  setSegmentation(on) {
    this.segmentation = on;
    if (!on) this.mask = null;
    this.worker?.postMessage({ type: 'segmentation', on });
  }

  close() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
  }
}
