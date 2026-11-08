// MediaPipe Hand Landmarker (+ person segmenter) in a Web Worker. Same contract as PoseTracker:
// submit() hands over a downscaled ImageBitmap with at most one frame in flight; the render loop
// picks up `latest` ({ hands, ts, ms, seq }) and `mask`.

const BASE = import.meta.env.BASE_URL;
const INPUT_WIDTH = 640;

export class HandTracker {
  constructor() {
    this.worker = null;
    this.busy = false;
    this.delegate = null;
    this.variant = 'hand';
    this.segmentation = false;
    this.latest = null;
    this.seq = 0;
    this.mask = null;
    this.onNotice = null;
  }

  init({ segmentation = true } = {}) {
    this.segmentation = segmentation;
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(new URL('./hand.worker.js', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(err);
        return;
      }
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error('Hand tracking took too long to start.')), 45000);
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(e.message || 'Tracking worker failed to load.'));
      };
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timeout);
          this.delegate = m.delegate;
          resolve(this);
        } else if (m.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(m.message));
        } else if (m.type === 'result') {
          this.busy = false;
          this.delegate = m.delegate;
          this.latest = { hands: m.hands, ts: m.ts, ms: m.ms, seq: ++this.seq };
          if (m.mask) this.mask = { data: m.mask.data, width: m.mask.width, height: m.mask.height, version: this.seq };
          else if (!m.hands.length) this.mask = null;
        } else if (m.type === 'frameError') {
          this.busy = false;
          console.warn('[HandTracker]', m.message);
        } else if (m.type === 'notice') {
          console.info('[HandTracker]', m.message);
          this.onNotice?.(m.message);
        }
      };
      worker.postMessage({ type: 'init', base: BASE, segmentation });
    });
  }

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
