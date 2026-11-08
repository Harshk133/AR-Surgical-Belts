// Turns MediaPipe pose landmarks into a camera-space FOREARM frame for the tennis elbow strap.
//
// 1. Translation: the same weighted perspective solve as the torso (shoulders, hips, elbows, wrists),
//    then depth-ray snapping: each joint keeps its solved depth but moves onto the camera ray through
//    its 2D landmark, so the strap axis lands on the arm in the image.
// 2. Frame at the elbow: +Y distal (elbow -> wrist); +X lateral (outer side: lateral epicondyle and the
//    extensor muscles, where the pressure pad goes); +Z volar.
//    Lateral comes from the elbow hinge: X = side * unit(upperArm x forearm) (right arm: +1) whenever the
//    elbow is bent (>= ~25 deg). The hinge is independent of how the arm is held or rotated at the shoulder.
//    For a nearly straight arm it falls back to "away from the body" (this shoulder minus the other).
// 3. Left arms are the mirror image: the frame is a rotation plus an X mirror (as for the hand).
// Pose landmark sides are anatomical (11 = the person's left shoulder) whatever the camera mirroring.
import * as THREE from 'three';
import { PointFilterBank, OneEuro, clamp, damp } from './filters.js';
import { accumulate, solve3 } from './HandTransform.js';

export const ARMS = {
  left: { S: 11, E: 13, W: 15, pinky: 17, index: 19, thumb: 21, S2: 12, sign: -1 },
  right: { S: 12, E: 14, W: 16, pinky: 18, index: 20, thumb: 22, S2: 11, sign: 1 },
};
const TRACKED = [0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const HOLD_SECONDS = 0.45;
const SNAP_AFTER_LOSS = 0.8;
const vis = (l) => l.visibility ?? 1;
const inFrame = (l, m = 0.02) => l.x > m && l.x < 1 - m && l.y > m && l.y < 1 - m;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const newFrame = () => ({ pos: new THREE.Vector3(), X: new THREE.Vector3(), Y: new THREE.Vector3(), V: new THREE.Vector3(), q: new THREE.Quaternion(), mirror: 1, flex: 0 });
const newJoints = () => Object.fromEntries(TRACKED.map((i) => [i, new THREE.Vector3()]));

/** Perspective solve on the upper-body landmarks + snapping onto the 2D rays. */
function solveBody(img, world, L, frameW, frameH, f, out) {
  const cx = frameW / 2;
  const cy = frameH / 2;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];
  for (const i of [11, 12, 23, 24, 13, 14, 15, 16]) {
    let w = vis(L[i]);
    if (i >= 23) w *= inFrame(L[i], -0.02) ? 0.8 : 0.1;
    else if (i >= 13) w *= 0.7;
    if (w < 0.05) continue;
    const [X, Y, Z] = world[i];
    const u = img[i][0] * frameW - cx;
    const v = img[i][1] * frameH - cy;
    accumulate(A, b, f, 0, -u, u * Z - f * X, w);
    accumulate(A, b, 0, f, -v, v * Z - f * Y, w);
  }
  const t = solve3(A, b);
  if (!t || t[2] < 0.25 || t[2] > 6) return false;
  for (const i of TRACKED) {
    const z = Math.max(world[i][2] + t[2], 0.1);
    out[i].set(((img[i][0] * frameW - cx) * z) / f, -((img[i][1] * frameH - cy) * z) / f, -z);
  }
  return true;
}

/** Forearm frame from camera-space joints for one arm. */
export function armFrame(J, arm, out) {
  const E = J[arm.E];
  const Y = out.Y.subVectors(J[arm.W], E).normalize();
  const up = _a.subVectors(E, J[arm.S]).normalize();
  out.flex = Math.acos(clamp(up.dot(Y), -1, 1));
  const hinge = _b.crossVectors(up, Y);
  const hl = hinge.length();
  const body = _c.subVectors(J[arm.S], J[arm.S2]).normalize(); // outward
  const w = hl > 1e-4 ? smooth(THREE.MathUtils.degToRad(15), THREE.MathUtils.degToRad(35), out.flex) : 0;
  const X = out.X.copy(body).multiplyScalar(1 - w);
  if (w > 0) X.addScaledVector(hinge.divideScalar(hl), w * arm.sign);
  X.addScaledVector(Y, -X.dot(Y));
  if (X.lengthSq() < 1e-6) X.copy(body).addScaledVector(Y, -body.dot(Y));
  X.normalize();
  out.V.crossVectors(X, Y).multiplyScalar(arm.sign).normalize();
  out.mirror = arm.sign;
  _m.makeBasis(_d.copy(X).multiplyScalar(out.mirror), Y, out.V);
  out.q.setFromRotationMatrix(_m);
  out.pos.copy(E);
  return out;
}

export class ArmTransform {
  constructor() {
    this.hfovDeg = 63;
    this.preference = 'auto'; // 'auto' | 'left' | 'right'
    this.imgBank = new PointFilterBank(2, 1.6, 1.5);
    this.worldBank = new PointFilterBank(3, 1.2, 2.5);
    this.img = Object.fromEntries(TRACKED.map((i) => [i, [0, 0]]));
    this.world = Object.fromEntries(TRACKED.map((i) => [i, [0, 0, 0]]));
    this.rawImg = Object.fromEntries(TRACKED.map((i) => [i, [0, 0]]));
    this.rawWorld = Object.fromEntries(TRACKED.map((i) => [i, [0, 0, 0]]));
    this.posFilter = [new OneEuro(1.6, 0.8), new OneEuro(1.6, 0.8), new OneEuro(1.0, 0.4)];
    this.frame = newFrame();
    this.lostTime = 0;
    this.side = null;
    this.lastE = null;
    this.state = {
      valid: false,
      visible: 0,
      position: new THREE.Vector3(0, 0, -1.2),
      quaternion: new THREE.Quaternion(),
      mirror: 1,
      side: 'right',
      arm: ARMS.right,
      Lf: 0.26,
      joints: newJoints(), // filtered, snapped camera-space joints
      raw: { frame: newFrame(), joints: newJoints() }, // unfiltered, same frame as the mask
      velocity: new THREE.Vector3(),
      quality: 0,
      motion: 0,
      facing: 'outer',
      flexDeg: 0,
      yawDeg: 0,
      flipped: false,
      imgForearm: 0, // forearm length in the image, fraction of the frame diagonal-ish
      armInFrame: false,
      shoulders: false,
    };
  }

  reset() {
    this.imgBank.reset();
    this.worldBank.reset();
    this.posFilter.forEach((p) => p.reset());
    this.state.valid = false;
    this.lostTime = 0;
    this.lastE = null;
  }

  setPreference(p) {
    if (p === this.preference) return;
    this.preference = p;
    this.side = null;
    this.reset();
  }

  /** Which arm wears the strap: the preferred one, else the clearest forearm, with hysteresis. */
  pickSide(L, frameW, frameH) {
    const score = (a) => {
      const e = L[a.E];
      const w = L[a.W];
      if (vis(e) < 0.5 || vis(w) < 0.5 || !inFrame(e) || !inFrame(w, 0)) return 0;
      return vis(e) * vis(w) * Math.hypot((e.x - w.x) * frameW, (e.y - w.y) * frameH);
    };
    if (this.preference !== 'auto') return score(ARMS[this.preference]) > 0 ? this.preference : null;
    const sl = score(ARMS.left);
    const sr = score(ARMS.right);
    if (this.side && score(ARMS[this.side]) > 0) {
      const other = this.side === 'left' ? sr : sl;
      if (other < 1.4 * score(ARMS[this.side])) return this.side;
    }
    if (!sl && !sr) return null;
    return sl >= sr ? 'left' : 'right';
  }

  update(pose, frameW, frameH, dt) {
    const st = this.state;
    const L = pose?.landmarks;
    const shouldersOk = L && vis(L[11]) > 0.5 && vis(L[12]) > 0.5;
    st.shoulders = !!shouldersOk;
    const side = shouldersOk ? this.pickSide(L, frameW, frameH) : null;
    if (!side) {
      this.lostTime += dt;
      st.quality = Math.max(0, st.quality - dt * 3);
      st.armInFrame = false;
      if (this.lostTime > HOLD_SECONDS) {
        st.valid = false;
        st.visible = 0;
      }
      return st;
    }
    if (side !== this.side || this.lostTime > SNAP_AFTER_LOSS || !st.valid) {
      this.reset();
      this.side = side;
    }
    this.lostTime = 0;
    for (const i of TRACKED) {
      const l = L[i];
      const w = pose.world[i];
      this.rawImg[i][0] = l.x;
      this.rawImg[i][1] = l.y;
      this.rawWorld[i][0] = w.x;
      this.rawWorld[i][1] = w.y;
      this.rawWorld[i][2] = w.z;
      this.imgBank.filter(i, this.rawImg[i], dt, this.img[i]);
      this.worldBank.filter(i, this.rawWorld[i], dt, this.world[i]);
    }
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(this.hfovDeg) / 2);
    const okRaw = solveBody(this.rawImg, this.rawWorld, L, frameW, frameH, f, st.raw.joints);
    const ok = solveBody(this.img, this.world, L, frameW, frameH, f, st.joints);
    if (!ok || !okRaw) return st;

    const arm = ARMS[side];
    armFrame(st.joints, arm, this.frame);
    armFrame(st.raw.joints, arm, st.raw.frame);

    const fresh = !st.valid;
    const Lf = st.joints[arm.E].distanceTo(st.joints[arm.W]);
    st.Lf += (Lf - st.Lf) * (fresh ? 1 : damp(6, dt));

    const rp = st.raw.frame.pos;
    if (!fresh && dt > 0 && this._lastRaw) {
      _v.subVectors(rp, this._lastRaw).divideScalar(dt);
      if (_v.length() < 4) st.velocity.lerp(_v, damp(10, dt));
    } else {
      st.velocity.set(0, 0, 0);
    }
    this._lastRaw = (this._lastRaw || new THREE.Vector3()).copy(rp);

    const fp = this.frame.pos;
    st.position.set(this.posFilter[0].filter(fp.x, dt), this.posFilter[1].filter(fp.y, dt), this.posFilter[2].filter(fp.z, dt));
    if (fresh || st.mirror !== this.frame.mirror) st.quaternion.copy(this.frame.q);
    else st.quaternion.slerp(this.frame.q, damp(14 + st.quaternion.angleTo(this.frame.q) * 50, dt));
    st.mirror = this.frame.mirror;
    st.side = side;
    st.arm = arm;
    st.valid = true;
    st.visible = 1;

    // ---- diagnostics ----------------------------------------------------------------------------
    _v.copy(fp).negate().normalize();
    const dX = this.frame.X.dot(_v);
    const dV = this.frame.V.dot(_v);
    st.facing = Math.abs(dX) > Math.abs(dV) ? (dX > 0 ? 'outer' : 'inner') : dV > 0 ? 'front' : 'back';
    st.yawDeg = THREE.MathUtils.radToDeg(Math.atan2(dV, dX));
    st.flexDeg = THREE.MathUtils.radToDeg(this.frame.flex);
    const I = this.img;
    st.imgForearm = Math.hypot((I[arm.E][0] - I[arm.W][0]) * frameW / frameH, I[arm.E][1] - I[arm.W][1]);
    st.armInFrame = inFrame(L[arm.E]) && inFrame(L[arm.W], 0);
    const epx = [I[arm.E][0] * frameW, I[arm.E][1] * frameH];
    const lpx = Math.max(st.imgForearm * frameH, 1);
    if (this.lastE && dt > 0) {
      const sp = Math.hypot(epx[0] - this.lastE[0], epx[1] - this.lastE[1]) / lpx / dt;
      st.motion += (sp - st.motion) * damp(6, dt);
    }
    this.lastE = epx;
    st.quality = clamp(Math.min(vis(L[arm.E]), vis(L[arm.W])) * 0.7 + Math.min(vis(L[11]), vis(L[12])) * 0.3, 0, 1);
    return st;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
