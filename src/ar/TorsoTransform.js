// Turns MediaPipe pose landmarks into a stable torso transform in camera space.
//
// 1. Orientation comes from the *world* landmarks (metric, hip-centred, camera-aligned axes):
//    X = anatomical right->left shoulder line (blended with the hip line), Y = hips->shoulders, Z = X x Y.
// 2. Translation comes from a weighted linear perspective solve: find t so that (world_i + t)
//    projects onto the *image* landmarks under a pinhole camera with the assumed field of view.
//    Because t is solved with the same metric scale as the world landmarks, on-screen size is
//    self-consistent even when MediaPipe's absolute body-size estimate is off.
// 3. Front/back: taken from the 3D geometry (shoulder order + nose depth), with a persistence
//    check that rejects one-frame 180° label flips. (Face visibility proved useless: ~1.0 from behind.)
// 4. One Euro filtering on landmarks + damped output, hold-then-fade on tracking loss.
import * as THREE from 'three';
import { PointFilterBank, OneEuro, clamp, damp } from './filters.js';

export const LM = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
};
const TRACKED = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24];

const HOLD_SECONDS = 0.45; // keep last pose this long after losing the person
const SNAP_AFTER_LOSS = 0.8; // re-acquire without smoothing from a stale pose after this

const vis = (l) => (l.visibility ?? 1);
const inFrame = (l, m = 0.02) => l.x > -m && l.x < 1 + m && l.y > -m && l.y < 1 + m;

export class TorsoTransform {
  constructor({ refShoulderWidth, refTorsoLength }) {
    this.ref = { shoulder: refShoulderWidth, torso: refTorsoLength };
    this.imgBank = new PointFilterBank(2, 1.4, 0.9); // normalized coords
    this.worldBank = new PointFilterBank(3, 1.0, 1.5); // metres
    this.posFilter = [new OneEuro(1.6, 0.6), new OneEuro(1.6, 0.6), new OneEuro(1.0, 0.3)];
    this.img = {};
    this.world = {};
    for (const i of TRACKED) {
      this.img[i] = [0, 0];
      this.world[i] = [0, 0, 0];
    }
    this.hfovDeg = 63; // typical laptop/phone front camera; adjustable in advanced settings
    this.state = {
      valid: false,
      visible: 0, // 0..1 overlay opacity target
      position: new THREE.Vector3(0, 0, -1.6),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      yawDeg: 0,
      facing: 'front', // 'front' | 'side' | 'back'
      flipped: false,
      quality: 0, // 0..1 tracking confidence
      shoulderSpan: 0, // fraction of frame width
      torsoSpan: 0,
      hipsVisible: false,
      motion: 0,
      joints: {}, // camera-space THREE.Vector3 per landmark (for occluders)
      // Unfiltered pose of the *current* frame: used to measure the body outline in the same
      // frame's segmentation mask (the filtered pose lags a little behind the pixels).
      raw: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
      velocity: new THREE.Vector3(), // m/s, camera space, for latency compensation
      bodyDims: { shoulder: refShoulderWidth, torso: refTorsoLength },
    };
    for (const i of TRACKED) this.state.joints[i] = new THREE.Vector3();
    this.locked = null; // calibrated body dims
    this.calSamples = [];
    this.lostTime = 0;
    this.flipVotes = 0;
    this.flip = false;
    this.lastMid = null;
    this._targetQ = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
  }

  reset() {
    this.imgBank.reset();
    this.worldBank.reset();
    this.posFilter.forEach((f) => f.reset());
    this.state.valid = false;
    this.lostTime = 0;
    this.flipVotes = 0;
    this.flip = false;
    this.lastMid = null;
  }

  unlockCalibration() {
    this.locked = null;
    this.calSamples = [];
  }

  /**
   * Freeze the body's *proportions* (torso length / shoulder width) from the calibration samples.
   * Absolute size is NOT frozen: MediaPipe's metric scale estimate drifts with distance (measured
   * ~15 % between 0.9 m and 1.2 m), and the depth solve uses the current frame's scale. The brace
   * must use that same scale, otherwise it would shrink or grow relative to the body as you move.
   */
  lockCalibration() {
    const s = this.calSamples.length ? this.calSamples : [this.state.bodyDims];
    const ratios = s.map((x) => x.torso / x.shoulder).sort((p, q) => p - q);
    this.locked = { ratio: ratios[ratios.length >> 1] };
  }

  /**
   * @param pose {landmarks, world} or null
   * @param frameW,frameH source pixel size
   * @param dt seconds since previous update
   */
  update(pose, frameW, frameH, dt) {
    const st = this.state;
    const usable = pose && this.ingest(pose, dt);
    if (!usable) {
      this.lostTime += dt;
      st.quality = Math.max(0, st.quality - dt * 3);
      if (this.lostTime > HOLD_SECONDS) {
        st.valid = false;
        st.visible = 0;
      }
      return st;
    }

    if (this.lostTime > SNAP_AFTER_LOSS) {
      // Coming back after a real loss: reset temporal state so we don't sweep from a stale pose.
      this.posFilter.forEach((f) => f.reset());
      st.valid = false;
    }
    this.lostTime = 0;

    const L = pose.landmarks;
    const W = this.world;
    const toThree = (w, out) => out.set(w[0], -w[1], -w[2]);

    // ---- orientation ------------------------------------------------------------------------
    const ls = toThree(W[LM.leftShoulder], _v1);
    const rs = toThree(W[LM.rightShoulder], _v2);
    const lh = toThree(W[LM.leftHip], _v3);
    const rh = toThree(W[LM.rightHip], _v4);
    const sMid = _v5.addVectors(ls, rs).multiplyScalar(0.5);
    const hMid = _v6.addVectors(lh, rh).multiplyScalar(0.5);
    const shoulderW = ls.distanceTo(rs);
    const torsoL = sMid.distanceTo(hMid);

    const hipVis = Math.min(vis(L[LM.leftHip]), vis(L[LM.rightHip]));
    const x = _x.subVectors(ls, rs).normalize();
    if (hipVis > 0.3) {
      const hx = _y.subVectors(lh, rh).normalize();
      x.multiplyScalar(0.75).addScaledVector(hx, 0.25).normalize();
    }
    const y = _y.subVectors(sMid, hMid).normalize();
    y.addScaledVector(x, -y.dot(x)).normalize();
    const z = _z.crossVectors(x, y);

    // ---- front/back hemisphere --------------------------------------------------------------
    // Measured on a real webcam: when the user turns their back, MediaPipe's world landmarks
    // stay geometrically consistent (left shoulder moves to image-left, nose goes behind the
    // shoulder line) while face *visibility* stays ~1.0 — so visibility is NOT used as a cue.
    // The failure mode is a sudden single-frame 180° flip of the labels; we only accept a
    // jump of >120° if it persists, otherwise we keep the previous orientation target.
    const noseAhead = (W[LM.leftShoulder][2] + W[LM.rightShoulder][2]) / 2 - W[LM.nose][2]; // +ve = nose closer
    if (z.z * noseAhead < 0 && Math.abs(noseAhead) > 0.08 && Math.abs(z.z) > 0.5) {
      // shoulder labels and nose depth disagree strongly: trust the nose (more stable than L/R labels)
      x.negate();
      z.negate();
    }
    this._m.makeBasis(x, y, z);
    _q.setFromRotationMatrix(this._m);
    const jump = st.valid ? st.quaternion.angleTo(_q) : 0;
    if (jump > THREE.MathUtils.degToRad(120)) {
      this.flipVotes++;
      if (this.flipVotes < 6) _q.copy(this._targetQ); // hold until the flip proves persistent
      else this.flipVotes = 0;
    } else {
      this.flipVotes = 0;
    }
    this.flip = this.flipVotes > 0;
    this._targetQ.copy(_q);

    // ---- translation: weighted perspective solve --------------------------------------------
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(this.hfovDeg) / 2);
    const cx = frameW / 2;
    const cy = frameH / 2;
    const pts = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
    const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 0, 0];
    for (const i of pts) {
      const l = L[i];
      let w = vis(l);
      if (i >= 23) w *= inFrame(l) ? 0.8 : 0.1;
      if (w < 0.05) continue;
      const [X, Y, Z] = W[i];
      const u = this.img[i][0] * frameW - cx;
      const v = this.img[i][1] * frameH - cy;
      // rows: [f, 0, -u] t = u Z - f X ;  [0, f, -v] t = v Z - f Y
      accumulate(A, b, f, 0, -u, u * Z - f * X, w);
      accumulate(A, b, 0, f, -v, v * Z - f * Y, w);
    }
    const t = solve3(A, b);
    if (!t || t[2] < 0.25 || t[2] > 6) return st; // implausible; keep previous transform

    // shoulder-mid in camera space (MediaPipe frame) -> three.js frame
    const smW = [(W[11][0] + W[12][0]) / 2, (W[11][1] + W[12][1]) / 2, (W[11][2] + W[12][2]) / 2];
    const px = smW[0] + t[0];
    const py = -(smW[1] + t[1]);
    const pz = -(smW[2] + t[2]);

    for (const i of TRACKED) {
      const w = W[i];
      st.joints[i].set(w[0] + t[0], -(w[1] + t[1]), -(w[2] + t[2]));
    }

    // ---- body dimensions / scale ------------------------------------------------------------
    const fresh = !st.valid;
    const dims = st.bodyDims;
    // Size follows the current frame's metric scale (same scale as the translation solve), so the
    // projected brace stays locked to the body at any distance; proportions are locked after calibration.
    const rate = fresh ? 1e3 : 5;
    dims.shoulder += (shoulderW - dims.shoulder) * damp(rate, dt);
    dims.torso += ((this.locked ? dims.shoulder * this.locked.ratio : torsoL) - dims.torso) * damp(rate, dt);
    const sx = dims.shoulder / this.ref.shoulder;
    const sy = clamp(dims.torso / this.ref.torso / sx, 0.85, 1.2) * sx;

    // ---- raw pose + velocity -----------------------------------------------------------------
    if (!fresh && dt > 0) {
      _v7.set(px, py, pz).sub(st.raw.position).divideScalar(dt);
      if (_v7.length() < 3) st.velocity.lerp(_v7, damp(10, dt)); // ignore teleports
    } else {
      st.velocity.set(0, 0, 0);
    }
    st.raw.position.set(px, py, pz);
    st.raw.quaternion.copy(this._targetQ);

    // ---- smoothing & output -----------------------------------------------------------------
    st.position.set(
      this.posFilter[0].filter(px, dt),
      this.posFilter[1].filter(py, dt),
      this.posFilter[2].filter(pz, dt),
    );
    if (fresh) {
      st.quaternion.copy(this._targetQ);
      st.scale.set(sx, sy, sx);
    } else {
      const ang = st.quaternion.angleTo(this._targetQ);
      st.quaternion.slerp(this._targetQ, damp(10 + ang * 40, dt));
      st.scale.lerp(_v7.set(sx, sy, sx), damp(this.locked ? 6 : 3, dt));
    }
    st.valid = true;
    st.visible = 1;

    const fwd = _v7.set(0, 0, 1).applyQuaternion(st.quaternion);
    st.yawDeg = THREE.MathUtils.radToDeg(Math.atan2(fwd.x, fwd.z));
    const ay = Math.abs(st.yawDeg);
    st.facing = ay < 50 ? 'front' : ay > 130 ? 'back' : 'side';
    st.flipped = this.flip;

    // ---- diagnostics for guidance / calibration ---------------------------------------------
    const sv = Math.min(vis(L[11]), vis(L[12]));
    st.hipsVisible = hipVis > 0.5 && inFrame(L[23], 0) && inFrame(L[24], 0);
    const tl = Math.hypot((this.img[11][0] + this.img[12][0] - this.img[23][0] - this.img[24][0]) / 2 * frameW / frameH, (this.img[11][1] + this.img[12][1] - this.img[23][1] - this.img[24][1]) / 2);
    st.torsoSpan = tl; // shoulder-mid to hip-mid, fraction of frame height (unaffected by turning)
    st.shoulderSpan = Math.hypot(this.img[11][0] - this.img[12][0], (this.img[11][1] - this.img[12][1]) * frameH / frameW);
    const mid = [(this.img[11][0] + this.img[12][0]) / 2, (this.img[11][1] + this.img[12][1]) / 2];
    if (this.lastMid && dt > 0) {
      const sp = Math.hypot(mid[0] - this.lastMid[0], mid[1] - this.lastMid[1]) / dt;
      st.motion += (sp - st.motion) * damp(6, dt);
    }
    this.lastMid = mid;
    st.quality = clamp(0.6 * sv + 0.4 * Math.max(hipVis, 0.3), 0, 1);

    if (!this.locked) {
      this.calSamples.push({ shoulder: shoulderW, torso: torsoL });
      if (this.calSamples.length > 45) this.calSamples.shift();
    }
    return st;
  }

  /** Filters the landmarks we use; returns false if the torso isn't usable this frame. */
  ingest(pose, dt) {
    const L = pose.landmarks;
    const ls = L[LM.leftShoulder];
    const rs = L[LM.rightShoulder];
    if (vis(ls) < 0.5 || vis(rs) < 0.5 || !inFrame(ls, 0.05) || !inFrame(rs, 0.05)) return false;
    for (const i of TRACKED) {
      const l = L[i];
      const w = pose.world[i];
      this.imgBank.filter(i, [l.x, l.y], dt, this.img[i]);
      this.worldBank.filter(i, [w.x, w.y, w.z], dt, this.world[i]);
    }
    return true;
  }
}

function accumulate(A, b, a0, a1, a2, rhs, w) {
  const r = [a0, a1, a2];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) A[i * 3 + j] += w * r[i] * r[j];
    b[i] += w * r[i] * rhs;
  }
}

function solve3(A, b) {
  const [a, bb, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  const inv = [
    e * i - f * h, c * h - bb * i, bb * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, bb * g - a * h, a * e - bb * d,
  ];
  return [0, 1, 2].map((r) => (inv[r * 3] * b[0] + inv[r * 3 + 1] * b[1] + inv[r * 3 + 2] * b[2]) / det);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _v7 = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
