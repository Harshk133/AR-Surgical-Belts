// Orchestrates camera -> pose -> torso transform -> renderer, outside React.
// React subscribes to a small, throttled state snapshot (useSyncExternalStore); the per-frame
// work never triggers a React render.
import { CameraController, CameraError } from './CameraController.js';
import { isLikelyMobile } from './device.js';
import { composeScreenshot } from './ScreenshotCapture.js';

// three.js + MediaPipe are pulled in only when the try-on starts.
let engine;
const loadEngine = () =>
  (engine ||= Promise.all([
    import('./ArRenderer.js'),
    import('./PoseTracker.js'),
    import('./TorsoTransform.js'),
    import('./BodyShapeFitter.js'),
  ]).then(([r, p, t, b]) => ({
    ArRenderer: r.ArRenderer,
    webglAvailable: r.webglAvailable,
    PoseTracker: p.PoseTracker,
    TorsoTransform: t.TorsoTransform,
    BodyShapeFitter: b.BodyShapeFitter,
  })));
import { BRACE_MODEL, PRODUCT } from '../model/braceConfig.js';
import { clamp } from './filters.js';

export { store, sampleLuminance };
export const DEFAULT_ADJUST = { x: 0, y: 0, z: 0, scale: 1, yawDeg: 0, rollDeg: 0, pitchDeg: 0 };
const DEFAULT_OPTIONS = { silhouette: true, fitShape: true, armOcclusion: true, showStats: false, hfov: 63, mirror: null };
const MAX_LEAD = 0.12; // s of motion prediction (capture -> display latency compensation)
const CAL_SECONDS = 1.2;
const CAL_NO_HIPS_AFTER = 5; // allow shoulder-only calibration on close-up laptop framing

const store = {
  get(key, fallback) {
    try {
      const v = sessionStorage.getItem(key);
      return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback };
    } catch {
      return { ...fallback };
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};

export class TryOnSession {
  constructor({ storeKey = 'tryon', product = PRODUCT, defaultOptions = DEFAULT_OPTIONS } = {}) {
    this.listeners = new Set();
    this.storeKey = storeKey;
    this.product = product;
    this.defaultOptions = defaultOptions;
    this.adjust = store.get(`${storeKey}.adjust`, DEFAULT_ADJUST);
    this.options = store.get(`${storeKey}.options`, defaultOptions);
    this.snapshot = {
      phase: 'idle', // idle | starting | calibrating | tracking | manual | error
      error: null,
      loading: null, // { label, progress }
      cameras: [],
      deviceId: null,
      mirrored: true,
      calibration: 0,
      calibratedNoHips: false,
      tracking: { valid: false, quality: 0, facing: 'front', yawDeg: 0, flipped: false },
      hint: null,
      stats: null,
      adjust: { ...this.adjust },
      options: { ...this.options },
      sourceSize: null,
    };
    this.raf = 0;
    this.lastEmit = 0;
    this.pendingCapture = null;
    this.onVisibility = this.onVisibility.bind(this);
    this.tick = this.tick.bind(this);
  }

  // ---- external store ---------------------------------------------------------------------
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  set(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ---- DOM wiring ---------------------------------------------------------------------------
  attach({ container, stage, video, image, canvas }) {
    this.el = { container, stage, video, image, canvas };
    this.camera = new CameraController(video);
    this.camera.onEnded = () => {
      if (this.running) this.fail(new CameraError('ended', 'The camera stopped unexpectedly.'));
    };
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach() {
    this.stop();
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer?.dispose();
    this.renderer = null;
    this.tracker?.close();
    this.tracker = null;
  }

  get running() {
    return ['starting', 'calibrating', 'tracking', 'manual'].includes(this.snapshot.phase);
  }

  // ---- lifecycle ---------------------------------------------------------------------------
  /**
   * Starts the experience. testSource (dev/QA): URL of an image or video to use instead of the camera.
   */
  async start({ deviceId, testSource } = {}) {
    if (this.snapshot.phase === 'starting') return;
    this.set({ phase: 'starting', error: null, hint: null, calibration: 0 });
    try {
      this.set({ loading: { label: 'Loading try-on engine', progress: null } });
      const E = await loadEngine();
      const { webglAvailable, PoseTracker, TorsoTransform, BodyShapeFitter } = E;
      if (!webglAvailable()) throw new CameraError('webgl', 'WebGL is not available in this browser, so the 3D brace cannot be drawn.');

      // Renderer + model (lazy, once)
      if (!this.renderer) {
        this.renderer = await this.createRenderer(E, { maxDpr: isLikelyMobile() ? 1.5 : 2 });
      }
      this.renderer.setFov(this.options.hfov);

      // Source
      let info;
      if (testSource) {
        info = await this.startTestSource(testSource);
      } else {
        this.set({ loading: { label: 'Waiting for camera permission', progress: null } });
        info = await this.camera.start({ deviceId: deviceId || this.snapshot.deviceId || undefined });
        this.source = this.el.video;
        this.el.video.hidden = false;
        this.el.image.hidden = true;
      }
      const mirrored = this.options.mirror ?? info.facing !== 'environment';
      const cameras = testSource ? [] : await this.camera.listDevices();
      this.set({ deviceId: info.deviceId, cameras, mirrored, sourceSize: { w: info.width, h: info.height } });
      this.layout();

      // Tracker (lazy, once). Failure -> manual placement fallback rather than a dead end.
      let trackerOk = true;
      if (!this.tracker) {
        this.set({ loading: { label: 'Starting body tracking', progress: null } });
        try {
          this.tracker = await new PoseTracker().init({ segmentation: this.needsMask() });
        } catch (err) {
          console.error('[TryOn] tracker init failed', err);
          this.tracker = null;
          trackerOk = false;
        }
      }
      this.torso = this.torso || new TorsoTransform(BRACE_MODEL);
      this.torso.hfovDeg = this.options.hfov;
      this.torso.reset();
      this.torso.unlockCalibration();
      this.fitter = this.fitter || new BodyShapeFitter(this.renderer.fitUniforms);
      this.fitter.reset();
      this.fitter.setEnabled(false);
      this.fitStartedAt = null;
      this.calElapsed = 0;
      this.stats = { frames: 0, detections: 0, detectMs: 0, t0: performance.now() };

      this.set({
        loading: null,
        phase: trackerOk ? 'calibrating' : 'manual',
        error: trackerOk ? null : { kind: 'tracker', message: 'Body tracking could not start on this device. You can still place the brace manually.' },
      });
      this.last = performance.now();
      this.lastDetect = this.last;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    } catch (err) {
      this.fail(err);
    }
  }

  async startTestSource(url) {
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);
    this.camera.stop();
    if (isVideo) {
      const v = this.el.video;
      v.srcObject = null;
      v.src = url;
      v.loop = true;
      v.muted = true;
      await v.play();
      this.source = v;
      v.hidden = false;
      this.el.image.hidden = true;
      return { deviceId: 'test', facing: 'environment', width: v.videoWidth, height: v.videoHeight };
    }
    const img = this.el.image;
    img.src = url;
    await img.decode();
    img.hidden = false;
    this.el.video.hidden = true;
    this.source = img;
    return { deviceId: 'test', facing: 'environment', width: img.naturalWidth, height: img.naturalHeight };
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.camera?.stop();
    if (this.el) {
      this.el.image.hidden = true;
      this.el.image.removeAttribute('src');
      this.el.video.removeAttribute('src');
      this.el.canvas.style.opacity = '0';
    }
    if (this.renderer) this.renderer.opacity = 0;
    this.pendingCapture?.reject(new Error('Camera stopped.'));
    this.pendingCapture = null;
    this.set({ phase: 'idle', loading: null, hint: null, calibration: 0 });
  }

  fail(err) {
    console.error('[TryOn]', err);
    cancelAnimationFrame(this.raf);
    this.camera?.stop();
    const kind = err?.kind || 'unknown';
    this.set({ phase: 'error', loading: null, error: { kind, message: err?.message || String(err) } });
  }

  async switchCamera(deviceId) {
    if (!deviceId || deviceId === this.snapshot.deviceId) return;
    this.set({ deviceId });
    await this.start({ deviceId });
  }

  onVisibility() {
    if (!this.running || this.snapshot.phase === 'starting') return;
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.pausedAt = performance.now();
    } else if (!this.raf) {
      if (this.source === this.el.video && this.el.video.srcObject && !this.camera.active) {
        this.fail(new CameraError('ended', 'The camera was released while the page was in the background.'));
        return;
      }
      this.el.video.play?.().catch(() => {});
      this.last = performance.now();
      this.lastDetect = this.last;
      this.resetTracking(); // stale filters after a pause
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  resetTracking() {
    this.torso?.reset();
  }

  // ---- hooks for products that share the torso pipeline (see ImmobilizerTryOnSession) --------
  async createRenderer(E, opts) {
    const r = new E.ArRenderer(this.el.canvas, opts);
    this.set({ loading: { label: 'Loading 3D brace', progress: 0 } });
    await r.loadBrace((p) => this.set({ loading: { label: 'Loading 3D brace', progress: p } }));
    return r;
  }

  /** Called once per new pose result, after the torso and body-shape updates. */
  onPoseResult() {}

  // ---- alignment & options ----------------------------------------------------------------
  setAdjust(patch) {
    this.adjust = { ...this.adjust, ...patch };
    store.set(`${this.storeKey}.adjust`, this.adjust);
    this.set({ adjust: { ...this.adjust } });
  }

  resetAlignment({ recalibrate = true } = {}) {
    this.setAdjust({ ...DEFAULT_ADJUST });
    if (recalibrate && this.torso && this.snapshot.phase === 'tracking') {
      this.torso.unlockCalibration();
      this.fitter?.reset();
      this.fitter?.setEnabled(false);
      this.calElapsed = 0;
      this.set({ phase: 'calibrating', calibration: 0 });
    }
  }

  skipCalibration() {
    if (this.snapshot.phase !== 'calibrating') return;
    this.torso.lockCalibration();
    this.set({ phase: 'tracking', calibration: 1 });
  }

  async setOption(key, value) {
    this.options = { ...this.options, [key]: value };
    store.set(`${this.storeKey}.options`, this.options);
    this.set({ options: { ...this.options } });
    if (key === 'silhouette' || key === 'fitShape') this.tracker?.setSegmentation(this.needsMask());
    if (key === 'fitShape') {
      this.fitter?.reset();
      this.fitter?.setEnabled(false);
    }
    if (key === 'hfov') {
      this.renderer?.setFov(value);
      if (this.torso) this.torso.hfovDeg = value;
    }
    if (key === 'mirror') {
      this.set({ mirrored: value ?? true });
      this.layout();
    }
  }

  needsMask() {
    return !!(this.options.silhouette || this.options.fitShape);
  }

  // ---- capture ------------------------------------------------------------------------------
  capture() {
    if (!this.running || !this.raf) return Promise.reject(new Error('Start the try-on before capturing.'));
    return new Promise((resolve, reject) => {
      this.pendingCapture = { resolve, reject };
    });
  }

  // ---- layout: stage box covers the container while keeping the source aspect -------------
  layout() {
    if (!this.el) return;
    const { container, stage } = this.el;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const src = this.snapshot.sourceSize;
    if (!src || !cw || !ch) return;
    const sa = src.w / src.h;
    const ca = cw / ch;
    // Cover when aspect ratios are close (fills the viewport); contain otherwise so the user
    // never loses their shoulders or waist off the edge of the screen.
    const cover = Math.abs(Math.log(sa / ca)) < 0.22;
    let w, h;
    if (cover ? sa > ca : sa < ca) {
      h = ch;
      w = ch * sa;
    } else {
      w = cw;
      h = cw / sa;
    }
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.left = `${(cw - w) / 2}px`;
    stage.style.top = `${(ch - h) / 2}px`;
    stage.style.transform = this.snapshot.mirrored ? 'scaleX(-1)' : 'none';
    this.renderer?.resize(Math.round(w), Math.round(h), src.w, src.h);
  }

  // ---- per-frame ----------------------------------------------------------------------------
  tick(now) {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const src = this.source;
    const snap = this.snapshot;
    if (!src || !this.renderer) return;

    const fw = src.videoWidth || src.naturalWidth;
    const fh = src.videoHeight || src.naturalHeight;
    if (!fw || !fh) return;
    if (!snap.sourceSize || snap.sourceSize.w !== fw || snap.sourceSize.h !== fh) {
      this.set({ sourceSize: { w: fw, h: fh } });
      this.layout();
    }

    const st = this.torso.state;
    let renderState = st;
    let hint = snap.hint;

    if (snap.phase === 'manual') {
      renderState = manualState(st);
    } else if (this.tracker) {
      let res;
      // 1) hand the newest video frame to the worker whenever it is idle
      const isVideo = src === this.el.video;
      const frameTime = isVideo ? src.currentTime : now;
      const newFrame = !isVideo || frameTime !== this.lastFrameTime;
      if (newFrame && (isVideo ? src.readyState >= 2 : true) && this.tracker.submit(src, fw, fh, now)) {
        this.lastFrameTime = frameTime;
      }
      // 2) consume a finished result (timestamps are capture times, so dt is frame-accurate)
      res = this.tracker.latest;
      if (res && res.seq !== this.lastSeq) {
        this.lastSeq = res.seq;
        const pose = res.pose;
        this.stats.detectMs += (res.ms - this.stats.detectMs) * 0.1;
        this.stats.detections++;
        const pdt = Math.min(Math.max((res.ts - this.lastDetect) / 1000, 0.001), 0.25);
        this.lastDetect = res.ts;
        this.torso.update(pose, fw, fh, pdt);
        this.renderer.updateMask(this.tracker.mask, this.options.silhouette);
        if (this.options.fitShape && this.tracker.mask && st.valid) {
          this.fitter.update({
            mask: this.tracker.mask,
            st,
            frameW: fw,
            frameH: fh,
            hfovDeg: this.options.hfov,
            dt: pdt,
            settle: snap.phase === 'calibrating',
          });
          this.fitter.setEnabled(this.fitter.status.width > 0);
        }
        this.onPoseResult(pose, st, fw, fh, pdt);
        hint = this.computeHint(pose, st, snap.phase);
        if (snap.phase === 'calibrating') this.stepCalibration(st, pdt);
      }
      if (this.snapshot.phase === 'calibrating') {
        renderState = hiddenState(st);
      } else if (st.valid && res) {
        // The pose describes the frame captured at res.ts; the video on screen is newer. Extrapolate by
        // the measured age so the belt stays on the body during movement, whatever the inference speed.
        const lead = Math.min(Math.max((now - res.ts) / 1000, 0), MAX_LEAD);
        const speed = st.velocity.length();
        const k = speed > 0.05 ? lead : 0; // dead-band: never amplify jitter when standing still
        this.renderPos = (this.renderPos || st.position.clone()).copy(st.position).addScaledVector(st.velocity, k);
        renderState = Object.assign(this.renderState || (this.renderState = {}), st, { position: this.renderPos });
      }
    }

    this.renderer.update(renderState, this.adjust, dt, { occlusion: this.options.armOcclusion && snap.phase !== 'manual' });
    this.renderer.render();

    if (this.pendingCapture) {
      const { resolve, reject } = this.pendingCapture;
      this.pendingCapture = null;
      composeScreenshot({
        source: src,
        overlay: this.el.canvas,
        overlayOpacity: this.renderer.opacity,
        mirrored: this.snapshot.mirrored,
        frameW: fw,
        frameH: fh,
        caption: `${this.product.name} · virtual preview, not a fitting`,
      }).then(resolve, reject);
    }

    // scene brightness ~1 Hz (cheap 32x18 sample)
    if (!this.lumAt || now - this.lumAt > 1000) {
      this.lumAt = now;
      this.renderer.setSceneBrightness(sampleLuminance(src));
    }

    this.stats.frames++;
    if (now - this.lastEmit > 150) {
      this.lastEmit = now;
      const el = (now - this.stats.t0) / 1000;
      let stats = snap.stats;
      if (el > 1) {
        stats = {
          renderFps: Math.round(this.stats.frames / el),
          detectFps: Math.round(this.stats.detections / el),
          detectMs: Math.round(this.stats.detectMs * 10) / 10,
          delegate: this.tracker?.delegate || '-',
          model: this.tracker?.variant || '-',
          size: `${fw}x${fh}`,
        };
        this.stats = { frames: 0, detections: 0, detectMs: this.stats.detectMs, t0: now };
      }
      this.set({
        hint,
        stats,
        fit: this.fitter ? { ...this.fitter.status } : null,
        tracking: {
          valid: st.valid,
          quality: Math.round(st.quality * 100) / 100,
          facing: st.facing,
          yawDeg: Math.round(st.yawDeg),
          flipped: st.flipped,
        },
      });
    }
  }

  stepCalibration(st, dt) {
    this.calElapsed += dt;
    const span = st.shoulderSpan;
    const allowNoHips = this.calElapsed > CAL_NO_HIPS_AFTER;
    const good = st.valid && st.quality > 0.65 && span > 0.1 && span < 0.65 && st.motion < 0.3 && (st.hipsVisible || allowNoHips);
    const p = clamp(this.snapshot.calibration + (good ? dt / CAL_SECONDS : -dt / 2), 0, 1);
    if (p >= 1) {
      this.torso.lockCalibration();
      this.set({ phase: 'tracking', calibration: 1, calibratedNoHips: !st.hipsVisible });
    } else if (Math.abs(p - this.snapshot.calibration) > 0.02 || p === 0) {
      this.set({ calibration: p });
    }
  }

  computeHint(pose, st, phase) {
    if (!pose) return 'Step into the frame so your upper body is visible';
    if (!st.valid) return 'Make sure both shoulders are in view';
    // shoulder span shrinks when turning, so use it only when facing the camera
    const far = st.facing === 'front' ? st.shoulderSpan < 0.1 : st.torsoSpan < 0.16;
    const near = st.facing === 'front' ? st.shoulderSpan > 0.65 : st.torsoSpan > 0.8;
    if (far) return 'Move a little closer to the camera';
    if (near) return 'Step back a little';
    if (phase === 'calibrating') {
      if (!st.hipsVisible) {
        return this.calElapsed > CAL_NO_HIPS_AFTER
          ? 'Hold still: aligning to your shoulders'
          : 'Step back so your waist is also in view';
      }
      if (st.motion > 0.3) return 'Hold still for a moment';
      return 'Hold still: aligning to your torso';
    }
    if (this.options.fitShape && this.fitter && this.fitter.status.width > 0.4 && this.fitter.status.depth < 0.3) {
      this.fitStartedAt ??= performance.now();
      if (performance.now() - this.fitStartedAt < 20000) return 'Turn sideways for a moment so the belt can fit your waist and tummy';
    }
    return null;
  }
}

function hiddenState(st) {
  return { ...st, visible: 0, valid: false };
}

const MANUAL = {
  valid: true,
  visible: 1,
  facing: 'front',
  joints: {},
};
function manualState(st) {
  // Brace centred in front of the camera ~1.5 m away; the user drags it into place with the sliders.
  st.position.set(0, 0.18, -1.5);
  st.quaternion.identity();
  st.scale.set(1, 1, 1);
  return { ...st, ...MANUAL, joints: st.joints, valid: false, visible: 1 };
}

let lumCanvas;
function sampleLuminance(src) {
  try {
    lumCanvas = lumCanvas || Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
    const ctx = lumCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, 32, 18);
    const d = ctx.getImageData(0, 0, 32, 18).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4) / 255;
  } catch {
    return 0.5;
  }
}
