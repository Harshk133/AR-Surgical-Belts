// Universal shoulder immobilizer session. It is a torso product, so it runs the proven Taylor's brace
// pipeline unchanged (pose worker + mask, TorsoTransform, BodyShapeFitter, calibration, latency
// compensation) and adds the supported arm on top:
//  - arm joints are depth-ray snapped onto their 2D landmarks (keeping the torso solve's depth), then
//    expressed in the reference-torso space the model is built in;
//  - which arm is supported: the user's choice, else the arm held in the sling position;
//  - edge cases: arm hanging / raised / away from the body -> pouch hidden and the band wraps only the
//    chest, with guidance; arm briefly lost -> held for 0.5 s; other hand in front -> occluded.
import * as THREE from 'three';
import { TryOnSession } from './TryOnSession.js';
import { IMMOBILIZER as CFG, IMMOBILIZER_PRODUCT } from '../model/immobilizerConfig.js';
import { clamp, damp } from './filters.js';

export const DEFAULT_OPTIONS = { silhouette: true, fitShape: true, armOcclusion: true, showStats: false, hfov: 63, mirror: null, hand: 'auto' };
// pose hand points (17/18 pinky, 19/20 index knuckle region) give the hand end of a pouch
const ARM_IDX = { left: { S: 11, E: 13, W: 15, P: 17, I: 19, sign: 1 }, right: { S: 12, E: 14, W: 16, P: 18, I: 20, sign: -1 } };
const SNAP = [7, 8, 11, 12, 13, 14, 15, 16];
const ARM_HOLD = 0.5;
const vis = (l) => l?.visibility ?? 0;
const inFrame = (l, m = 0.01) => l.x > m && l.x < 1 - m && l.y > m && l.y < 1 - m;

export class ImmobilizerTryOnSession extends TryOnSession {
  constructor(cfg = { storeKey: 'tryon.immobilizer', product: IMMOBILIZER_PRODUCT, defaultOptions: DEFAULT_OPTIONS }) {
    super(cfg);
    this.armCfg = CFG; // pose thresholds + arm radii (overridden by the arm sling)
    this.needsWrap = true; // the immobilizer's band holds the upper arm against the side
    this.side = null;
    this.armState = { valid: false, inPose: false, wrap: false, lost: 0, flexDeg: 0, gap: 0 };
    this.J = Object.fromEntries(SNAP.map((i) => [i, new THREE.Vector3()]));
    this.local = { S: new THREE.Vector3(), E: new THREE.Vector3(), W: new THREE.Vector3() };
    this.smoothLocal = null;
  }

  /** { Renderer, canonicalRig, label } for this product (the arm sling overrides it). */
  async loadModelModule() {
    const { ImmobilizerRenderer } = await import('./ImmobilizerRenderer.js');
    const { canonicalImmobilizerRig } = await import('./ImmobilizerModel.js');
    return { Renderer: ImmobilizerRenderer, canonicalRig: canonicalImmobilizerRig, label: 'Preparing the immobilizer' };
  }

  async createRenderer(E, opts) {
    const { TorsoShape } = await import('./ImmobilizerModel.js');
    const { Renderer, canonicalRig, label } = await this.loadModelModule();
    this.shape = new TorsoShape();
    const r = new Renderer(this.el.canvas, opts);
    this.set({ loading: { label, progress: null } });
    await r.loadBrace();
    r.updateGeometry(canonicalRig()); // also what manual placement shows
    return r;
  }

  set(patch) {
    if (patch.tracking) patch = { ...patch, tracking: { ...patch.tracking, hand: patch.tracking.valid ? this.side : null } };
    super.set(patch);
  }

  async setOption(key, value) {
    await super.setOption(key, value);
    if (key === 'hand') {
      this.side = value === 'auto' ? null : value;
      this.armState.inPose = false;
    }
  }

  async start(opts) {
    // a new run must not inherit the previous arm pose (the hysteresis would carry it over)
    this.armState = { valid: false, inPose: false, wrap: false, lost: 0, flexDeg: 0, gap: 0 };
    this.smoothLocal = null;
    this.outFor = 0;
    this.lastShown = false;
    return super.start(opts);
  }

  resetAlignment(opts) {
    super.resetAlignment(opts);
    this.smoothLocal = null;
  }

  /** Per pose result: snap the arm joints, pick the supported arm, classify its pose, rebuild. */
  onPoseResult(pose, st, fw, fh, dt) {
    if (!st.valid || !pose) return;
    const L = pose.landmarks;
    const f = (fw / 2) / Math.tan(THREE.MathUtils.degToRad(this.options.hfov) / 2);
    const img = this.torso.img;
    for (const i of SNAP) {
      const z = Math.max(-st.joints[i].z, 0.1);
      this.J[i].set(((img[i][0] * fw - fw / 2) * z) / f, -((img[i][1] * fh - fh / 2) * z) / f, -z);
    }
    // reference-torso space (inverse of the anchor the renderer uses)
    _qi.copy(st.quaternion).invert();
    const toRef = (P, out) => out.copy(P).sub(st.position).applyQuaternion(_qi).divide(st.scale);

    const fitOn = this.options.fitShape && this.fitter?.status.width > 0;
    const factors = fitOn ? this.fitter.factors : null;
    this.shape.set(factors);

    // ---- which arm is supported -----------------------------------------------------------------
    const pref = this.options.hand && this.options.hand !== 'auto' ? this.options.hand : null;
    const evalArm = (name) => {
      const a = ARM_IDX[name];
      const ok = vis(L[a.E]) > 0.5 && vis(L[a.W]) > 0.4 && inFrame(L[a.E]) && inFrame(L[a.W], 0);
      if (!ok) return { ok: false, score: 0 };
      const S = toRef(this.J[a.S], new THREE.Vector3());
      const E = toRef(this.J[a.E], new THREE.Vector3());
      const W = toRef(this.J[a.W], new THREE.Vector3());
      // hand point: knuckle landmarks, snapped at the wrist's depth (they are not in the torso solve)
      const zW = -this.J[a.W].z;
      const hu = (L[a.P].x + L[a.I].x) / 2;
      const hv = (L[a.P].y + L[a.I].y) / 2;
      const handOk = vis(L[a.P]) > 0.3 && vis(L[a.I]) > 0.3;
      const Hc = _h.set(((hu * fw - fw / 2) * zW) / f, -((hv * fh - fh / 2) * zW) / f, -zW);
      let H = toRef(Hc, new THREE.Vector3());
      const fl = W.distanceTo(E);
      // fall back to the forearm direction when the hand points are unreliable or implausible
      if (!handOk || H.distanceTo(W) > 0.5 * fl || H.distanceTo(W) < 0.1 * fl) H = W.clone().addScaledVector(W.clone().sub(E).normalize(), 0.3 * fl);
      const c = this.classify(S, E, W, a.sign, false);
      return { ok, S, E, W, H, ...c, score: (c.inPose ? 2 : 0) + (c.front ? 1 : 0) + clamp(c.flexDeg / 90, 0, 1) };
    };
    const cand = { left: evalArm('left'), right: evalArm('right') };
    let side = pref || this.side;
    if (!pref) {
      const cur = side && cand[side];
      const other = side === 'left' ? 'right' : 'left';
      if (!side) side = cand.left.score >= cand.right.score ? 'left' : 'right';
      else if (cur && !cur.inPose && cand[other].inPose) side = other; // the other arm went into the sling
    }
    if (side !== this.side) {
      this.side = side;
      this.smoothLocal = null;
      this.armState.inPose = false;
    }

    // ---- the supported arm --------------------------------------------------------------------
    const A = this.armState;
    const c = cand[side];
    if (c.ok) {
      // light smoothing in torso space (the torso itself is already filtered)
      if (!this.smoothLocal) this.smoothLocal = { S: c.S.clone(), E: c.E.clone(), W: c.W.clone(), H: c.H.clone() };
      const k = damp(14, dt);
      this.smoothLocal.S.lerp(c.S, k);
      this.smoothLocal.E.lerp(c.E, k);
      this.smoothLocal.W.lerp(c.W, k);
      this.smoothLocal.H.lerp(c.H, damp(10, dt));
      const s = this.smoothLocal;
      const cl = this.classify(s.S, s.E, s.W, ARM_IDX[side].sign, A.inPose);
      Object.assign(A, { valid: true, lost: 0, ...cl });
    } else {
      A.lost += dt;
      if (A.lost > ARM_HOLD) Object.assign(A, { valid: false, inPose: false, wrap: false });
    }

    const rig = {
      factors,
      girth: this.adjust.scale,
      side: ARM_IDX[side].sign,
      arm: A.valid && this.smoothLocal ? { valid: true, inPose: this.shownInPose(A, dt), wrap: A.wrap, ...this.smoothLocal } : { valid: false },
    };
    this.renderer.updateGeometry(rig);
    const bodyScale = st.scale.x;
    this.renderer.occlusion.data = { J: this.J, side, S: bodyScale, H: A.valid && this.smoothLocal ? this.handCam(this.smoothLocal.H, st) : null };
  }

  /** Whether the pouch is drawn this frame (the arm sling holds it briefly after the arm leaves). */
  shownInPose(A) {
    return A.inPose;
  }

  /** Reference-space point back to camera space (for occluders). */
  handCam(Pref, st) {
    return (this._hc ||= new THREE.Vector3()).copy(Pref).multiply(st.scale).applyQuaternion(st.quaternion).add(st.position);
  }

  /**
   * Sling-pose classification in reference space. Hysteresis: entering needs the strict ranges,
   * staying needs only the lenient ones, so the pouch doesn't flicker at the boundary.
   */
  classify(S, E, W, sign, wasIn) {
    const C = this.armCfg;
    const P = C.pose;
    const up = _a.subVectors(E, S);
    const fo = _b.subVectors(W, E);
    const flexDeg = THREE.MathUtils.radToDeg(up.angleTo(fo));
    const sec = this.shape.section(E.y);
    const lateral = Math.abs(E.x - sec.cx) - sec.a; // elbow distance outside the torso's side
    const gap = Math.max(0, lateral - C.upperArmRadius);
    const front = W.z > this.shape.frontZ(clamp(W.x, sec.cx - sec.a * 0.95, sec.cx + sec.a * 0.95), W.y) - 0.04;
    const towardMidline = (W.x - E.x) * sign < 0.02;
    const [f0, f1] = wasIn ? P.flexOut : P.flexIn;
    const gapMax = wasIn ? P.elbowGapOut : P.elbowGapIn;
    // forearm incline (a sling keeps it about level; reject a forearm pointing up at the face)
    const incline = Math.abs(fo.y) / Math.max(fo.length(), 1e-6);
    const level = incline <= (wasIn ? P.maxInclineOut ?? 1 : P.maxInclineIn ?? 1);
    const inPose = flexDeg >= f0 && flexDeg <= f1 && gap < gapMax && front && towardMidline && level;
    // does the band take in the upper arm? (arm against the side at band height)
    const mid = this.shape.section((S.y + E.y) / 2);
    const armX = (S.x + E.x) / 2;
    const wrap = !this.needsWrap || Math.abs(armX - mid.cx) - mid.a - C.upperArmRadius < C.armGapToWrap;
    return { flexDeg, gap, front, inPose, wrap, level };
  }

  computeHint(pose, st, phase) {
    const base = super.computeHint(pose, st, phase);
    // presence / distance problems first; the arm comes before the "turn sideways" depth tip
    if (phase !== 'tracking' || (base && !base.startsWith('Turn sideways'))) return base;
    return this.armHint() || (base && this.depthHint);
  }

  get depthHint() {
    return 'Turn sideways for a moment so the band can fit your chest depth';
  }

  armHint() {
    const A = this.armState;
    const side = this.side || 'left';
    if (!A.valid) return `Keep your ${side} elbow and wrist in view so the pouch can hold the forearm`;
    if (!A.wrap) return `Bring your ${side} upper arm against your side, as the band holds it`;
    if (!A.inPose) {
      if (A.flexDeg < 45) return `Bend your ${side} elbow to about 90° and rest the forearm across your stomach`;
      if (!A.front) return `Bring your ${side} forearm in front of your stomach`;
      return `Rest your ${side} forearm across your stomach, elbow at about 90°`;
    }
    return null;
  }
}

const _qi = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _h = new THREE.Vector3();
