// Fits the strap to the wearer's forearm from the pose person mask. Same method as WristFitter:
// at each strap level, scan the mask across the projected forearm axis (same frame, same camera model
// as the placement), then fit the ellipse silhouette model e^2 = a^2 (X.w)^2 + b^2 (V.w)^2, which is
// linear in (a^2, b^2), by recursive least squares with forgetting + an anatomical prior. Seeing the
// outer side fits one axis, rotating the forearm fits the other. The measured silhouette centre also
// corrects the elbow landmark's sideways error (centre offset in the X/V plane).
import * as THREE from 'three';
import { ELBOW_STRAP as CFG } from '../model/elbowSupportConfig.js';
import { elbowPriorLevels } from './ElbowStrap.js';
import { coupledSolve, scanRun, median } from './WristFitter.js';
import { clamp, damp } from './filters.js';

const THR = 128;

export class ElbowFitter {
  constructor() {
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.ls = CFG.levels.map(() => ({ n11: 0, n12: 0, n22: 0, r1: 0, r2: 0 }));
    this.offset = { x: 0, z: 0 };
    this.levels = null;
    this.reliable = 0;
    this.status = { width: 0, depth: 0, reliable: 0 };
  }

  setEnabled(on) {
    this.enabled = on;
  }

  rigParams(Lf) {
    if (!this.enabled || !this.levels) return { levels: elbowPriorLevels(Lf), offset: { x: 0, z: 0 } };
    return { levels: this.levels, offset: this.offset };
  }

  solveLevel(i, Lf) {
    return coupledSolve(this.ls[i], elbowPriorLevels(Lf)[i], CFG.priorDepthRatio[i], 0.7, 1.45);
  }

  update({ mask, st, frameW, frameH, hfovDeg, dt, settle }) {
    const Lf = st.Lf;
    if (!this.levels) this.levels = elbowPriorLevels(Lf);
    const fr = st.raw.frame;
    const J = st.raw.joints;
    const arm = st.arm;
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(hfovDeg) / 2);
    const mx = mask.width / frameW;
    const my = mask.height / frameH;
    const fm = f * mx;
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

    // ---- does the mask agree with the arm? (elbow, mid-forearm, wrist inside the person) ------
    const mid = _Q.addVectors(J[arm.E], J[arm.W]).multiplyScalar(0.5);
    let inside = 0;
    for (const P of [J[arm.E], mid, J[arm.W]]) {
      proj(P, _p);
      if (sample(_p[0], _p[1]) >= THR) inside++;
    }
    const ok = inside >= 2;
    this.reliable += ((ok ? 1 : 0) - this.reliable) * damp(4, dt);
    this.status.reliable = this.reliable;
    if (!ok || this.reliable < 0.5) return;

    const prior = elbowPriorLevels(Lf);
    const lam = settle ? 0.9 : 0.97;
    const offs = [];
    CFG.levels.forEach((lv, i) => {
      const y = lv * Lf;
      const C = _C.copy(fr.pos).addScaledVector(fr.X, this.offset.x).addScaledVector(fr.Y, y).addScaledVector(fr.V, this.offset.z);
      const c2 = proj(C, [0, 0]);
      const a2 = proj(_Q.copy(C).addScaledVector(fr.Y, 0.02), [0, 0]);
      let ax = a2[0] - c2[0];
      let ay = a2[1] - c2[1];
      const al = Math.hypot(ax, ay);
      if (al < 1e-3) return; // forearm pointing at the camera
      ax /= al;
      ay /= al;
      const px = -ay;
      const py = ax;
      const W = _W.crossVectors(_V.copy(C).normalize(), fr.Y).normalize();
      const w2 = proj(_Q.copy(C).addScaledVector(W, 0.01), [0, 0]);
      if ((w2[0] - c2[0]) * px + (w2[1] - c2[1]) * py < 0) W.negate();
      const al2 = fr.X.dot(W) ** 2;
      const be2 = fr.V.dot(W) ** 2;
      const z = -C.z;
      const cur = this.levels[i];
      const ePred = Math.sqrt(cur.a ** 2 * al2 + cur.b ** 2 * be2);
      const ePrior = Math.sqrt(prior[i].a ** 2 * al2 + prior[i].b ** 2 * be2);
      const expPx = (ePred * fm) / z;
      if (expPx < 3) return;
      const step = (0.03 * Lf * fm) / z;
      const scans = [];
      for (const d of [-1, 0, 1]) {
        const r = scanRun(sample, c2[0] + ax * step * d, c2[1] + ay * step * d, px, py, expPx * 2.2 + 4);
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
      if (seenL && seenR) {
        ePx = (lft + rgt) / 2;
        offs.push({ d: (((rgt - lft) / 2) * z) / fm, ax: fr.X.dot(W), av: fr.V.dot(W) });
      } else {
        ePx = seenL ? lft : rgt;
        wgt = 0.35;
      }
      const e = (ePx * z) / fm;
      const rp = e / ePrior;
      if (rp < 0.7 || rp > 1.45) return; // merged with the torso / another arm
      if (Math.abs(e / ePred - 1) > 0.3) wgt *= 0.2;
      const S = this.ls[i];
      S.n11 = lam * S.n11 + wgt * al2 * al2;
      S.n12 = lam * S.n12 + wgt * al2 * be2;
      S.n22 = lam * S.n22 + wgt * be2 * be2;
      S.r1 = lam * S.r1 + wgt * e * e * al2;
      S.r2 = lam * S.r2 + wgt * e * e * be2;
    });

    const k = settle ? damp(12, dt) : damp(4, dt);
    this.levels = this.levels.map((cur, i) => {
      const s = this.solveLevel(i, Lf);
      return { a: cur.a + (s.a - cur.a) * k, b: cur.b + (s.b - cur.b) * k };
    });
    if (offs.length) {
      const g = (settle ? 0.5 : 0.25) / offs.length;
      const lim = 0.08 * Lf;
      let x = this.offset.x;
      let zz = this.offset.z;
      for (const o of offs) {
        x += g * o.d * o.ax;
        zz += g * o.d * o.av;
      }
      this.offset = { x: clamp(x, -lim, lim), z: clamp(zz, -lim, lim) };
    }
    // which axis the camera sees depends on how the forearm is turned, so report
    // "outline fitted" (either axis) and "thickness fitted" (both axes)
    const n11 = this.ls.reduce((m, S) => Math.max(m, S.n11), 0);
    const n22 = this.ls.reduce((m, S) => Math.max(m, S.n22), 0);
    const c1 = clamp(n11 / 4, 0, 1);
    const c2 = clamp(n22 / 4, 0, 1);
    this.status = { width: Math.max(c1, c2), depth: Math.min(c1, c2) * 2 > 1 ? 1 : Math.min(c1, c2) * 2, reliable: this.reliable };
  }
}

const _p = [0, 0];
const _C = new THREE.Vector3();
const _Q = new THREE.Vector3();
const _V = new THREE.Vector3();
const _W = new THREE.Vector3();
