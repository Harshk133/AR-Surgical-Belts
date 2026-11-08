// Tennis elbow strap session: camera -> pose landmarks (+ per-person mask) -> forearm frame + outline
// fit -> procedural strap. Shares the per-frame loop with the wrist session through its hooks.
import { WristTryOnSession } from './WristTryOnSession.js';
import { ELBOW_PRODUCT } from '../model/elbowSupportConfig.js';
import { clamp } from './filters.js';

let engine;
const loadEngine = () =>
  (engine ||= Promise.all([
    import('./ArRenderer.js'),
    import('./ElbowRenderer.js'),
    import('./PoseTracker.js'),
    import('./ArmTransform.js'),
    import('./ElbowFitter.js'),
    import('./ElbowStrap.js'),
  ]).then(([a, r, t, h, f, b]) => ({
    webglAvailable: a.webglAvailable,
    ElbowRenderer: r.ElbowRenderer,
    PoseTracker: t.PoseTracker,
    ArmTransform: h.ArmTransform,
    ElbowFitter: f.ElbowFitter,
    canonicalArmRig: b.canonicalArmRig,
  })));

const DEFAULT_OPTIONS = { silhouette: true, fitShape: true, armOcclusion: true, showStats: false, hfov: 63, mirror: null, hand: 'auto' };
const CAL_SECONDS = 1.0;

export class ElbowTryOnSession extends WristTryOnSession {
  constructor() {
    super({ storeKey: 'tryon.elbow', product: ELBOW_PRODUCT, defaultOptions: DEFAULT_OPTIONS });
    this.snapshot.tracking = { valid: false, quality: 0, facing: 'outer', yawDeg: 0, flipped: false, hand: null };
  }

  loadEngine() {
    return loadEngine();
  }

  async createPipeline(E) {
    this.hand = this.hand || new E.ArmTransform();
    this.hand.preference = this.options.hand || 'auto';
    this.fitter = this.fitter || new E.ElbowFitter();
    // the forearm is narrow in the frame: keep a finer person mask than the torso needs
    if (!this.tracker) this.tracker = await new E.PoseTracker().init({ segmentation: this.needsMask(), maskMaxW: 480 });
  }

  createRenderer(E, opts) {
    return new E.ElbowRenderer(this.el.canvas, opts);
  }

  trackUpdate(res, fw, fh, dt) {
    this.hand.update(res.pose, fw, fh, dt);
  }

  manualRig() {
    return this.E.canonicalArmRig();
  }

  renderSpan(st) {
    return st.Lf;
  }

  trackerLabel() {
    return 'body';
  }

  buildRig(st) {
    const fit = this.fitter.rigParams(st.Lf);
    return { Lf: st.Lf, levels: fit.levels, offset: fit.offset, girth: this.adjust.scale };
  }

  otherRig() {
    return null; // the other arm is handled by the renderer's capsules
  }

  manualState(st) {
    // right forearm pointing down-left in front of the camera, outer side visible; placed with sliders
    st.position.set(0.05, 0.12, -1.0);
    st.quaternion.identity();
    return { ...st, valid: false, visible: 1, mirror: 1, other: { valid: false }, Lf: 0.26 };
  }

  stepCalibration(st, dt) {
    this.calElapsed += dt;
    const sizeOk = st.imgForearm > 0.12 && st.imgForearm < 0.9;
    const fs = this.fitter.status;
    const fitReady = !this.options.fitShape || fs.reliable < 0.5 || fs.width > 0.3 || this.calElapsed > 3;
    const good = st.valid && st.quality > 0.6 && sizeOk && st.motion < 0.8 && st.armInFrame && fitReady;
    const p = clamp(this.snapshot.calibration + (good ? dt / CAL_SECONDS : -dt / 2), 0, 1);
    if (p >= 1) this.set({ phase: 'tracking', calibration: 1 });
    else if (Math.abs(p - this.snapshot.calibration) > 0.02 || p === 0) this.set({ calibration: p });
  }

  computeHint(res, st, phase) {
    const pref = this.options.hand;
    if (!res?.pose) return 'Sit or stand about 1 m from the camera with your shoulders in view';
    if (!st.shoulders) return 'Make sure both shoulders are in view';
    if (!st.valid) {
      if (pref && pref !== 'auto') return `Show your ${pref} elbow and forearm to the camera`;
      return 'Show your elbow and forearm to the camera';
    }
    if (!st.armInFrame) return 'Move so your whole forearm, elbow to wrist, is in view';
    if (st.imgForearm < 0.12) return 'Move a little closer to the camera';
    if (st.imgForearm > 0.9) return 'Move back a little';
    if (phase === 'calibrating') {
      if (st.motion > 0.8) return 'Hold your arm still for a moment';
      if (st.flexDeg < 15) return 'Bend your elbow a little so the pad can find the outer side';
      return 'Hold still: fitting the strap to your forearm';
    }
    const fs = this.fitter?.status;
    if (this.options.fitShape && fs && fs.width > 0.4 && fs.depth < 0.3) {
      this.fitStartedAt ??= performance.now();
      if (performance.now() - this.fitStartedAt < 20000) return 'Rotate your forearm once so the strap can fit its thickness';
    }
    return null;
  }
}
