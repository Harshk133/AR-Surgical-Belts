// Thumb wrist brace session: camera -> hand landmarks (+ person mask) -> hand frame + outline fit ->
// procedural brace. Reuses the camera, layout, capture and lifecycle code of TryOnSession; only the
// tracking pipeline, calibration and guidance are wrist-specific.
import { CameraError } from './CameraController.js';
import { isLikelyMobile } from './device.js';
import { DEFAULT_ADJUST, TryOnSession, sampleLuminance } from './TryOnSession.js';
import { composeScreenshot } from './ScreenshotCapture.js';
import { WRIST_PRODUCT } from '../model/wristBraceConfig.js';
import { clamp } from './filters.js';

let engine;
const loadEngine = () =>
  (engine ||= Promise.all([
    import('./ArRenderer.js'),
    import('./WristRenderer.js'),
    import('./HandTracker.js'),
    import('./HandTransform.js'),
    import('./WristFitter.js'),
    import('./WristBrace.js'),
    import('three'),
  ]).then(([a, r, t, h, f, b, three]) => ({
    webglAvailable: a.webglAvailable,
    WristRenderer: r.WristRenderer,
    HandTracker: t.HandTracker,
    HandTransform: h.HandTransform,
    WristFitter: f.WristFitter,
    priorLevels: b.priorLevels,
    canonicalRig: b.canonicalRig,
    Vector3: three.Vector3,
  })));

const DEFAULT_OPTIONS = { silhouette: true, fitShape: true, armOcclusion: true, showStats: false, hfov: 63, mirror: null, hand: 'auto' };
const MAX_LEAD = 0.1;
const CAL_SECONDS = 0.9;

export class WristTryOnSession extends TryOnSession {
  constructor(cfg = { storeKey: 'tryon.wrist', product: WRIST_PRODUCT, defaultOptions: DEFAULT_OPTIONS }) {
    super(cfg);
    this.snapshot.tracking = { valid: false, quality: 0, facing: 'back', yawDeg: 0, flipped: false, hand: null };
  }

  // ---- pipeline hooks (overridden by the elbow session) -------------------------------------
  loadEngine() {
    return loadEngine();
  }

  /** Transform + fitter first (needed even for manual placement), then the tracker (may throw). */
  async createPipeline(E) {
    this.hand = this.hand || new E.HandTransform();
    this.hand.preference = this.options.hand || 'auto';
    this.fitter = this.fitter || new E.WristFitter();
    if (!this.tracker) this.tracker = await new E.HandTracker().init({ segmentation: this.needsMask() });
  }

  createRenderer(E, opts) {
    return new E.WristRenderer(this.el.canvas, opts);
  }

  trackUpdate(res, fw, fh, dt) {
    this.hand.update(res.hands, fw, fh, dt);
  }

  manualRig() {
    return this.E.canonicalRig();
  }

  renderSpan(st) {
    return st.span;
  }

  trackerLabel() {
    return 'hand';
  }

  resetTracking() {
    this.hand?.reset();
  }

  async start({ deviceId, testSource } = {}) {
    if (this.snapshot.phase === 'starting') return;
    this.set({ phase: 'starting', error: null, hint: null, calibration: 0 });
    try {
      this.set({ loading: { label: 'Loading try-on engine', progress: null } });
      const E = (this.E = await this.loadEngine());
      if (!E.webglAvailable()) throw new CameraError('webgl', 'WebGL is not available in this browser, so the 3D brace cannot be drawn.');

      if (!this.renderer) {
        this.renderer = this.createRenderer(E, { maxDpr: isLikelyMobile() ? 1.5 : 2 });
        this.set({ loading: { label: 'Preparing the brace', progress: null } });
        await this.renderer.loadBrace();
      }
      this.renderer.setFov(this.options.hfov);

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

      let trackerOk = true;
      this.set({ loading: { label: `Starting ${this.trackerLabel()} tracking`, progress: null } });
      try {
        await this.createPipeline(E);
      } catch (err) {
        console.error('[TryOn] tracker init failed', err);
        this.tracker = null;
        trackerOk = false;
      }
      this.hand.hfovDeg = this.options.hfov;
      this.hand.reset();
      this.fitter.reset();
      this.fitter.enabled = this.options.fitShape;
      this.calElapsed = 0;
      this.fitStartedAt = null;
      this.rigSeq = -1;
      this.stats = { frames: 0, detections: 0, detectMs: 0, t0: performance.now() };

      this.set({
        loading: null,
        phase: trackerOk ? 'calibrating' : 'manual',
        error: trackerOk ? null : { kind: 'tracker', message: `${this.trackerLabel()[0].toUpperCase()}${this.trackerLabel().slice(1)} tracking could not start on this device. You can still place the brace manually.` },
      });
      if (!trackerOk) this.renderer.updateGeometry({ ...this.manualRig(), girth: this.adjust.scale });
      this.last = performance.now();
      this.lastDetect = this.last;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    } catch (err) {
      this.fail(err);
    }
  }

  // ---- options ------------------------------------------------------------------------------
  async setOption(key, value) {
    await super.setOption(key, value);
    if (key === 'fitShape' && this.fitter) this.fitter.enabled = value;
    if (key === 'hfov' && this.hand) this.hand.hfovDeg = value;
    if (key === 'hand' && this.hand) this.hand.setPreference(value);
  }

  resetAlignment({ recalibrate = true } = {}) {
    this.setAdjust({ ...DEFAULT_ADJUST });
    if (recalibrate && this.hand && this.snapshot.phase === 'tracking') {
      this.fitter?.reset();
      if (this.fitter) this.fitter.enabled = this.options.fitShape;
      this.calElapsed = 0;
      this.set({ phase: 'calibrating', calibration: 0 });
    }
  }

  skipCalibration() {
    if (this.snapshot.phase !== 'calibrating') return;
    this.set({ phase: 'tracking', calibration: 1 });
  }

  // ---- rig ----------------------------------------------------------------------------------
  buildRig(st) {
    const fit = this.fitter.rigParams(st.span);
    return { lm: st.local, span: st.span, L: st.L, forearm: fit.forearm, levels: fit.levels, offset: fit.offset, girth: this.adjust.scale };
  }

  otherRig(st) {
    const o = st.other;
    if (!o.valid) return null;
    this._fwd ||= new this.E.Vector3(0, 1, 0);
    return { lm: o.local, span: o.span, L: o.L, forearm: this._fwd, levels: this.E.priorLevels(o.span), offset: { x: 0, z: 0 }, girth: 1 };
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

    const st = this.hand.state;
    let renderState = st;
    let hint = snap.hint;

    if (snap.phase === 'manual') {
      renderState = this.manualState(st);
      if (this.lastGirth !== this.adjust.scale) {
        this.lastGirth = this.adjust.scale;
        this.renderer.updateGeometry({ ...this.manualRig(), girth: this.adjust.scale });
      }
    } else if (this.tracker) {
      const isVideo = src === this.el.video;
      const frameTime = isVideo ? src.currentTime : now;
      const newFrame = !isVideo || frameTime !== this.lastFrameTime;
      if (newFrame && (isVideo ? src.readyState >= 2 : true) && this.tracker.submit(src, fw, fh, now)) {
        this.lastFrameTime = frameTime;
      }
      const res = this.tracker.latest;
      if (res && res.seq !== this.lastSeq) {
        this.lastSeq = res.seq;
        this.stats.detectMs += (res.ms - this.stats.detectMs) * 0.1;
        this.stats.detections++;
        const pdt = Math.min(Math.max((res.ts - this.lastDetect) / 1000, 0.001), 0.25);
        this.lastDetect = res.ts;
        this.trackUpdate(res, fw, fh, pdt);
        const mask = this.tracker.mask;
        if (this.options.fitShape && mask && st.valid) {
          this.fitter.update({ mask, st, frameW: fw, frameH: fh, hfovDeg: this.options.hfov, dt: pdt, settle: snap.phase === 'calibrating' });
        }
        // trim to the silhouette only while the mask demonstrably agrees with the hand
        this.renderer.updateMask(mask, this.options.silhouette && this.fitter.status.reliable > 0.8);
        if (st.valid) {
          this.renderer.updateGeometry(this.buildRig(st), this.options.armOcclusion ? this.otherRig(st) : null);
          this.lastGirth = this.adjust.scale;
        }
        hint = this.computeHint(res, st, snap.phase);
        if (snap.phase === 'calibrating') this.stepCalibration(st, pdt);
      } else if (st.valid && this.lastGirth !== this.adjust.scale) {
        this.lastGirth = this.adjust.scale;
        this.renderer.updateGeometry(this.buildRig(st), this.options.armOcclusion ? this.otherRig(st) : null);
      }
      if (this.snapshot.phase === 'calibrating') {
        renderState = { ...st, visible: 0, valid: false };
      } else if (st.valid && res) {
        // latency compensation: the pose describes the frame captured at res.ts
        const lead = Math.min(Math.max((now - res.ts) / 1000, 0), MAX_LEAD);
        const k = st.velocity.length() > 0.04 ? lead : 0;
        this.renderPos = (this.renderPos || st.position.clone()).copy(st.position).addScaledVector(st.velocity, k);
        renderState = Object.assign(this.renderState || (this.renderState = {}), st, { position: this.renderPos });
      }
    }

    this.renderer.update(renderState, this.adjust, dt, {
      occlusion: this.options.armOcclusion && snap.phase !== 'manual',
      span: this.renderSpan(st),
    });
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
          model: `${this.tracker?.variant && this.trackerLabel() === 'body' ? this.tracker.variant : this.trackerLabel()}${this.fitter?.status.reliable > 0.8 ? '+mask' : ''}`,
          size: `${fw}x${fh}`,
        };
        this.stats = { frames: 0, detections: 0, detectMs: this.stats.detectMs, t0: now };
      }
      this.set({
        hint,
        stats,
        fit: this.fitter && this.options.fitShape ? { width: this.fitter.status.width, depth: this.fitter.status.depth } : null,
        tracking: {
          valid: st.valid,
          quality: Math.round(st.quality * 100) / 100,
          facing: st.facing,
          yawDeg: Math.round(st.yawDeg),
          flipped: false,
          hand: st.valid ? st.hand || st.side : null,
        },
      });
    }
  }

  stepCalibration(st, dt) {
    this.calElapsed += dt;
    const sizeOk = st.imgSpan > 0.04 && st.imgSpan < 0.55;
    const fs = this.fitter.status;
    // wait briefly for the outline fit when the mask is usable; never block on it
    const fitReady = !this.options.fitShape || fs.reliable < 0.5 || fs.width > 0.3 || this.calElapsed > 3;
    const good = st.valid && st.quality > 0.55 && sizeOk && st.motion < 0.9 && st.wristInFrame && fitReady;
    const p = clamp(this.snapshot.calibration + (good ? dt / CAL_SECONDS : -dt / 2), 0, 1);
    if (p >= 1) this.set({ phase: 'tracking', calibration: 1 });
    else if (Math.abs(p - this.snapshot.calibration) > 0.02 || p === 0) this.set({ calibration: p });
  }

  computeHint(res, st, phase) {
    const hands = res?.hands;
    const pref = this.options.hand;
    if (!st.valid) {
      if (hands?.length && pref && pref !== 'auto') return `Show your ${pref} hand to the camera`;
      return 'Hold your hand up to the camera with your wrist in view';
    }
    if (!st.wristInFrame) return 'Raise your hand a little so your wrist is in view';
    if (st.imgSpan < 0.04) return 'Bring your hand closer to the camera';
    if (st.imgSpan > 0.55) return 'Move your hand a little further from the camera';
    if (phase === 'calibrating') {
      if (st.motion > 0.9) return 'Hold your hand still for a moment';
      return 'Hold still: fitting the brace to your wrist';
    }
    const fs = this.fitter?.status;
    if (this.options.fitShape && fs && fs.width > 0.4 && fs.depth < 0.3) {
      this.fitStartedAt ??= performance.now();
      if (performance.now() - this.fitStartedAt < 20000) return 'Rotate your wrist to show the thumb side so the brace can fit its thickness';
    }
    return null;
  }

  manualState(st) {
    // a left hand, back of the hand to the camera, ~45 cm away; placed with the sliders
    st.position.set(0, -0.03, -0.45);
    st.quaternion.identity();
    return { ...st, valid: false, visible: 1, mirror: 1, other: { valid: false } };
  }

  needsMask() {
    return !!(this.options.silhouette || this.options.fitShape);
  }
}
