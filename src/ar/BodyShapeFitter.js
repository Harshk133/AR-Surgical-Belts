// Fits the brace to the wearer's actual body shape (slim, broad, larger belly …) using the
// person-segmentation mask, so the belt hugs the torso instead of being a uniformly scaled shell.
//
// For every fit level (chest -> hips) and every pose result:
//  1. Project the torso-axis point at that height into the mask with the *same* camera model and the
//     same frame's (unfiltered) pose used for placement.
//  2. Sample the mask along a line perpendicular to the projected spine (valid at any yaw or lean) on
//     3 nearby scanlines, and take the contiguous body run around that point. Both edges are found
//     with sub-pixel interpolation; short low-confidence dips (dark clothing) are bridged. An edge is
//     rejected if the walk reaches an arm (projected shoulder-elbow-wrist capsule) or the frame
//     border first, and the whole measurement is rejected if it is implausibly narrow/wide for the
//     landmark-based body size (merged with an arm, a chair or another person).
//  3. Convert pixels -> metres with the solved depth at that level (pixels * depth / focal). Because
//     size comes from the same perspective model, stepping toward/away from the camera changes the
//     pixel width but not the fitted metric width — the belt shrinks/grows on screen *with* the body.
//  4. The torso cross-section is modelled as an ellipse (half-width a, half-depth b). Its silhouette
//     half-extent at body yaw θ is e = sqrt(a²cos²θ + b²sin²θ). Facing the camera measures a;
//     turning sideways measures b (belly depth). Each is solved from e with the other held fixed and
//     smoothed over time with outlier rejection, so one bad mask frame can't make the belt jump.
//  5. Per-level factors relative to the reference torso (width, front depth, back depth, lateral
//     offset) are smoothed across neighbouring levels and sent to the vertex shader, which reshapes
//     every brace mesh and the body occluder (see BraceModel.applyBraceShader).
import * as THREE from 'three';
import { BRACE_MODEL } from '../model/braceConfig.js';
import { LM } from './TorsoTransform.js';
import { clamp, damp } from './filters.js';

const LEVELS = BRACE_MODEL.fitLevels;
const N = LEVELS.length;
const SCAN_OFFSETS = [-0.014, 0, 0.014]; // m along the torso up-axis
const MASK_ON = 110; // 0..255; the run logic below bridges low-confidence holes (e.g. dark clothing)
const HOLE = 0.03; // m: dips in the mask shorter than this inside the body are treated as holes
const ARM_RADIUS = 0.05; // m (upper arm), forearm uses 0.8x
const BELLY_SHARE = 0.75; // extra depth goes mostly to the front (belly), less to the back

export function refSection(y) {
  const t = BRACE_MODEL.refTorso;
  if (y >= t[0][0]) return toSec(t[0]);
  for (let i = 0; i < t.length - 1; i++) {
    const [y0] = t[i];
    const [y1] = t[i + 1];
    if (y <= y0 && y >= y1) {
      const k = (y0 - y) / (y0 - y1);
      return toSec(t[i].map((v, j) => v + (t[i + 1][j] - v) * k));
    }
  }
  return toSec(t[t.length - 1]);
}
function toSec([y, a, bf, bb, yc]) {
  return { y, a, bf, bb, bh: (bf + bb) / 2, zc: -yc };
}

export function createFitUniforms() {
  return {
    uFitOn: { value: 0 },
    uFitY: { value: Float32Array.from(LEVELS) },
    uFit: { value: LEVELS.map(() => new THREE.Vector4(1, 1, 1, 0)) }, // (width, frontDepth, backDepth, offsetX)
  };
}

export class BodyShapeFitter {
  constructor(uniforms) {
    this.uniforms = uniforms;
    this.ref = LEVELS.map(refSection);
    this.reset();
  }

  reset() {
    this.a = new Array(N).fill(null); // metric half-width
    this.b = new Array(N).fill(null); // metric half-depth
    this.ox = new Array(N).fill(0); // metric lateral offset (+X = wearer's left)
    this.widthObs = new Array(N).fill(0);
    this.depthObs = new Array(N).fill(0);
    this.factors = LEVELS.map(() => ({ w: 1, df: 1, db: 1, ox: 0 }));
    this.uniforms.uFit.value.forEach((v) => v.set(1, 1, 1, 0));
    this.status = { width: 0, depth: 0 }; // fraction of levels with observations
  }

  setEnabled(on) {
    this.uniforms.uFitOn.value = on ? 1 : 0;
  }

  /**
   * @param mask {data, width, height} person mask in source-frame orientation
   * @param st TorsoTransform state (raw pose, scale, joints)
   */
  update({ mask, st, frameW, frameH, hfovDeg, dt, settle }) {
    if (!mask || !st.valid) return;
    const mw = mask.width;
    const mh = mask.height;
    const f = (frameW / 2) / Math.tan(THREE.MathUtils.degToRad(hfovDeg) / 2) * (mw / frameW);
    const cx = mw / 2;
    const cy = mh / 2;
    // The mask is a uniform resample of the frame, so one focal length (in mask pixels) serves both axes.
    const proj = (p, out) => {
      const z = -p.z;
      out.x = cx + (f * p.x) / z;
      out.y = cy - (f * p.y) / z;
      return out;
    };

    const q = st.raw.quaternion;
    const S = st.scale;
    const ax = _ax.set(1, 0, 0).applyQuaternion(q);
    const up = _up.set(0, 1, 0).applyQuaternion(q);
    const fwd = _fw.set(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(fwd.x, fwd.z);
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));

    // arms in mask pixels
    const J = st.joints;
    const arms = [
      [J[LM.leftShoulder], J[LM.leftElbow], 1],
      [J[LM.leftElbow], J[LM.leftWrist], 0.8],
      [J[LM.rightShoulder], J[LM.rightElbow], 1],
      [J[LM.rightElbow], J[LM.rightWrist], 0.8],
    ].map(([p0, p1, r]) => {
      const a0 = proj(p0, { x: 0, y: 0 });
      const a1 = proj(p1, { x: 0, y: 0 });
      const depth = (-p0.z - p1.z) / 2;
      return { a0, a1, r: (ARM_RADIUS * r * f) / depth };
    });

    // fast while calibrating (brace hidden), slower afterwards so the shape stays steady
    const rate = settle ? 6 : 1.5;

    for (let k = 0; k < N; k++) {
      const ref = this.ref[k];
      const local = _l.set(0, LEVELS[k] * S.y, ref.zc * S.z);
      const P = _p.copy(local).applyQuaternion(q).add(st.raw.position);
      const depth = -P.z;
      if (depth < 0.2) continue;
      const ppm = f / depth; // mask pixels per metre at this level
      const e0 = proj(P, _e0);
      const upPx = proj(_p2.copy(P).addScaledVector(up, 0.1), _e2);
      const ux = (upPx.x - e0.x) / 0.1;
      const uy = (upPx.y - e0.y) / 0.1;
      // Scan perpendicular to the projected spine. (The projected shoulder axis collapses to a point
      // in a side view, so it can't be used as the scan direction.) Orient it toward the torso's +X.
      const ul = Math.hypot(ux, uy) || 1;
      let dx = -uy / ul;
      let dy = ux / ul;
      const e1 = proj(_p2.copy(P).addScaledVector(ax, 0.1), _e1);
      if ((e1.x - e0.x) * dx + (e1.y - e0.y) * dy < 0) {
        dx = -dx;
        dy = -dy;
      }
      const maxT = Math.max(ref.a, ref.bh) * Math.max(S.x, 0.5) * 2.4 * ppm;

      // In profile, relaxed arms lie inside the torso outline, so arm rejection is for front/back views.
      const blockers = c > 0.6 ? arms : NO_ARMS;
      const runs = [];
      for (const off of SCAN_OFFSETS) {
        const r = measureRun(mask, e0.x + ux * off, e0.y + uy * off, dx, dy, maxT, blockers, ppm * 0.05, ppm * HOLE);
        if (r) runs.push(r);
      }
      if (!runs.length) continue;
      // median over scanlines, per edge
      const lo = median(runs.filter((r) => r.okL).map((r) => r.L));
      const hi = median(runs.filter((r) => r.okR).map((r) => r.R));
      const okL = lo != null;
      const okR = hi != null;

      let e;
      let weight = 1;
      if (okL && okR) {
        e = (hi - lo) / 2 / ppm; // half-extent of the body run (independent of where the anchor lands)
        const mid = (hi + lo) / 2 / ppm; // run centre relative to the projected spine
        // Facing the camera the outline is near-symmetric about the spine: a big mismatch means the run
        // merged with something (loose clothing flaring out, an object), so trust the nearer edge.
        if (c > 0.75 && Math.abs(mid) > 0.3 * e) {
          e = Math.min(-lo, hi) / ppm;
          weight = 0.5;
        } else if (c > 0.7) {
          this.ox[k] += (mid / Math.max(c, 0.7) - this.ox[k]) * damp(rate, dt);
        }
      } else if (okL || okR) {
        // one edge hidden by an arm: use the visible edge's distance from the spine (symmetry)
        const d = (okL ? -lo : hi) / ppm;
        if (d < 0.6 * ref.a * S.x * (c > 0.8 ? 1 : 0.7)) continue; // anchor too close to that edge
        e = d;
        weight = 0.4;
      } else {
        continue;
      }

      // Plausibility gate against the landmark-based size: a run that merged with an arm, a chair or
      // another person is far wider than any torso of this frame size.
      const prior = Math.sqrt((ref.a * S.x * c) ** 2 + (ref.bh * S.z * s) ** 2);
      if (e < 0.75 * prior || e > 1.75 * prior) continue;
      const aPrior = ref.a * S.x;
      const bPrior = ref.bh * S.z;
      // Solve the ellipse model for the dimension the current view actually shows.
      if (c > 0.8) {
        const b = this.b[k] ?? (this.a[k] != null ? this.a[k] * (ref.bh / ref.a) : bPrior);
        const aObs = Math.sqrt(Math.max(e * e - b * b * s * s, (0.6 * e) ** 2)) / c;
        this.a[k] = blend(this.a[k], aObs, rate, dt, weight);
        this.widthObs[k] = Math.min(this.widthObs[k] + weight, 30);
        if (!this.depthObs[k]) this.b[k] = null; // keep depth tied to width until it is seen
      } else if (s > 0.8) {
        const a = this.a[k] ?? aPrior;
        const bObs = Math.sqrt(Math.max(e * e - a * a * c * c, (0.5 * e) ** 2)) / s;
        this.b[k] = blend(this.b[k], bObs, rate, dt, weight);
        this.depthObs[k] = Math.min(this.depthObs[k] + weight, 30);
      }
    }
    this.computeFactors(S);
  }

  computeFactors(S) {
    const raw = this.ref.map((ref, k) => {
      if (this.a[k] == null) return null;
      const w = this.a[k] / (ref.a * S.x);
      // Depth not observed yet: assume it scales with width (wider waist -> deeper belly).
      const dTot = this.b[k] != null ? this.b[k] / (ref.bh * S.z) : w;
      return { w, dTot, ox: this.ox[k] / S.x };
    });
    // fill gaps from neighbours (e.g. chest levels hidden by arms)
    for (let k = 0; k < N; k++) {
      if (raw[k]) continue;
      let j = 1;
      while (j < N && !raw[k - j] && !raw[k + j]) j++;
      const n = raw[k - j] || raw[k + j];
      raw[k] = n ? { ...n, ox: 0 } : { w: 1, dTot: 1, ox: 0 };
    }
    // light smoothing across levels so the belt edge stays a smooth curve
    for (let k = 0; k < N; k++) {
      const p = raw[Math.max(k - 1, 0)];
      const n = raw[Math.min(k + 1, N - 1)];
      const m = raw[k];
      const w = clamp((p.w + 2 * m.w + n.w) / 4, 0.72, 1.7);
      const dTot = clamp((p.dTot + 2 * m.dTot + n.dTot) / 4, 0.7, 2.0);
      const ref = this.ref[k];
      let df;
      let db;
      if (dTot >= 1) {
        const extra = (dTot - 1) * (ref.bf + ref.bb);
        df = 1 + (BELLY_SHARE * extra) / ref.bf;
        db = 1 + ((1 - BELLY_SHARE) * extra) / ref.bb;
      } else {
        df = db = dTot;
      }
      const ox = clamp((p.ox + 2 * m.ox + n.ox) / 4, -0.04, 0.04);
      this.factors[k] = { w, df, db, ox };
      this.uniforms.uFit.value[k].set(w, df, db, ox);
    }
    this.status = {
      width: this.widthObs.filter((v) => v >= 3).length / N,
      depth: this.depthObs.filter((v) => v >= 3).length / N,
    };
  }
}

function blend(cur, obs, rate, dt, weight) {
  if (cur == null) return obs;
  // outlier rejection: a single frame that disagrees by >30 % moves the estimate only a little
  const rel = Math.abs(obs - cur) / cur;
  const w = rel > 0.3 ? weight * 0.15 : weight;
  return cur + (obs - cur) * damp(rate, dt) * w;
}

/** Bilinear mask sample (0..255), -1 outside the frame. */
function sampleBilinear(mask, x, y) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= mask.width || y0 + 1 >= mask.height) return -1;
  const tx = fx - x0;
  const ty = fy - y0;
  const d = mask.data;
  const w = mask.width;
  const i = y0 * w + x0;
  const top = d[i] + (d[i + 1] - d[i]) * tx;
  const bot = d[i + w] + (d[i + w + 1] - d[i + w]) * tx;
  return top + (bot - top) * ty;
}

/**
 * Samples the whole scan line through (x,y) and returns the contiguous body run that contains the
 * anchor (or the nearest run within `snap` px): { L, R } edge positions in px relative to the anchor
 * (sub-pixel, interpolated where the bilinear mask crosses MASK_ON), and okL / okR flags that are
 * false when that edge is hidden by an arm or lies outside the frame.
 */
function measureRun(mask, x, y, dx, dy, maxT, arms, snap, hole) {
  const step = 0.5;
  const n = Math.ceil(maxT / step);
  const vals = new Float32Array(2 * n + 1);
  const blocked = new Uint8Array(2 * n + 1);
  for (let i = -n; i <= n; i++) {
    const t = i * step;
    const px = x + dx * t;
    const py = y + dy * t;
    const v = sampleBilinear(mask, px, py);
    vals[i + n] = v;
    if (v < 0) blocked[i + n] = 1;
    else for (const a of arms) if (segDist(px, py, a.a0, a.a1) < a.r) { blocked[i + n] = 1; break; }
  }
  // anchor index: the anchor itself, or the nearest body sample within `snap`
  let c = n;
  if (!(vals[c] >= MASK_ON)) {
    const reach = Math.round(snap / step);
    c = -1;
    for (let d = 1; d <= reach && c < 0; d++) {
      if (vals[n + d] >= MASK_ON) c = n + d;
      else if (vals[n - d] >= MASK_ON) c = n - d;
    }
    if (c < 0) return null;
  }
  const edge = (dir) => {
    let i = c;
    while (true) {
      const j = i + dir;
      if (j < 0 || j > 2 * n) return { pos: (i - n) * step, ok: false }; // ran out of scan range
      // reached an arm (or the frame border) before the body edge: this side can't be measured
      if (blocked[j]) return { pos: (i - n) * step, ok: false };
      const v = vals[j];
      if (v < MASK_ON) {
        // An edge only if the outside region persists for `hole` px; shorter dips are holes in the
        // mask (low-confidence clothing), and the body continues after them.
        const holeSteps = Math.max(2, Math.round(hole / step));
        let resume = -1;
        for (let k = 1; k <= holeSteps; k++) {
          const q = j + dir * k;
          if (q < 0 || q > 2 * n || blocked[q]) break; // never bridge into an arm
          if (vals[q] >= MASK_ON) {
            resume = q;
            break;
          }
        }
        if (resume < 0) {
          const a = vals[i];
          const frac = a > v ? (a - MASK_ON) / (a - v) : 0.5;
          return { pos: (i - n + dir * frac) * step, ok: v >= 0 };
        }
        i = resume;
        continue;
      }
      i = j;
    }
  };
  const r = edge(1);
  const l = edge(-1);
  return { L: l.pos, R: r.pos, okL: l.ok, okR: r.ok };
}

function segDist(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - a.x) * vx + (py - a.y) * vy) / l2, 0, 1);
  return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t));
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((p, q) => p - q);
  return s[s.length >> 1];
}

const NO_ARMS = [];
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _l = new THREE.Vector3();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _e0 = { x: 0, y: 0 };
const _e1 = { x: 0, y: 0 };
const _e2 = { x: 0, y: 0 };
