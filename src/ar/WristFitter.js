// Fits the brace to the wearer's wrist and forearm from the person mask (selfie segmenter).
//
// At four levels up the forearm (WRIST_BRACE.levels), the mask is scanned across the projected limb
// axis, in the same frame and with the same camera model as the placement. Each scan gives:
//   - a silhouette half-extent e (metres, via the solved depth),
//   - a centre offset (how far the real limb centre is from the predicted one),
//   - the real centre point in the image (for the forearm direction).
//
// Cross-sections are ellipses (half-width a along the radial axis R, half-thickness b along the dorsal
// axis D). Seen along view direction v, the silhouette half-extent perpendicular to the limb is
//     e^2 = a^2 (R.w)^2 + b^2 (D.w)^2,   w = unit(v x axis)
// which is LINEAR in (a^2, b^2). Every scan adds one row to a small least-squares system per level
// (with exponential forgetting and a weak anatomical prior). Back-of-hand views pin down the width;
// a single turn to the thumb side pins down the thickness.
//
// Robustness: scans run only when the mask agrees with the hand landmarks (an arm held in front of the
// body merges with the torso in the mask, so those frames are ignored); a side that reaches the frame
// border is unseen; and a measurement outside 0.72-1.4x the prior is rejected.
import * as THREE from 'three';
import { WRIST_BRACE as CFG } from '../model/wristBraceConfig.js';
import { priorLevels, SliceTable } from './WristBrace.js';
import { clamp, damp } from './filters.js';

const THR = 128; // mask threshold (0..255)
const LMK = [0, 5, 9, 13, 17]; // landmarks that must sit inside the mask for it to be trusted

export class WristFitter {
  constructor() {
    this.table = new SliceTable();
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.ls = CFG.levels.map(() => ({ n11: 0, n12: 0, n22: 0, r1: 0, r2: 0, w: 0 }));
    this.offset = { x: 0, z: 0 };
    this.forearm = new THREE.Vector3(0, 1, 0);
    this.levels = null; // smoothed output [{a,b}]
    this.reliable = 0; // 0..1, mask agrees with the hand
    this.status = { width: 0, depth: 0, reliable: 0, forearm: 0 };
    this.forearmSeen = 0;
  }

  setEnabled(on) {
    this.enabled = on;
  }

  /** Current fit as rig parameters (skin). */
  rigParams(span) {
    const prior = priorLevels(span);
    if (!this.enabled || !this.levels) return { levels: prior, offset: { x: 0, z: 0 }, forearm: this.forearm };
    return { levels: this.levels, offset: this.offset, forearm: this.forearm };
  }

  solveLevel(i, span) {
    return coupledSolve(this.ls[i], priorLevels(span)[i], CFG.priorDepthRatio[i], 0.72, 1.4);
  }

  /**
   * @param o.mask {data,width,height}; o.st HandTransform state; o.frameW/H; o.hfovDeg; o.dt; o.settle
   */
  update({ mask, st, frameW, frameH, hfovDeg, dt, settle }) {
    const span = st.span;
    const L = st.L;
    if (!this.levels) this.levels = priorLevels(span);
    const frame = st.raw.frame;
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(hfovDeg) / 2);
    const mx = mask.width / frameW;
    const my = mask.height / frameH;
    const fm = f * mx;

    const toCam = (lx, ly, lz, out) =>
      out.copy(frame.pos).addScaledVector(frame.R, lx).addScaledVector(frame.U, ly).addScaledVector(frame.D, lz);
    const proj = (P, out) => {
      const z = -P.z;
      out[0] = (frameW / 2 + (f * P.x) / z) * mx;
      out[1] = (frameH / 2 - (f * P.y) / z) * my;
      return out;
    };
    const sample = (x, y) => {
      const xi = x | 0;
      const yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= mask.width || yi >= mask.height) return -1;
      return mask.data[yi * mask.width + xi];
    };

    // ---- does the mask agree with the hand? -----------------------------------------------------
    let inside = 0;
    for (const i of LMK) {
      proj(st.raw.cam[i], _p2);
      if (sample(_p2[0], _p2[1]) >= THR) inside++;
    }
    const ok = inside >= LMK.length - 1;
    this.reliable += ((ok ? 1 : 0) - this.reliable) * damp(4, dt);
    this.status.reliable = this.reliable;
    if (!ok || this.reliable < 0.5) {
      this.relax(dt, span);
      return;
    }

    // ---- predicted geometry (current estimate) --------------------------------------------------
    const rig = { lm: st.raw.local, span, L, forearm: this.forearm, levels: this.levels, offset: this.offset };
    const T = this.table.build(rig, -1.2 * L, 1.0 * L);
    const prior = priorLevels(span);
    const results = [];
    const lam = settle ? 0.9 : 0.97;

    CFG.levels.forEach((lv, i) => {
      const s = lv * L;
      T.eval(s, 0, 0, 1, _a3, _c3);
      const k = T.k;
      const t = T.t;
      const gl = (arr) => arr[k] + (arr[k + 1] - arr[k]) * t;
      const C = toCam(_c3[0], _c3[1], _c3[2], _C);
      const Rl = _Rl.set(gl(T.rx), gl(T.ry), gl(T.rz));
      const Dl = _Dl.set(gl(T.dx), gl(T.dy), gl(T.dz));
      const Rc = _Rc.copy(frame.R).multiplyScalar(Rl.x).addScaledVector(frame.U, Rl.y).addScaledVector(frame.D, Rl.z).normalize();
      const Dc = _Dc.copy(frame.R).multiplyScalar(Dl.x).addScaledVector(frame.U, Dl.y).addScaledVector(frame.D, Dl.z).normalize();
      const Ax = _Ax.crossVectors(Dc, Rc).normalize(); // limb axis (distal)

      const c2 = proj(C, [0, 0]);
      const a2 = proj(_Q.copy(C).addScaledVector(Ax, 0.02), [0, 0]);
      let ax = a2[0] - c2[0];
      let ay = a2[1] - c2[1];
      const al = Math.hypot(ax, ay);
      if (al < 1e-3) return; // limb pointing at the camera: no usable cross-section
      ax /= al;
      ay /= al;
      const px = -ay; // image perpendicular
      const py = ax;

      // silhouette direction in 3D, sign-matched to +perp
      const W = _W.crossVectors(_V.copy(C).normalize(), Ax).normalize();
      const w2 = proj(_Q.copy(C).addScaledVector(W, 0.01), [0, 0]);
      if ((w2[0] - c2[0]) * px + (w2[1] - c2[1]) * py < 0) W.negate();
      const al2 = Rc.dot(W) ** 2;
      const be2 = Dc.dot(W) ** 2;
      const z = -C.z;
      const cur = this.levels[i];
      const ePred = Math.sqrt(cur.a * cur.a * al2 + cur.b * cur.b * be2);
      const ePrior = Math.sqrt(prior[i].a ** 2 * al2 + prior[i].b ** 2 * be2);
      const expPx = (ePred * fm) / z;
      if (expPx < 3) return; // too small in the mask to measure

      // three parallel scanlines along the axis; median
      const step = (0.04 * L * fm) / z;
      const scans = [];
      for (const d of [-1, 0, 1]) {
        const sx = c2[0] + ax * step * d;
        const sy = c2[1] + ay * step * d;
        const r = scanRun(sample, sx, sy, px, py, expPx * 2.2 + 4);
        if (r) scans.push(r);
      }
      if (scans.length < 2) return;
      const lft = median(scans.map((r) => r.neg));
      const rgt = median(scans.map((r) => r.pos));
      const seenL = scans.filter((r) => r.negSeen).length >= 2;
      const seenR = scans.filter((r) => r.posSeen).length >= 2;
      if (!seenL && !seenR) return;
      let ePx;
      let wgt = 1;
      let offPx = 0;
      if (seenL && seenR) {
        ePx = (lft + rgt) / 2;
        offPx = (rgt - lft) / 2;
      } else {
        // one side unseen (frame edge): mirror the visible side around the predicted centre
        ePx = seenL ? lft : rgt;
        wgt = 0.35;
      }
      const e = (ePx * z) / fm;
      const ratioPrior = e / ePrior;
      if (ratioPrior < 0.72 || ratioPrior > 1.4) return; // merged with the body / a bag / the other arm
      if (Math.abs(e / ePred - 1) > 0.3) wgt *= 0.2; // single-frame outlier vs the running estimate

      const S = this.ls[i];
      S.n11 = lam * S.n11 + wgt * al2 * al2;
      S.n12 = lam * S.n12 + wgt * al2 * be2;
      S.n22 = lam * S.n22 + wgt * be2 * be2;
      S.r1 = lam * S.r1 + wgt * e * e * al2;
      S.r2 = lam * S.r2 + wgt * e * e * be2;
      S.w = lam * S.w + wgt;

      const centre = [c2[0] + px * offPx, c2[1] + py * offPx];
      results.push({ i, centre, offM: (offPx * z) / fm, both: seenL && seenR, W: W.clone(), Rc: Rc.clone(), Dc: Dc.clone() });
    });

    // ---- update the per-level fit (smoothed) -----------------------------------------------------
    const k = settle ? damp(12, dt) : damp(4, dt);
    this.levels = this.levels.map((cur, i) => {
      const sol = this.solveLevel(i, span);
      return { a: cur.a + (sol.a - cur.a) * k, b: cur.b + (sol.b - cur.b) * k };
    });

    // ---- wrist centre offset (level 0, both edges seen): incremental, in the R/D plane ----------
    const w0 = results.find((r) => r.i === 0 && r.both);
    if (w0) {
      const g = settle ? 0.5 : 0.25;
      const ar = w0.Rc.dot(w0.W);
      const ad = w0.Dc.dot(w0.W);
      const lim = 0.25 * span;
      this.offset = {
        x: clamp(this.offset.x + g * w0.offM * ar, -lim, lim),
        z: clamp(this.offset.z + g * w0.offM * ad, -lim, lim),
      };
    }

    // ---- forearm direction from the measured centres ---------------------------------------------
    const ref = results.find((r) => r.i === 0);
    const far = results.filter((r) => r.i > 0);
    if (ref && far.length >= 2) this.fitForearm(ref, far, st, f, frameW, frameH, mx, my, dt, settle);
    else this.forearmSeen = Math.max(0, this.forearmSeen - dt);

    const n11 = this.ls.reduce((m, S) => Math.max(m, S.n11), 0);
    const n22 = this.ls.reduce((m, S) => Math.max(m, S.n22), 0);
    this.status = {
      width: clamp(n11 / 6, 0, 1),
      depth: clamp(n22 / 1.5, 0, 1),
      reliable: this.reliable,
      forearm: clamp(this.forearmSeen, 0, 1),
    };
  }

  fitForearm(ref, far, st, f, frameW, frameH, mx, my, dt, settle) {
    const frame = st.raw.frame;
    let dx = 0;
    let dy = 0;
    for (const r of far) {
      const vx = r.centre[0] - ref.centre[0];
      const vy = r.centre[1] - ref.centre[1];
      const l = Math.hypot(vx, vy);
      if (l < 1) continue;
      dx += vx / l;
      dy += vy / l;
    }
    const dl = Math.hypot(dx, dy);
    if (dl < 1e-3) return;
    dx /= dl;
    dy /= dl;
    // plane through the camera containing the measured image line (proximal direction)
    const ray = (u, v, out) => out.set((u / mx - frameW / 2) / f, -(v / my - frameH / 2) / f, -1).normalize();
    const r0 = ray(ref.centre[0], ref.centre[1], _V);
    const r1 = ray(ref.centre[0] + dx * 20, ref.centre[1] + dy * 20, _Q);
    const Np = _W.crossVectors(r0, r1).normalize();
    // current proximal direction in camera space, projected onto that plane
    const Fl = this.forearm;
    const prox = _Ax.copy(frame.R).multiplyScalar(-Fl.x).addScaledVector(frame.U, -Fl.y).addScaledVector(frame.D, -Fl.z);
    prox.addScaledVector(Np, -prox.dot(Np));
    if (prox.lengthSq() < 0.05) return; // forearm nearly along the view ray: keep the estimate
    prox.normalize();
    // the in-plane solution must point the measured way in the image
    const P0 = st.raw.cam[0];
    const z0 = -P0.z;
    const z1 = -(P0.z + prox.z * 0.05);
    const u0 = (f * P0.x) / z0;
    const v0 = -(f * P0.y) / z0;
    const u1 = (f * (P0.x + prox.x * 0.05)) / z1;
    const v1 = -(f * (P0.y + prox.y * 0.05)) / z1;
    if ((u1 - u0) * dx + (v1 - v0) * dy < 0) return;
    // to local (distal = -prox), limit the bend
    const Fn = _Rl.set(-prox.dot(frame.R), -prox.dot(frame.U), -prox.dot(frame.D)).normalize();
    const maxB = THREE.MathUtils.degToRad(CFG.maxBendDeg);
    const ang = Math.acos(clamp(Fn.y, -1, 1));
    if (ang > maxB) {
      _q.setFromUnitVectors(_Y, Fn);
      _qi.identity().slerp(_q, maxB / ang);
      Fn.set(0, 1, 0).applyQuaternion(_qi);
    }
    this.forearm.lerp(Fn, settle ? damp(15, dt) : damp(8, dt)).normalize();
    this.forearmSeen = Math.min(1.5, this.forearmSeen + dt * 2);
  }

  /** No trustworthy mask: drift gently back to the neutral forearm. */
  relax(dt) {
    this.forearmSeen = Math.max(0, this.forearmSeen - dt);
    if (this.forearmSeen <= 0) this.forearm.lerp(_Y, damp(0.7, dt)).normalize();
  }
}

/**
 * Walk the mask from (x,y) along +-(px,py) until the person mask ends. Gaps up to 2 px are bridged.
 * Returns { pos, neg, posSeen, negSeen } distances in mask pixels (sub-pixel), or null if the start
 * point is outside the mask.
 */
export function scanRun(sample, x, y, px, py, maxPx) {
  const v0 = sample(x, y);
  if (v0 < THR) return null;
  const side = (sgn) => {
    let lastIn = 0;
    let lastVal = v0;
    for (let d = 0.5; d <= maxPx; d += 0.5) {
      const v = sample(x + px * d * sgn, y + py * d * sgn);
      if (v < 0) return { dist: lastIn, seen: false }; // frame border
      if (v >= THR) {
        lastIn = d;
        lastVal = v;
      } else if (d - lastIn > 2) {
        // sub-pixel edge between the last inside sample and the next one
        const vNext = sample(x + px * (lastIn + 0.5) * sgn, y + py * (lastIn + 0.5) * sgn);
        const frac = lastVal > vNext ? (lastVal - THR) / (lastVal - vNext) : 0.5;
        return { dist: lastIn + 0.5 * clamp(frac, 0, 1), seen: true };
      }
    }
    return { dist: lastIn, seen: false }; // ran past the expected width: probably merged
  };
  const a = side(1);
  const b = side(-1);
  return { pos: a.dist, neg: b.dist, posSeen: a.seen, negSeen: b.seen };
}

export function median(a) {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
}

export function solve2(a, b, d, r1, r2) {
  const det = a * d - b * b;
  if (Math.abs(det) < 1e-18) return null;
  return [(d * r1 - b * r2) / det, (a * r2 - b * r1) / det];
}

/**
 * Solve one level's (a^2, b^2) from the normal equations with a weak prior. The shape prior is
 * coupled both ways: an axis the camera has barely seen follows the measured one through the
 * anatomical thickness/width ratio (instead of sitting at the population prior), so a single view
 * already gives a consistent cross-section.
 */
export function coupledSolve(S, p, ratio, lo, hi) {
  const wp = 0.3;
  let Ap = p.a * p.a;
  let Bp = p.b * p.b;
  let sol = solve2(S.n11 + wp, S.n12, S.n22 + wp, S.r1 + wp * Ap, S.r2 + wp * Bp);
  if (!sol) return { a: p.a, b: p.b };
  // which axis is better observed? the other one borrows its prior from it
  const conf = (n) => n / (n + 2);
  const ca = conf(S.n11);
  const cb = conf(S.n22);
  if (cb > ca) Ap = lerp2(Ap, Math.max(sol[1], 1e-6) / (ratio * ratio), cb - ca);
  else Bp = lerp2(Bp, ratio * ratio * Math.max(sol[0], 1e-6), ca - cb);
  sol = solve2(S.n11 + wp, S.n12, S.n22 + wp, S.r1 + wp * Ap, S.r2 + wp * Bp) || sol;
  const a = Math.sqrt(clamp(sol[0], (lo * p.a) ** 2, (hi * p.a) ** 2));
  const b = Math.sqrt(clamp(sol[1], (lo * p.b) ** 2, (hi * p.b) ** 2));
  return { a, b: Math.min(Math.max(b, 0.55 * a), 1.2 * a) };
}
const lerp2 = (x, y, t) => x + (y - x) * t;

const _p2 = [0, 0];
const _a3 = [0, 0, 0];
const _c3 = [0, 0, 0];
const _C = new THREE.Vector3();
const _Q = new THREE.Vector3();
const _V = new THREE.Vector3();
const _W = new THREE.Vector3();
const _Ax = new THREE.Vector3();
const _Rl = new THREE.Vector3();
const _Dl = new THREE.Vector3();
const _Rc = new THREE.Vector3();
const _Dc = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
