// Turns MediaPipe hand landmarks into a camera-space hand frame + per-joint 3D positions.
//
// 1. Translation: weighted linear perspective solve, as for the torso: find t so that world_i + t
//    projects onto the image landmarks. Hand and brace share the solve's metric scale, so the projected
//    brace size is right even when MediaPipe misjudges the absolute hand size.
// 2. Depth-ray snapping: each joint keeps its solved depth but is moved onto the camera ray through
//    its 2D landmark. The 2D detector is pixel-accurate; the 3D model is only approximately so. The
//    brace is built on the snapped joints, so its axis lands on the hand to the pixel.
// 3. Frame: origin = wrist (0); +Y distal (wrist -> middle MCP); +X radial (toward the index / thumb);
//    +Z dorsal. Left and right hands are mirror images: the frame is a rotation plus an optional X
//    mirror, so the brace geometry is authored once (for a left hand) and mirrored for a right hand.
// 4. Handedness: MediaPipe labels assume a mirrored image. The label sets the chirality, and finger
//    curl (fingers flex toward the palm) checks it and corrects the convention if it ever disagrees.
import * as THREE from 'three';
import { PointFilterBank, OneEuro, clamp, damp } from './filters.js';

export const HL = { wrist: 0, thumbCmc: 1, thumbMcp: 2, thumbIp: 3, thumbTip: 4, indexMcp: 5, middleMcp: 9, ringMcp: 13, pinkyMcp: 17 };
const N = 21;
const RIGID = new Set([0, 1, 5, 9, 13, 17]); // palm points: weighted up in the solve
const HOLD_SECONDS = 0.35;
const SNAP_AFTER_LOSS = 0.7;
const TIPS = [8, 12, 16, 20];
const MCPS = [5, 9, 13, 17];

/** Filters + perspective solve for one tracked hand slot. */
class HandSlot {
  constructor() {
    this.imgBank = new PointFilterBank(2, 1.7, 2.0);
    this.worldBank = new PointFilterBank(3, 1.5, 5.0);
    this.img = Array.from({ length: N }, () => [0, 0]);
    this.world = Array.from({ length: N }, () => [0, 0, 0]);
    this.rawImg = Array.from({ length: N }, () => [0, 0]);
    this.rawWorld = Array.from({ length: N }, () => [0, 0, 0]);
    this.cam = Array.from({ length: N }, () => new THREE.Vector3());
    this.rawCam = Array.from({ length: N }, () => new THREE.Vector3());
    this.lastWrist = null;
    this.chi = 1;
  }

  reset() {
    this.imgBank.reset();
    this.worldBank.reset();
    this.lastWrist = null;
  }

  ingest(hand, dt) {
    for (let i = 0; i < N; i++) {
      const l = hand.landmarks[i];
      const w = hand.world[i];
      this.rawImg[i][0] = l.x;
      this.rawImg[i][1] = l.y;
      this.rawWorld[i][0] = w.x;
      this.rawWorld[i][1] = w.y;
      this.rawWorld[i][2] = w.z;
      this.imgBank.filter(i, this.rawImg[i], dt, this.img[i]);
      this.worldBank.filter(i, this.rawWorld[i], dt, this.world[i]);
    }
    this.lastWrist = [hand.landmarks[0].x, hand.landmarks[0].y];
  }
}

/**
 * Perspective solve + depth-ray snapping. img: normalized [u,v]; world: metres (MediaPipe axes:
 * x right, y down, z away from camera). out: three.js camera space (x right, y up, z toward viewer).
 */
export function solveHand(img, world, frameW, frameH, f, out) {
  const cx = frameW / 2;
  const cy = frameH / 2;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const w = RIGID.has(i) ? 2 : 1;
    const [X, Y, Z] = world[i];
    const u = img[i][0] * frameW - cx;
    const v = img[i][1] * frameH - cy;
    accumulate(A, b, f, 0, -u, u * Z - f * X, w);
    accumulate(A, b, 0, f, -v, v * Z - f * Y, w);
  }
  const t = solve3(A, b);
  if (!t || t[2] < 0.08 || t[2] > 3) return false;
  for (let i = 0; i < N; i++) {
    const z = Math.max(world[i][2] + t[2], 0.05);
    const x = (img[i][0] * frameW - cx) * z / f;
    const y = (img[i][1] * frameH - cy) * z / f;
    out[i].set(x, -y, -z);
  }
  return true;
}

/**
 * Hand frame from camera-space joints. chi = +1 right hand, -1 left hand.
 * Returns the rotation (proper) + mirror sign such that world = pos + Rot * diag(mirror,1,1) * local.
 */
export function handFrame(P, chi, out) {
  const U = out.U.subVectors(P[9], P[0]).normalize();
  const R = out.R.subVectors(P[5], P[17]);
  R.addScaledVector(U, -R.dot(U)).normalize();
  const D = out.D.crossVectors(R, U).normalize().multiplyScalar(-chi);
  const det = R.dot(_c.crossVectors(U, D));
  out.mirror = det < 0 ? -1 : 1;
  _m.makeBasis(_c.copy(R).multiplyScalar(out.mirror), U, D);
  out.q.setFromRotationMatrix(_m);
  out.pos.copy(P[0]);
  return out;
}

export function toLocal(P, frame, outLocal) {
  for (let i = 0; i < P.length; i++) {
    _c.subVectors(P[i], frame.pos);
    outLocal[i].set(_c.dot(frame.R), _c.dot(frame.U), _c.dot(frame.D));
  }
  return outLocal;
}

const newFrame = () => ({ pos: new THREE.Vector3(), q: new THREE.Quaternion(), R: new THREE.Vector3(), U: new THREE.Vector3(), D: new THREE.Vector3(), mirror: 1 });
const newLocal = () => Array.from({ length: N }, () => new THREE.Vector3());

export class HandTransform {
  constructor() {
    this.hfovDeg = 63;
    this.preference = 'auto'; // 'auto' | 'left' | 'right'
    // -1: the 'Left' label is the user's actual left hand on an un-mirrored frame. Measured with
    // tasks-vision 1.2 on a photo of a left hand (the older mirrored-selfie convention would be +1).
    // Finger curl keeps checking it and flips it if a build ever disagrees.
    this.labelMap = -1;
    this.chiEvidence = 0;
    this.main = new HandSlot();
    this.second = new HandSlot();
    this.posFilter = [new OneEuro(1.8, 1.2), new OneEuro(1.8, 1.2), new OneEuro(1.2, 0.6)];
    this.frame = newFrame();
    this.rawFrame = newFrame();
    this.otherFrame = newFrame();
    this.lostTime = 0;
    this.lastWristPx = null;
    this.state = {
      valid: false,
      visible: 0,
      position: new THREE.Vector3(0, 0, -0.5),
      quaternion: new THREE.Quaternion(),
      mirror: 1,
      hand: 'right',
      local: newLocal(), // filtered joints in the hand frame (metres)
      span: 0.065,
      L: 0.09,
      raw: { frame: this.rawFrame, local: newLocal(), cam: this.main.rawCam },
      velocity: new THREE.Vector3(),
      quality: 0,
      motion: 0,
      facing: 'back', // 'back' | 'palm' | 'side'
      yawDeg: 0,
      flipped: false,
      imgSpan: 0, // knuckle line, fraction of frame width
      other: { valid: false, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), mirror: 1, local: newLocal(), span: 0.065, L: 0.09 },
    };
  }

  reset() {
    this.main.reset();
    this.second.reset();
    this.posFilter.forEach((f) => f.reset());
    this.state.valid = false;
    this.state.other.valid = false;
    this.lostTime = 0;
    this.lastWristPx = null;
  }

  setPreference(p) {
    if (p === this.preference) return;
    this.preference = p;
    this.reset();
  }

  chiOf(hand) {
    if (hand.label !== 'Left' && hand.label !== 'Right') return 1;
    return (hand.label === 'Left' ? 1 : -1) * this.labelMap;
  }

  /** Pick the brace hand: keep following the same hand; else the preferred side; else the largest. */
  pick(hands) {
    if (!hands.length) return [-1, -1];
    const info = hands.map((h, i) => {
      const l = h.landmarks;
      return { i, chi: this.chiOf(h), x: l[0].x, y: l[0].y, size: Math.hypot(l[5].x - l[17].x, l[5].y - l[17].y) + Math.hypot(l[0].x - l[9].x, l[0].y - l[9].y) };
    });
    const want = this.preference === 'left' ? -1 : this.preference === 'right' ? 1 : 0;
    const pool = want ? info.filter((h) => h.chi === want) : info;
    let best = -1;
    const lw = this.main.lastWrist;
    if (lw && this.state.valid) {
      let bd = 0.15;
      for (const h of pool) {
        const d = Math.hypot(h.x - lw[0], h.y - lw[1]);
        if (d < bd) {
          bd = d;
          best = h.i;
        }
      }
    }
    if (best < 0 && pool.length) best = pool.reduce((b, h) => (h.size > b.size ? h : b), pool[0]).i;
    const other = info.find((h) => h.i !== best);
    return [best, other ? other.i : -1];
  }

  /**
   * @param hands worker result list (may be empty)
   */
  update(hands, frameW, frameH, dt) {
    const st = this.state;
    const [mi, oi] = this.pick(hands || []);
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(this.hfovDeg) / 2);

    // ---- the other hand: occluder only ---------------------------------------------------------
    if (oi >= 0) {
      const h = hands[oi];
      if (!st.other.valid) this.second.reset();
      this.second.ingest(h, dt);
      const ok = solveHand(this.second.img, this.second.world, frameW, frameH, f, this.second.cam);
      if (ok) {
        handFrame(this.second.cam, this.chiOf(h), this.otherFrame);
        toLocal(this.second.cam, this.otherFrame, st.other.local);
        st.other.position.copy(this.otherFrame.pos);
        st.other.quaternion.copy(this.otherFrame.q);
        st.other.mirror = this.otherFrame.mirror;
        st.other.span = this.second.cam[5].distanceTo(this.second.cam[17]);
        st.other.L = this.second.cam[0].distanceTo(this.second.cam[9]);
      }
      st.other.valid = ok;
    } else {
      st.other.valid = false;
    }

    // ---- brace hand ------------------------------------------------------------------------------
    if (mi < 0) {
      this.lostTime += dt;
      st.quality = Math.max(0, st.quality - dt * 3);
      if (this.lostTime > HOLD_SECONDS) {
        st.valid = false;
        st.visible = 0;
      }
      return st;
    }
    const hand = hands[mi];
    if (this.lostTime > SNAP_AFTER_LOSS || !st.valid) {
      this.main.reset();
      this.posFilter.forEach((p) => p.reset());
      st.valid = false;
    }
    this.lostTime = 0;
    this.main.ingest(hand, dt);
    const chi = this.chiOf(hand);

    const okRaw = solveHand(this.main.rawImg, this.main.rawWorld, frameW, frameH, f, this.main.rawCam);
    const ok = solveHand(this.main.img, this.main.world, frameW, frameH, f, this.main.cam);
    if (!ok || !okRaw) return st;

    handFrame(this.main.cam, chi, this.frame);
    handFrame(this.main.rawCam, chi, this.rawFrame);
    toLocal(this.main.cam, this.frame, st.local);
    toLocal(this.main.rawCam, this.rawFrame, st.raw.local);

    // ---- chirality check from finger curl (fingers flex toward the palm, i.e. local -Z) ----------
    let curl = 0;
    for (let k = 0; k < 4; k++) curl += st.local[MCPS[k]].z - st.local[TIPS[k]].z;
    const L = this.main.cam[0].distanceTo(this.main.cam[9]);
    curl /= 4 * L;
    if (Math.abs(curl) > 0.12) {
      this.chiEvidence = clamp(this.chiEvidence + Math.sign(curl) * dt, -3, 3);
      if (this.chiEvidence <= -2.5) {
        // fingers keep curling "dorsally": the label convention is the other way round on this build
        this.labelMap *= -1;
        this.chiEvidence = 0;
        console.info('[HandTransform] handedness convention corrected from finger curl');
      }
    }

    // ---- smoothing & output ----------------------------------------------------------------------
    const fresh = !st.valid;
    const span = this.main.cam[5].distanceTo(this.main.cam[17]);
    st.span += (span - st.span) * (fresh ? 1 : damp(8, dt));
    st.L += (L - st.L) * (fresh ? 1 : damp(8, dt));

    const p = this.rawFrame.pos;
    if (!fresh && dt > 0) {
      _v.copy(p).sub(this._lastRawPos || p).divideScalar(dt);
      if (_v.length() < 4) st.velocity.lerp(_v, damp(12, dt));
    } else {
      st.velocity.set(0, 0, 0);
    }
    this._lastRawPos = (this._lastRawPos || new THREE.Vector3()).copy(p);

    const fp = this.frame.pos;
    st.position.set(this.posFilter[0].filter(fp.x, dt), this.posFilter[1].filter(fp.y, dt), this.posFilter[2].filter(fp.z, dt));
    if (fresh || st.mirror !== this.frame.mirror) {
      st.quaternion.copy(this.frame.q);
    } else {
      const ang = st.quaternion.angleTo(this.frame.q);
      st.quaternion.slerp(this.frame.q, damp(18 + ang * 60, dt));
    }
    st.mirror = this.frame.mirror;
    st.hand = chi > 0 ? 'right' : 'left';
    st.valid = true;
    st.visible = 1;

    // ---- diagnostics ------------------------------------------------------------------------------
    _v.copy(this.frame.pos).negate().normalize(); // toward camera
    const dz = this.frame.D.dot(_v);
    st.facing = dz > 0.45 ? 'back' : dz < -0.45 ? 'palm' : 'side';
    st.yawDeg = THREE.MathUtils.radToDeg(Math.acos(clamp(dz, -1, 1)));
    const I = this.main.img;
    st.imgSpan = Math.hypot(I[5][0] - I[17][0], (I[5][1] - I[17][1]) * frameH / frameW);
    const wpx = [I[0][0] * frameW, I[0][1] * frameH];
    const spanPx = Math.max(st.imgSpan * frameW, 1);
    if (this.lastWristPx && dt > 0) {
      const sp = Math.hypot(wpx[0] - this.lastWristPx[0], wpx[1] - this.lastWristPx[1]) / spanPx / dt;
      st.motion += (sp - st.motion) * damp(6, dt);
    }
    this.lastWristPx = wpx;
    const edge = Math.min(I[0][0], 1 - I[0][0], I[0][1], 1 - I[0][1]);
    st.wristInFrame = edge > 0.02;
    st.quality = clamp((hand.score || 0.8) * (st.wristInFrame ? 1 : 0.6), 0, 1);
    return st;
  }
}

export function accumulate(A, b, a0, a1, a2, rhs, w) {
  const r = [a0, a1, a2];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) A[i * 3 + j] += w * r[i] * r[j];
    b[i] += w * r[i] * rhs;
  }
}

export function solve3(A, b) {
  const [a, bb, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    e * i - f * h, c * h - bb * i, bb * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, bb * g - a * h, a * e - bb * d,
  ];
  return [0, 1, 2].map((r) => (inv[r * 3] * b[0] + inv[r * 3 + 1] * b[1] + inv[r * 3 + 2] * b[2]) / det);
}

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
