// Procedural thumb wrist brace, rebuilt every frame on the wearer's own hand.
//
// Everything is expressed in the local hand frame (see HandTransform): origin = wrist, +Y distal,
// +X radial (thumb side), +Z dorsal. The renderer places the frame (mirrored for right hands).
//
// The limb is described by a table of cross-sections along the arm axis s:
//   - forearm (s < 0): ellipses whose half-width / half-thickness come from the outline fitter
//     (or anatomical priors), on an axis that bends toward the measured forearm direction;
//   - palm (s > 0): rounded-rectangle sections whose radial / ulnar / dorsal / palmar extents come
//     straight from the knuckle landmarks, so the distal edge hugs this hand.
// The neoprene sleeve, the strap, the bindings and the depth-only skin occluder are all evaluated on
// that one table, so they can never disagree with each other. The thumb sleeve is a tube swept along
// the tracked thumb joints (CMC -> MCP -> toward IP), so it follows the real thumb.
import * as THREE from 'three';
import { WRIST_BRACE as CFG } from '../model/wristBraceConfig.js';
import { applyBraceShader, occluderMaterial } from './BraceModel.js';

const TAU = Math.PI * 2;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

// ---------------------------------------------------------------------------------------------
// Grid surface with fixed topology; positions are rewritten each frame, normals by central
// differences (seamless across closed directions). Winding/normal convention: u runs around the
// limb from +X toward +Z, v runs distally, outward normal = dP/dv x dP/du.
// ---------------------------------------------------------------------------------------------
export class Grid {
  constructor(nu, nv, { closedU = false, closedV = false, uScale = 1, vScale = 1 } = {}) {
    this.nu = nu;
    this.nv = nv;
    this.closedU = closedU;
    this.closedV = closedV;
    const n = nu * nv;
    this.pos = new Float32Array(n * 3);
    this.nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        uv[k * 2] = (i / (nu - 1)) * uScale;
        uv[k * 2 + 1] = (j / (nv - 1)) * vScale;
      }
    }
    const idx = [];
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nu - 1; i++) {
        const a = j * nu + i;
        const b = (j + 1) * nu + i;
        const c = a + 1;
        const d = b + 1;
        idx.push(a, b, c, c, b, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.norAttr = new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.norAttr);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10); // meshes are never culled; skip per-frame bounds
    this.geometry = g;
  }

  set(i, j, x, y, z) {
    const k = (j * this.nu + i) * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
  }

  finish() {
    const { nu, nv, pos, nor } = this;
    for (let j = 0; j < nv; j++) {
      const jp = (j > 0 ? j - 1 : this.closedV ? nv - 2 : 0) * nu;
      const jn = (j < nv - 1 ? j + 1 : this.closedV ? 1 : nv - 1) * nu;
      const jr = j * nu;
      for (let i = 0; i < nu; i++) {
        const ip = (jr + (i > 0 ? i - 1 : this.closedU ? nu - 2 : 0)) * 3;
        const inn = (jr + (i < nu - 1 ? i + 1 : this.closedU ? 1 : nu - 1)) * 3;
        const vp = (jp + i) * 3;
        const vn = (jn + i) * 3;
        const ux = pos[inn] - pos[ip];
        const uy = pos[inn + 1] - pos[ip + 1];
        const uz = pos[inn + 2] - pos[ip + 2];
        const vx = pos[vn] - pos[vp];
        const vy = pos[vn + 1] - pos[vp + 1];
        const vz = pos[vn + 2] - pos[vp + 2];
        const nx = vy * uz - vz * uy;
        const ny = vz * ux - vx * uz;
        const nz = vx * uy - vy * ux;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const k = (jr + i) * 3;
        if (l > 1e-12) {
          nor[k] = nx / l;
          nor[k + 1] = ny / l;
          nor[k + 2] = nz / l;
        } else {
          nor[k] = NaN; // degenerate (pole): filled from a neighbour below
        }
      }
    }
    // poles / collapsed ends take the neighbouring row's or column's normal
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const k = (j * nu + i) * 3;
        if (!Number.isNaN(nor[k])) continue;
        const src = i > 0 ? k - 3 : j > 0 ? k - nu * 3 : k + 3;
        nor[k] = Number.isNaN(nor[src]) ? 0 : nor[src];
        nor[k + 1] = Number.isNaN(nor[src]) ? 0 : nor[src + 1];
        nor[k + 2] = Number.isNaN(nor[src]) ? 1 : nor[src + 2];
      }
    }
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Cross-section table along the limb.
// ---------------------------------------------------------------------------------------------
const FIELDS = ['cx', 'cy', 'cz', 'rx', 'ry', 'rz', 'dx', 'dy', 'dz', 'er', 'eu', 'ed', 'ep', 'n_'];
const N_NEG = 90;
const N_POS = 40;

export class SliceTable {
  constructor() {
    this.n = N_NEG + N_POS;
    this.s = new Float32Array(this.n);
    for (const f of FIELDS) this[f] = new Float32Array(this.n);
    this._q = new THREE.Quaternion();
    this._qf = new THREE.Quaternion();
    this._id = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /** rig: { lm, span, L, forearm, levels:[{a,b}], offset:{x,z} } */
  build(rig, sMin, sMax) {
    const { lm, span, L } = rig;
    this.sMin = sMin;
    this.sMax = sMax;
    this.L = L;
    // samples: N_NEG on [sMin, 0], N_POS on (0, sMax]
    for (let k = 0; k < N_NEG; k++) this.s[k] = sMin * (1 - k / (N_NEG - 1));
    for (let k = 0; k < N_POS; k++) this.s[N_NEG + k] = (sMax * (k + 1)) / N_POS;

    // palm extents from the knuckles (skin)
    const zc = (lm[5].z + lm[9].z + lm[13].z + lm[17].z) / 4;
    const erM = lm[5].x + 0.17 * span;
    const euM = -lm[17].x + 0.17 * span;
    const edM = zc + 0.16 * span;
    const epM = -zc + 0.27 * span;
    const sM = Math.max((lm[5].y + lm[17].y) / 2, 0.4 * L);

    const lv = CFG.levels.map((x) => x * L);
    const A = rig.levels.map((x) => x.a);
    const B = rig.levels.map((x) => x.b);
    const last = lv.length - 1;
    const slopeA = Math.min(0.2, Math.max(0, (A[last] - A[last - 1]) / (lv[last - 1] - lv[last])));
    const slopeB = Math.min(0.2, Math.max(0, (B[last] - B[last - 1]) / (lv[last - 1] - lv[last])));

    this._qf.setFromUnitVectors(Y, rig.forearm);
    const ox = rig.offset.x;
    const oz = rig.offset.z;

    for (let k = 0; k < this.n; k++) {
      const s = this.s[k];
      // orientation: hand frame for s >= 0, bending smoothly to the forearm over 0.3 L
      const w = smooth(0, -0.3 * L, s);
      this._q.slerpQuaternions(this._id, this._qf, w);
      this._v.set(1, 0, 0).applyQuaternion(this._q);
      this.rx[k] = this._v.x; this.ry[k] = this._v.y; this.rz[k] = this._v.z;
      this._v.set(0, 0, 1).applyQuaternion(this._q);
      this.dx[k] = this._v.x; this.dy[k] = this._v.y; this.dz[k] = this._v.z;

      let er, eu, ed, ep, n;
      if (s > 0) {
        const t = smooth(0, sM, s);
        er = lerp(A[0], erM, t);
        eu = lerp(A[0], euM, t);
        ed = lerp(B[0], edM, t);
        ep = lerp(B[0], epM, t);
        n = lerp(2, 2.6, t);
      } else if (s >= lv[0]) {
        er = eu = A[0];
        ed = ep = B[0];
        n = 2;
      } else if (s >= lv[last]) {
        let i = 0;
        while (s < lv[i + 1]) i++;
        const t = (lv[i] - s) / (lv[i] - lv[i + 1]);
        er = eu = lerp(A[i], A[i + 1], t);
        ed = ep = lerp(B[i], B[i + 1], t);
        n = 2;
      } else {
        const d = lv[last] - s;
        er = eu = A[last] + slopeA * d;
        ed = ep = B[last] + slopeB * d;
        n = 2;
      }
      this.er[k] = er; this.eu[k] = eu; this.ed[k] = ed; this.ep[k] = ep; this.n_[k] = n;
    }

    // centre line: straight along +Y in the hand; integrated along the bent axis on the forearm.
    // The wrist offset (outline fit) applies on the forearm and fades out across the palm.
    const k0 = N_NEG - 1; // s = 0
    for (let k = k0; k < this.n; k++) {
      const fade = 1 - smooth(0, 0.4 * L, this.s[k]);
      this.cx[k] = ox * fade;
      this.cy[k] = this.s[k];
      this.cz[k] = oz * fade;
    }
    for (let k = k0 - 1; k >= 0; k--) {
      const ds = this.s[k + 1] - this.s[k];
      // axis direction = rotated +Y (average of both ends)
      const ax = (axisX(this, k) + axisX(this, k + 1)) / 2;
      const ay = (axisY(this, k) + axisY(this, k + 1)) / 2;
      const az = (axisZ(this, k) + axisZ(this, k + 1)) / 2;
      this.cx[k] = this.cx[k + 1] - ax * ds;
      this.cy[k] = this.cy[k + 1] - ay * ds;
      this.cz[k] = this.cz[k + 1] - az * ds;
    }
    return this;
  }

  /** Sets this.k / this.t (segment + fraction) for s; samples are uniform on each side of 0. */
  index(s) {
    let f;
    if (s <= 0) f = (1 - s / this.sMin) * (N_NEG - 1);
    else f = Math.max((s / this.sMax) * N_POS - 1 + N_NEG, N_NEG - 1);
    const k = Math.min(Math.max(Math.floor(f), 0), this.n - 2);
    this.k = k;
    this.t = Math.min(Math.max(f - k, 0), 1);
  }

  /** Point on the section at s, angle th (0 = radial, +90deg = dorsal), extents*girth + off. */
  eval(s, th, off, girth, out, centerOut) {
    this.index(s);
    const k = this.k;
    const t = this.t;
    const k1 = k + 1;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const nn = this.n_[k] + (this.n_[k1] - this.n_[k]) * t;
    const ex = (c >= 0 ? this.er[k] + (this.er[k1] - this.er[k]) * t : this.eu[k] + (this.eu[k1] - this.eu[k]) * t) * girth + off;
    const ez = (sn >= 0 ? this.ed[k] + (this.ed[k1] - this.ed[k]) * t : this.ep[k] + (this.ep[k1] - this.ep[k]) * t) * girth + off;
    // superellipse; exponent 1 (n = 2) is the common case: skip the pow
    const x = nn === 2 ? c * ex : spow(c, 2 / nn) * ex;
    const z = nn === 2 ? sn * ez : spow(sn, 2 / nn) * ez;
    const L = (a) => a[k] + (a[k1] - a[k]) * t;
    const cx = L(this.cx);
    const cy = L(this.cy);
    const cz = L(this.cz);
    out[0] = cx + L(this.rx) * x + L(this.dx) * z;
    out[1] = cy + L(this.ry) * x + L(this.dy) * z;
    out[2] = cz + L(this.rz) * x + L(this.dz) * z;
    if (centerOut) {
      centerOut[0] = cx;
      centerOut[1] = cy;
      centerOut[2] = cz;
    }
    return out;
  }
}

// axis (rotated +Y) = D x R for our frame (R x Y = D  =>  Y = D x R)
const axisX = (T, k) => T.dy[k] * T.rz[k] - T.dz[k] * T.ry[k];
const axisY = (T, k) => T.dz[k] * T.rx[k] - T.dx[k] * T.rz[k];
const axisZ = (T, k) => T.dx[k] * T.ry[k] - T.dy[k] * T.rx[k];
const Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------------------
// Textures (generated once; colours are baked in, materials stay white)
// ---------------------------------------------------------------------------------------------
let TEX = null;
export function canvasTex(w, h, draw, { color = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Loop-knit neoprene: fine rows of loops plus low-frequency mottling. Returns height (0..1). */
export function knitHeight(w, h, seed) {
  const r = rand(seed);
  const H = new Float32Array(w * h);
  const coarse = Array.from({ length: 16 * 16 }, r);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * 16;
      const gy = (y / h) * 16;
      const x0 = Math.floor(gx) % 16;
      const y0 = Math.floor(gy) % 16;
      const fx = gx - Math.floor(gx);
      const fy = gy - Math.floor(gy);
      const c00 = coarse[y0 * 16 + x0];
      const c10 = coarse[y0 * 16 + ((x0 + 1) % 16)];
      const c01 = coarse[((y0 + 1) % 16) * 16 + x0];
      const c11 = coarse[((y0 + 1) % 16) * 16 + ((x0 + 1) % 16)];
      const mott = lerp(lerp(c00, c10, fx), lerp(c01, c11, fx), fy);
      // interlocking loops: offset rows of small bumps
      const row = Math.floor(y / 4);
      const lx = ((x + (row % 2) * 2) % 4) - 1.5;
      const ly = (y % 4) - 1.5;
      const loop = Math.max(0, 1 - (lx * lx + ly * ly * 1.6) / 4.5);
      H[y * w + x] = 0.55 * loop + 0.25 * mott + 0.2 * r();
    }
  }
  return H;
}

export function heightToNormalTex(H, w, h, strength) {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const hx = H[y * w + ((x + 1) % w)] - H[y * w + ((x - 1 + w) % w)];
        const hy = H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x];
        let nx = -hx * strength;
        let ny = -hy * strength;
        const l = Math.hypot(nx, ny, 1);
        const k = (y * w + x) * 4;
        img.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        img.data[k + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { color: false });
}

export function fabricMap(H, w, h, base, spread, decorate) {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 1 + (H[i] - 0.45) * spread;
      img.data[i * 4] = Math.min(255, base[0] * v);
      img.data[i * 4 + 1] = Math.min(255, base[1] * v);
      img.data[i * 4 + 2] = Math.min(255, base[2] * v);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    decorate?.(ctx, w, h);
  });
}

export function stitchLine(ctx, x0, y0, x1, y1, color = 'rgba(120,124,130,0.85)', dash = [7, 5], width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function textures() {
  if (TEX) return TEX;
  const W = 256;
  const H1 = knitHeight(W, W, 7);
  const H2 = knitHeight(W, 128, 11);
  const H3 = knitHeight(512, 128, 13);
  TEX = {
    knit: fabricMap(H1, W, W, [31, 33, 37], 0.55),
    knitN: heightToNormalTex(H1, W, W, 2.2),
    strap: fabricMap(H2, W, 128, [40, 43, 48], 0.5, (ctx, w, h) => {
      stitchLine(ctx, 0, h * 0.12, w, h * 0.12);
      stitchLine(ctx, 0, h * 0.88, w, h * 0.88);
    }),
    strapN: heightToNormalTex(H2, W, 128, 2),
    tab: fabricMap(H3, 512, 128, [47, 51, 57], 0.45, (ctx, w, h) => {
      stitchLine(ctx, 0, h * 0.1, w, h * 0.1, 'rgba(150,155,162,0.9)');
      stitchLine(ctx, 0, h * 0.9, w, h * 0.9, 'rgba(150,155,162,0.9)');
    }),
    tabN: heightToNormalTex(H3, 512, 128, 1.6),
    binding: canvasTex(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#141518';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        ctx.fillStyle = y % 4 ? '#18191c' : '#111214';
        ctx.fillRect(0, y, w, 1);
      }
      // stitch on the outer face (u = 0 / 1)
      stitchLine(ctx, 3, 0, 3, h, 'rgba(110,114,120,0.9)', [9, 5], 3);
      stitchLine(ctx, w - 3, 0, w - 3, h, 'rgba(110,114,120,0.9)', [9, 5], 3);
    }),
    label: canvasTex(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f4f4f1';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d63a3a';
      ctx.beginPath();
      ctx.arc(52, h / 2, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(47, h / 2 - 15, 10, 30);
      ctx.fillRect(37, h / 2 - 5, 30, 10);
      ctx.fillStyle = '#7a5a2a';
      ctx.font = 'italic 600 40px Georgia, serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('DaynoR', 90, h / 2 + 2);
    }, { repeat: false }),
  };
  return TEX;
}

// ---------------------------------------------------------------------------------------------
// Rig helpers
// ---------------------------------------------------------------------------------------------

/** Anatomical prior for the forearm levels, scaled by the knuckle span. */
export function priorLevels(span) {
  return CFG.levels.map((_, i) => {
    const a = CFG.priorHalfWidth[i] * span;
    return { a, b: a * CFG.priorDepthRatio[i] };
  });
}

/** A neutral adult left hand in the local frame (metres). Used by the 3D inspector. */
export function canonicalRig() {
  const P = [
    [0, 0, 0],
    [0.024, 0.028, -0.012], [0.044, 0.057, -0.022], [0.058, 0.082, -0.027], [0.069, 0.104, -0.03],
    [0.022, 0.09, 0], [0.026, 0.13, -0.006], [0.028, 0.155, -0.012], [0.029, 0.175, -0.018],
    [0, 0.093, 0], [0, 0.138, -0.006], [0, 0.166, -0.012], [0, 0.188, -0.018],
    [-0.02, 0.087, 0], [-0.023, 0.128, -0.006], [-0.025, 0.153, -0.012], [-0.026, 0.173, -0.017],
    [-0.038, 0.077, -0.002], [-0.043, 0.107, -0.007], [-0.046, 0.126, -0.011], [-0.048, 0.143, -0.015],
  ];
  const lm = P.map((p) => new THREE.Vector3(...p));
  const span = lm[5].distanceTo(lm[17]);
  return { lm, span, L: lm[9].length(), forearm: new THREE.Vector3(0, 1, 0), levels: priorLevels(span), offset: { x: 0, z: 0 }, girth: 1 };
}

// ---------------------------------------------------------------------------------------------
// The brace
// ---------------------------------------------------------------------------------------------
const FINGERS = [
  [5, 6, 7, 8, 0.125, 0.095],
  [9, 10, 11, 12, 0.13, 0.095],
  [13, 14, 15, 16, 0.125, 0.09],
  [17, 18, 19, 20, 0.11, 0.08],
];
const THUMB_OCC = [1, 2, 3, 4, 0.2, 0.12];

const NT = 72; // samples around the sleeve
const NS = 34; // samples along the sleeve

export class WristBrace {
  /**
   * mode 'ar': occluders are depth-only, brace materials clip to the person mask.
   * mode 'inspect': the occluder becomes a visible skin mannequin.
   */
  constructor({ mode = 'ar', maskUniforms = null, occluderOnly = false } = {}) {
    this.mode = mode;
    this.occluderOnly = occluderOnly; // the other hand: skin only
    this.root = new THREE.Group();
    this.root.name = 'ThumbWristBrace';
    this.occluder = new THREE.Group();
    this.occluder.name = 'BodyOccluder';
    this.table = new SliceTable();
    this.thumbCurve = new THREE.CatmullRomCurve3([0, 1, 2, 3].map(() => new THREE.Vector3()), false, 'centripetal');
    const T = textures();
    const fabric = (map, normalMap, extra = {}) =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        normalMap,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.93,
        metalness: 0,
        sheen: 1,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(0x4c535c),
        ...extra,
      });
    this.materials = {
      sleeve: fabric(T.knit, T.knitN),
      strap: fabric(T.strap, T.strapN),
      tab: fabric(T.tab, T.tabN, { sheenColor: new THREE.Color(0x5c636c) }),
      binding: new THREE.MeshStandardMaterial({ map: T.binding, roughness: 0.7, metalness: 0 }),
      label: new THREE.MeshStandardMaterial({ map: T.label, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    if (mode === 'ar') {
      for (const m of Object.values(this.materials)) applyBraceShader(m, { maskUniforms, clip: !!maskUniforms });
    }
    const skin =
      mode === 'ar'
        ? occluderMaterial()
        : new THREE.MeshStandardMaterial({ color: 0xd6b49b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    this.skinMaterial = skin;

    const add = (name, grid, mat, parent = this.root) => {
      const mesh = new THREE.Mesh(grid.geometry, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      if (parent === this.occluder) mesh.renderOrder = -1;
      parent.add(mesh);
      return grid;
    };

    this.g = {
      sleeve: add('Sleeve', new Grid(NT + 1, NS, { closedU: true, uScale: 6, vScale: 4 }), this.materials.sleeve),
      thumb: add('ThumbSleeve', new Grid(41, 22, { closedU: true, uScale: 3, vScale: 2 }), this.materials.sleeve),
      bindProx: add('Binding_Proximal', new Grid(9, NT + 1, { closedU: true, closedV: true, vScale: 18 }), this.materials.binding),
      bindDist: add('Binding_Distal', new Grid(9, NT + 1, { closedU: true, closedV: true, vScale: 18 }), this.materials.binding),
      bindThumb: add('Binding_Thumb', new Grid(9, 41, { closedU: true, closedV: true, vScale: 8 }), this.materials.binding),
      strap: add('WristStrap', new Grid(NT + 1, 12, { closedU: true, uScale: 6 }), this.materials.strap),
      tab: add('StrapTab', new Grid(40, 12), this.materials.tab),
      label: add('Label', new Grid(6, 6), this.materials.label),
      limb: add('Limb', new Grid(49, 40, { closedU: true }), skin, this.occluder),
      thumbOcc: add('ThumbSkin', new Grid(17, 20, { closedU: true }), skin, this.occluder),
      fingers: FINGERS.map((f, i) => add(`Finger${i}`, new Grid(17, 20, { closedU: true }), skin, this.occluder)),
    };
    this._p = [0, 0, 0];
    this._c = [0, 0, 0];
    this._loop = new Float32Array((NT + 1) * 6);
    this._v = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  /**
   * rig: { lm[21] (local, skin joints), span, L, forearm (unit, local), levels [{a,b}] skin half-
   * width / half-thickness at CFG.levels, offset {x,z}, girth }
   */
  update(rig) {
    const { span, L } = rig;
    const girth = rig.girth ?? 1;
    const neo = CFG.neoprene * span;
    const tbl = this.table.build(rig, -2.2 * L, 1.0 * L);
    if (this.occluderOnly) {
      this.updateOccluder(rig, tbl);
      return;
    }
    const p = this._p;
    const c = this._c;
    const sp = CFG.proximalEdge * L;
    const de = CFG.distalEdge;
    const sd = (th) => L * ((de.radial + de.ulnar) / 2 + ((de.radial - de.ulnar) / 2) * Math.cos(th) + (Math.sin(th) >= 0 ? de.dorsal - (de.radial + de.ulnar) / 2 : (de.radial + de.ulnar) / 2 - de.palmar) * Math.sin(th));

    // ---- sleeve ------------------------------------------------------------------------------
    const gs = this.g.sleeve;
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU;
      const s1 = sd(th);
      for (let j = 0; j < NS; j++) {
        const s = sp + ((s1 - sp) * j) / (NS - 1);
        tbl.eval(s, th, neo, girth, p);
        gs.set(i, j, p[0], p[1], p[2]);
      }
    }
    gs.finish();

    // ---- edge bindings (centred on the neoprene edge so they wrap it) --------------------------
    this.edgeLoop(this.g.bindProx, () => sp, neo * 0.5, girth, CFG.binding * span);
    this.edgeLoop(this.g.bindDist, sd, neo * 0.5, girth, CFG.binding * span);

    // ---- wrist strap: raised band with bevelled edges -----------------------------------------
    const st = CFG.strap;
    const s0 = st.from * L;
    const s1 = st.to * L;
    const lift = CFG.strapLift * span;
    const bev = 0.03 * L;
    const strapRows = (j, rows) => {
      if (j === 0) return [s0, neo];
      if (j === rows - 1) return [s1, neo];
      const t = (j - 1) / (rows - 3);
      return [lerp(s0 + bev, s1 - bev, t), neo + lift];
    };
    const gst = this.g.strap;
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU;
      for (let j = 0; j < gst.nv; j++) {
        const [s, off] = strapRows(j, gst.nv);
        tbl.eval(s, th, off, girth, p);
        gst.set(i, j, p[0], p[1], p[2]);
      }
    }
    gst.finish();

    // ---- strap tab: overlapping end with a rounded tip, rising out of the band -----------------
    const gt = this.g.tab;
    const thE = THREE.MathUtils.degToRad(st.tabEndDeg);
    const thA = thE - THREE.MathUtils.degToRad(st.tabSpanDeg);
    const midS = (s0 + s1) / 2;
    const half = (s1 - s0) * 0.47;
    tbl.eval(midS, thE, neo + lift, girth, p, c);
    const rAvg = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    const rho = Math.min(half / Math.max(rAvg, 1e-4), (thE - thA) * 0.45); // angular radius of the round end
    for (let i = 0; i < gt.nu; i++) {
      const u = i / (gt.nu - 1);
      const th = lerp(thA, thE, u);
      const round = th > thE - rho ? Math.sqrt(Math.max(0, 1 - ((th - (thE - rho)) / rho) ** 2)) : 1;
      const rise = smooth(0, 0.18, u);
      for (let j = 0; j < gt.nv; j++) {
        const edge = j === 0 || j === gt.nv - 1;
        const vj = edge ? (j === 0 ? 0 : 1) : 0.04 + (0.92 * (j - 1)) / (gt.nv - 3);
        const s = midS + (vj - 0.5) * 2 * half * round;
        const off = neo + lift + (edge ? 0 : lift * 1.1 * rise);
        tbl.eval(s, th, off, girth, p);
        gt.set(i, j, p[0], p[1], p[2]);
      }
    }
    gt.finish();

    // ---- label on the ulnar side near the proximal edge ---------------------------------------
    const gl = this.g.label;
    for (let i = 0; i < gl.nu; i++) {
      const th = Math.PI + THREE.MathUtils.degToRad(lerp(-10, 10, i / (gl.nu - 1)));
      for (let j = 0; j < gl.nv; j++) {
        const s = sp + L * lerp(0.05, 0.16, j / (gl.nv - 1));
        tbl.eval(s, th, neo + 0.004 * span, girth, p);
        gl.set(i, j, p[0], p[1], p[2]);
      }
    }
    gl.finish();

    // ---- thumb sleeve along the tracked thumb ---------------------------------------------------
    const lm = rig.lm;
    const pts = this.thumbCurve.points;
    pts[0].copy(lm[1]).lerp(lm[2], CFG.thumbStart);
    pts[1].copy(lm[1]);
    pts[2].copy(lm[2]);
    pts[3].copy(lm[2]).lerp(lm[3], CFG.thumbEnd);
    const radius = (t) => {
      const r = [0.24, 0.22, 0.165, 0.145];
      const f = Math.min(t * 3, 2.999);
      const k = Math.floor(f);
      return lerp(r[k], r[k + 1], f - k) * span;
    };
    this.tube(this.g.thumb, this.thumbCurve, (t) => radius(t) * girth + neo, (t) => -0.06 * span * (1 - smooth(0, 0.66, t)));
    this.tubeEndRing(this.g.bindThumb, this.thumbCurve, radius(1) * girth + neo * 0.5, CFG.binding * span);

    this.updateOccluder(rig, tbl);
  }

  /** Depth-only skin: forearm + palm, thumb and finger capsules (visible mannequin in inspect mode). */
  updateOccluder(rig, tbl) {
    const { span, L, lm } = rig;
    const p = this._p;
    // ---- skin occluders -------------------------------------------------------------------------
    const gl2 = this.g.limb;
    const sTop = Math.max((lm[5].y + lm[17].y) / 2, 0.4 * L) + 0.03 * L;
    for (let i = 0; i < gl2.nu; i++) {
      const th = (i / (gl2.nu - 1)) * TAU;
      for (let j = 0; j < gl2.nv; j++) {
        const s = lerp(-2.2 * L, sTop, j / (gl2.nv - 1));
        tbl.eval(s, th, -0.01 * span, 1, p);
        gl2.set(i, j, p[0], p[1], p[2]);
      }
    }
    gl2.finish();
    this.chain(this.g.thumbOcc, THUMB_OCC, lm, span);
    FINGERS.forEach((f, i) => this.chain(this.g.fingers[i], f, lm, span));
  }

  /** Closed binding tube along a sleeve edge s = sFn(theta). */
  edgeLoop(grid, sFn, off, girth, r) {
    const loop = this._loop;
    const p = this._p;
    const c = this._c;
    for (let k = 0; k <= NT; k++) {
      const th = (k / NT) * TAU;
      this.table.eval(sFn(th), th, off, girth, p, c);
      loop.set([p[0], p[1], p[2], p[0] - c[0], p[1] - c[1], p[2] - c[2]], k * 6);
    }
    const T = this._t;
    const A = this._a;
    const B = this._b;
    for (let k = 0; k <= NT; k++) {
      const kp = (k - 1 + NT) % NT;
      const kn = (k + 1) % NT;
      T.set(loop[kn * 6] - loop[kp * 6], loop[kn * 6 + 1] - loop[kp * 6 + 1], loop[kn * 6 + 2] - loop[kp * 6 + 2]).normalize();
      A.set(loop[k * 6 + 3], loop[k * 6 + 4], loop[k * 6 + 5]);
      A.addScaledVector(T, -A.dot(T)).normalize();
      B.crossVectors(A, T);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const ca = Math.cos(ph) * r;
        const sb = Math.sin(ph) * r;
        grid.set(i, k, loop[k * 6] + A.x * ca + B.x * sb, loop[k * 6 + 1] + A.y * ca + B.y * sb, loop[k * 6 + 2] + A.z * ca + B.z * sb);
      }
    }
    grid.finish();
  }

  /** Tube swept along a curve; rFn(t) radius, zFn(t) offset along local Z (palmar bulk). */
  tube(grid, curve, rFn, zFn) {
    const P = this._v;
    const T = this._t;
    const A = this._a;
    const B = this._b;
    for (let j = 0; j < grid.nv; j++) {
      const t = j / (grid.nv - 1);
      curve.getPoint(t, P);
      curve.getTangent(t, T);
      A.set(0, 0, 1).addScaledVector(T, -T.z);
      if (A.lengthSq() < 1e-6) A.set(1, 0, 0).addScaledVector(T, -T.x);
      A.normalize();
      B.crossVectors(A, T);
      const r = rFn(t);
      const z = zFn(t);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const ca = Math.cos(ph) * r * 0.92; // slightly flattened dorsal-palmar
        const sb = Math.sin(ph) * r;
        grid.set(i, j, P.x + A.x * ca + B.x * sb, P.y + A.y * ca + B.y * sb, P.z + z + A.z * ca + B.z * sb);
      }
    }
    grid.finish();
  }

  /** Binding ring around the open end of the thumb sleeve. */
  tubeEndRing(grid, curve, R, r) {
    const P = curve.getPoint(1, new THREE.Vector3());
    const T = curve.getTangent(1, new THREE.Vector3());
    const A = new THREE.Vector3(0, 0, 1).addScaledVector(T, -T.z).normalize();
    const B = new THREE.Vector3().crossVectors(A, T);
    const n = grid.nv - 1;
    const Q = new THREE.Vector3();
    const O = new THREE.Vector3();
    const tA = new THREE.Vector3();
    const tB = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const ph = (k / n) * TAU;
      O.copy(A).multiplyScalar(Math.cos(ph) * 0.92).addScaledVector(B, Math.sin(ph));
      Q.copy(P).addScaledVector(O, R);
      const tang = new THREE.Vector3().copy(A).multiplyScalar(-Math.sin(ph) * 0.92).addScaledVector(B, Math.cos(ph)).normalize();
      tA.copy(O).normalize();
      tB.crossVectors(tA, tang);
      for (let i = 0; i < grid.nu; i++) {
        const a = (i / (grid.nu - 1)) * TAU;
        grid.set(i, k, Q.x + (tA.x * Math.cos(a) + tB.x * Math.sin(a)) * r, Q.y + (tA.y * Math.cos(a) + tB.y * Math.sin(a)) * r, Q.z + (tA.z * Math.cos(a) + tB.z * Math.sin(a)) * r);
      }
    }
    grid.finish();
  }

  /** Finger / thumb skin capsule through 4 joints, with a rounded tip. */
  chain(grid, [a, b, cc, d, r0, r1], lm, span) {
    const P = this._v;
    const T = this._t;
    const A = this._a;
    const B = this._b;
    const body = grid.nv - 4;
    const pts = [lm[a], lm[b], lm[cc], lm[d]];
    for (let j = 0; j < grid.nv; j++) {
      let t;
      let rr;
      if (j < body) {
        t = j / (body - 1);
        rr = lerp(r0, r1, t) * span;
      } else {
        t = 1;
        const q = (j - body + 1) / 4; // cap
        rr = r1 * span * Math.cos((q * Math.PI) / 2);
      }
      const f = Math.min(t * 3, 2.999);
      const k = Math.floor(f);
      P.copy(pts[k]).lerp(pts[k + 1], f - k);
      T.subVectors(pts[k + 1], pts[k]).normalize();
      if (j >= body) P.addScaledVector(T, r1 * span * Math.sin(((j - body + 1) / 4) * (Math.PI / 2)));
      A.set(0, 0, 1).addScaledVector(T, -T.z);
      if (A.lengthSq() < 1e-6) A.set(1, 0, 0).addScaledVector(T, -T.x);
      A.normalize();
      B.crossVectors(A, T);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const ca = Math.cos(ph) * rr;
        const sb = Math.sin(ph) * rr;
        grid.set(i, j, P.x + A.x * ca + B.x * sb, P.y + A.y * ca + B.y * sb, P.z + A.z * ca + B.z * sb);
      }
    }
    grid.finish();
  }

  dispose() {
    const all = [...Object.values(this.g).flat()];
    all.forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skinMaterial.dispose();
  }
}

/** Dispose shared textures (only when no brace is alive; not needed in normal use). */
export function disposeWristTextures() {
  if (!TEX) return;
  Object.values(TEX).forEach((t) => t.dispose());
  TEX = null;
}
