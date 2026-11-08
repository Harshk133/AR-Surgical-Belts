// Procedural universal shoulder immobilizer in the reference-torso space shared with the Taylor's
// brace (origin = shoulder-joint midpoint, +X wearer's left, +Y up, +Z front; see immobilizerConfig).
//
// Accuracy model:
//  - Torso: the reference superelliptic sections (blender/build_brace.py) times the per-level factors
//    measured by BodyShapeFitter (width, front/back depth, lateral offset): the same surface the
//    Taylor's brace is reshaped to.
//  - Body band: a band pulled around a body takes the CONVEX HULL of what it wraps. Every band row is
//    the convex hull of the fitted torso section and, when the upper arm lies against the side, the
//    arm's cross-section at that height (cylinder cut by a horizontal plane = ellipse), offset by the
//    band thickness.
//  - Pouch: a tube around the tracked forearm (elbow -> wrist), closed behind the elbow, open at the wrist.
//  - X straps: straight lines between band and pouch anchor points, draped over whichever surface is
//    in front (band / torso / pouch).
//  - Shoulder straps: follow the torso's sagittal contour at the strap's x over the top of each shoulder.
import * as THREE from 'three';
import { IMMOBILIZER as CFG } from '../model/immobilizerConfig.js';
import { BRACE_MODEL } from '../model/braceConfig.js';
import { refSection } from './BodyShapeFitter.js';
import { applyBraceShader, occluderMaterial } from './BraceModel.js';
import { Grid, canvasTex, fabricMap, heightToNormalTex, knitHeight, stitchLine } from './WristBrace.js';

const TAU = Math.PI * 2;
const LEVELS = BRACE_MODEL.fitLevels;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
const E_EXP = 2 / CFG.superN;

// ---------------------------------------------------------------------------------------------
// Fitted torso
// ---------------------------------------------------------------------------------------------
export class TorsoShape {
  set(factors) {
    this.f = factors; // [{w, df, db, ox}] at LEVELS, or null (reference shape)
    return this;
  }

  /** Fit factors at height y (same blend as braceFit() in BraceModel's shader). */
  factor(y) {
    const id = { w: 1, df: 1, db: 1, ox: 0 };
    const F = this.f;
    if (!F || y >= -0.12) return id;
    const mix = (p, q, t) => ({ w: lerp(p.w, q.w, t), df: lerp(p.df, q.df, t), db: lerp(p.db, q.db, t), ox: lerp(p.ox, q.ox, t) });
    if (y > LEVELS[0]) return mix(id, F[0], (y + 0.12) / (LEVELS[0] + 0.12));
    for (let i = 0; i < LEVELS.length - 1; i++) {
      if (y <= LEVELS[i] && y > LEVELS[i + 1]) return mix(F[i], F[i + 1], (LEVELS[i] - y) / (LEVELS[i] - LEVELS[i + 1]));
    }
    return F[F.length - 1];
  }

  /** Section at y: half-width, front/back extents (from zc), centre (x, z). Girth scales extents. */
  section(y, girth = 1) {
    const r = refSection(y);
    const k = this.factor(y);
    return { a: r.a * k.w * girth, bf: r.bf * k.df * girth, bb: r.bb * k.db * girth, cx: k.ox, cz: r.zc };
  }

  /** Point on the section at angle th (0 = +X, 90deg = front), pushed out by off. */
  point(sec, th, off, out) {
    const c = Math.cos(th);
    const s = Math.sin(th);
    out[0] = sec.cx + spow(c, E_EXP) * (sec.a + off);
    out[1] = sec.cz + spow(s, E_EXP) * ((s >= 0 ? sec.bf : sec.bb) + off);
    return out;
  }

  /** Front surface z at (x, y), or -Infinity outside the torso's width. */
  frontZ(x, y, girth = 1) {
    const sec = this.section(y, girth);
    const u = Math.abs(x - sec.cx) / sec.a;
    if (u >= 1) return -Infinity;
    return sec.cz + sec.bf * (1 - u ** CFG.superN) ** (1 / CFG.superN);
  }

  backZ(x, y, girth = 1) {
    const sec = this.section(y, girth);
    const u = Math.abs(x - sec.cx) / sec.a;
    if (u >= 1) return Infinity;
    return sec.cz - sec.bb * (1 - u ** CFG.superN) ** (1 / CFG.superN);
  }
}

// ---------------------------------------------------------------------------------------------
// Convex hull of a 2D point set (x, z) + polar resampling around a centre
// ---------------------------------------------------------------------------------------------
function hull(pts) {
  const P = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of P) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up = [];
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1)); // counter-clockwise in (x, z)
}

/** Offset a CCW convex polygon outward by d (vertex normals). */
function offsetPoly(H, d) {
  const n = H.length;
  return H.map((p, i) => {
    const a = H[(i - 1 + n) % n];
    const b = H[(i + 1) % n];
    // outward normals of the two edges (CCW: outward = (dz, -dx))
    let n1x = p[1] - a[1];
    let n1z = -(p[0] - a[0]);
    let n2x = b[1] - p[1];
    let n2z = -(b[0] - p[0]);
    const l1 = Math.hypot(n1x, n1z) || 1;
    const l2 = Math.hypot(n2x, n2z) || 1;
    n1x /= l1; n1z /= l1; n2x /= l2; n2z /= l2;
    let nx = n1x + n2x;
    let nz = n1z + n2z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const k = d / Math.max(nx * n1x + nz * n1z, 0.5); // keep edges parallel at corners
    return [p[0] + nx * k, p[1] + nz * k];
  });
}

/** Intersection of the ray centre + t*(cos th, sin th) with a convex polygon containing the centre. */
function rayHit(H, cx, cz, th, out) {
  const dx = Math.cos(th);
  const dz = Math.sin(th);
  let best = Infinity;
  for (let i = 0; i < H.length; i++) {
    const p = H[i];
    const q = H[(i + 1) % H.length];
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - cx) * ez - (p[1] - cz) * ex) / den;
    const u = ((p[0] - cx) * dz - (p[1] - cz) * dx) / den;
    if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  if (!Number.isFinite(best)) best = 0;
  out[0] = cx + dx * best;
  out[1] = cz + dz * best;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------
let TEX = null;
export function textures() {
  if (TEX) return TEX;
  const H1 = knitHeight(256, 256, 31);
  const H2 = knitHeight(256, 128, 37);
  TEX = {
    fabric: fabricMap(H1, 256, 256, [96, 101, 107], 0.3),
    fabricN: heightToNormalTex(H1, 256, 256, 1.6),
    strap: fabricMap(H2, 256, 128, [72, 77, 83], 0.3, (ctx, w, h) => {
      stitchLine(ctx, 0, h * 0.14, w, h * 0.14, 'rgba(150,156,162,0.8)', [6, 4], 2);
      stitchLine(ctx, 0, h * 0.86, w, h * 0.86, 'rgba(150,156,162,0.8)', [6, 4], 2);
    }),
    xstrap: fabricMap(H2, 256, 128, [138, 143, 149], 0.3, (ctx, w, h) => {
      stitchLine(ctx, 0, h * 0.16, w, h * 0.16, 'rgba(70,74,80,0.85)', [6, 4], 2);
      stitchLine(ctx, 0, h * 0.84, w, h * 0.84, 'rgba(70,74,80,0.85)', [6, 4], 2);
    }),
    piping: canvasTex(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#2c9a7b';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, y, w, 1);
      }
      stitchLine(ctx, 4, 0, 4, h, 'rgba(210,240,228,0.75)', [7, 5], 2);
      stitchLine(ctx, w - 4, 0, w - 4, h, 'rgba(210,240,228,0.75)', [7, 5], 2);
    }),
  };
  return TEX;
}

// ---------------------------------------------------------------------------------------------
// Canonical rig for the inspector: left arm in the sling, right arm hanging.
// ---------------------------------------------------------------------------------------------
export function canonicalImmobilizerRig() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return {
    factors: null,
    girth: 1,
    side: 1, // the wearer's left arm is supported
    arm: { valid: true, inPose: true, wrap: true, S: V(0.18, 0, 0), E: V(0.205, -0.3, 0.03), W: V(-0.05, -0.335, 0.19) },
    other: { S: V(-0.18, 0, 0), E: V(-0.21, -0.3, -0.01), W: V(-0.22, -0.55, 0.03) },
  };
}

const NB = 96; // samples around the band

export class ImmobilizerModel {
  constructor({ mode = 'ar', maskUniforms = null } = {}) {
    this.mode = mode;
    this.root = new THREE.Group();
    this.root.name = 'ShoulderImmobilizer';
    this.occluder = new THREE.Group();
    this.occluder.name = 'BodyOccluder';
    this.torso = new TorsoShape();
    const T = textures();
    const fabric = (map) =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        normalMap: T.fabricN,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.92,
        metalness: 0,
        sheen: 0.7,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0x9aa1a8),
        side: THREE.DoubleSide, // the pouch is seen from inside at its open end
      });
    this.materials = {
      band: fabric(T.fabric),
      pouch: fabric(T.fabric),
      strap: fabric(T.strap),
      xstrap: fabric(T.xstrap),
      piping: new THREE.MeshStandardMaterial({ map: T.piping, roughness: 0.6, metalness: 0 }),
      buckle: new THREE.MeshPhysicalMaterial({ color: 0x2d3034, roughness: 0.35, metalness: 0, clearcoat: 0.5 }),
    };
    if (mode === 'ar') for (const m of Object.values(this.materials)) applyBraceShader(m, { maskUniforms, clip: !!maskUniforms });
    this.skin = mode === 'ar'
      ? occluderMaterial()
      : new THREE.MeshStandardMaterial({ color: 0xd6b49b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });

    const add = (name, grid, mat, parent = this.root) => {
      const mesh = new THREE.Mesh(grid.geometry, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      if (parent === this.occluder) mesh.renderOrder = -1;
      parent.add(mesh);
      grid.mesh = mesh;
      return grid;
    };
    this.g = {
      band: add('BodyBand', new Grid(NB + 1, 16, { closedU: true, uScale: 8, vScale: 1.5 }), this.materials.band),
      pipeTop: add('Piping_BandTop', new Grid(7, NB + 1, { closedU: true, closedV: true, vScale: 30 }), this.materials.piping),
      pipeBot: add('Piping_BandBottom', new Grid(7, NB + 1, { closedU: true, closedV: true, vScale: 30 }), this.materials.piping),
      pouch: add('ArmPouch', new Grid(49, 30, { closedU: true, uScale: 3, vScale: 2 }), this.materials.pouch),
      pipePouch: add('Piping_Pouch', new Grid(7, 49, { closedU: true, closedV: true, vScale: 12 }), this.materials.piping),
      xA: add('XStrap_A', new Grid(9, 40, { closedU: true, vScale: 3 }), this.materials.xstrap),
      xB: add('XStrap_B', new Grid(9, 40, { closedU: true, vScale: 3 }), this.materials.xstrap),
      shL: add('ShoulderStrap_L', new Grid(9, 72, { closedU: true, vScale: 8 }), this.materials.strap),
      shR: add('ShoulderStrap_R', new Grid(9, 72, { closedU: true, vScale: 8 }), this.materials.strap),
      bkL: add('StrapBuckle_L', new Grid(7, 41, { closedU: true, closedV: true }), this.materials.buckle),
      bkR: add('StrapBuckle_R', new Grid(7, 41, { closedU: true, closedV: true }), this.materials.buckle),
      body: add('Torso', new Grid(65, 36, { closedU: true }), this.skin, this.occluder),
    };
    if (mode === 'inspect') {
      this.g.armUp = add('ArmUpper', new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
      this.g.armFore = add('ArmFore', new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
      this.g.otherUp = add('OtherUpper', new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
      this.g.otherFore = add('OtherFore', new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
    }
    this._p = [0, 0];
  }

  /**
   * rig: { factors, girth, side (+1 = wearer's left arm supported), arm: { valid, inPose, wrap, S, E, W }
   * (reference-space Vector3s) }
   */
  update(rig) {
    const g = rig.girth ?? 1;
    const torso = this.torso.set(rig.factors);
    const arm = rig.arm;
    const B = CFG.band;
    const yBot = arm?.valid ? clamp(arm.E.y + B.aboveElbow, B.minBottom, B.maxBottom) : -0.3;
    const yTop = yBot + B.height;
    this.yTop = yTop;
    this.yBot = yBot;
    const T = B.thickness;

    // ---- body band: per-row convex hull of torso (+ upper arm) ----------------------------------
    const gb = this.g.band;
    const rowsY = [];
    for (let j = 0; j < gb.nv; j++) {
      // bevelled edges: first/last rows sit on the body, inner rows at full thickness
      const t = j === 0 ? 0 : j === gb.nv - 1 ? 1 : 0.02 + (0.96 * (j - 1)) / (gb.nv - 3);
      const off = j === 0 || j === gb.nv - 1 ? T * 0.2 : T * (0.85 + 0.15 * Math.sin(Math.PI * t));
      rowsY.push([lerp(yBot, yTop, t), off]);
    }
    this.bandRows = [];
    rowsY.forEach(([y, off], j) => {
      const ring = this.bandRing(y, off, g, rig);
      this.bandRows.push(ring);
      for (let i = 0; i <= NB; i++) {
        const q = ring[i % NB];
        gb.set(i, j, q[0], y, q[1]);
      }
    });
    gb.finish();
    this.pipeLoop(this.g.pipeBot, this.bandRing(yBot + 0.003, T * 0.5, g, rig), yBot + 0.003);
    this.pipeLoop(this.g.pipeTop, this.bandRing(yTop - 0.003, T * 0.5, g, rig), yTop - 0.003);

    // ---- pouch + X straps (only while the forearm is in the sling position) -------------------
    const showPouch = !!(arm?.valid && arm.inPose);
    for (const k of ['pouch', 'pipePouch', 'xA', 'xB']) this.g[k].mesh.visible = showPouch;
    if (showPouch) {
      this.buildPouch(arm, g);
      this.buildXStraps(arm, g, torso, yBot);
    }

    // ---- shoulder straps over both shoulders ---------------------------------------------------
    for (const sx of [1, -1]) this.buildShoulderStrap(sx, yTop, g, torso);

    // ---- body (depth-only in AR, mannequin in the inspector) -------------------------------
    const gt = this.g.body;
    for (let j = 0; j < gt.nv; j++) {
      const y = lerp(-0.8, 0.13, j / (gt.nv - 1));
      const sec = torso.section(y, 1);
      for (let i = 0; i < gt.nu; i++) {
        torso.point(sec, (i / (gt.nu - 1)) * TAU, -0.004, this._p);
        gt.set(i, j, this._p[0], y, this._p[1]);
      }
    }
    gt.finish();
    if (this.g.armUp) {
      const r = CFG.upperArmRadius;
      this.capsule(this.g.armUp, arm.S, arm.E, r, r * 0.95);
      this.capsule(this.g.armFore, arm.E, arm.W.clone().addScaledVector(arm.W.clone().sub(arm.E).normalize(), 0.09), CFG.forearmRadius[0], CFG.forearmRadius[1] * 0.9);
      this.capsule(this.g.otherUp, rig.other.S, rig.other.E, r, r * 0.95);
      this.capsule(this.g.otherFore, rig.other.E, rig.other.W.clone().addScaledVector(rig.other.W.clone().sub(rig.other.E).normalize(), 0.09), CFG.forearmRadius[0], CFG.forearmRadius[1] * 0.9);
    }
  }

  /** NB points (x, z) of the band at height y: hull(torso + arm) offset by off, polar-resampled. */
  bandRing(y, off, g, rig) {
    const torso = this.torso;
    const sec = torso.section(y, g);
    const pts = [];
    for (let i = 0; i < 64; i++) pts.push(torso.point(sec, (i / 64) * TAU, 0, [0, 0]));
    const arm = rig.arm;
    if (arm?.valid && arm.wrap) {
      const e = armEllipse(arm, y, CFG.upperArmRadius * g);
      if (e) for (let i = 0; i < 24; i++) {
        const t = (i / 24) * TAU;
        pts.push([e.cx + e.ux * Math.cos(t) * e.ra + e.vx * Math.sin(t) * e.rb, e.cz + e.uz * Math.cos(t) * e.ra + e.vz * Math.sin(t) * e.rb]);
      }
    }
    const H = offsetPoly(hull(pts), off);
    const ring = [];
    for (let i = 0; i < NB; i++) ring.push(rayHit(H, sec.cx, sec.cz, (i / NB) * TAU, [0, 0]));
    return ring;
  }

  /** Piping tube along a band edge ring. */
  pipeLoop(grid, ring, y) {
    const r = CFG.piping;
    const n = ring.length;
    for (let k = 0; k <= n; k++) {
      const p = ring[k % n];
      const a = ring[(k - 1 + n) % n];
      const b = ring[(k + 1) % n];
      const T = _t.set(b[0] - a[0], 0, b[1] - a[1]).normalize();
      const A = _a.set(T.z, 0, -T.x); // outward in the (x, z) plane for a CCW ring
      const Bv = _b.crossVectors(A, T);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const c = Math.cos(ph) * r;
        const s = Math.sin(ph) * r;
        grid.set(i, k, p[0] + A.x * c + Bv.x * s, y + A.y * c + Bv.y * s, p[1] + A.z * c + Bv.z * s);
      }
    }
    grid.finish();
  }

  /** Pouch around the forearm: closed, rounded behind the elbow, open at the wrist. */
  buildPouch(arm, g) {
    const P = CFG.pouch;
    const dir = _d.subVectors(arm.W, arm.E);
    const len = dir.length();
    dir.divideScalar(len);
    const A = _a.set(0, 1, 0).addScaledVector(dir, -dir.y); // "up" across the forearm
    if (A.lengthSq() < 1e-6) A.set(0, 0, 1).addScaledVector(dir, -dir.z);
    A.normalize();
    const Bv = _b.crossVectors(A, dir);
    const radius = (t) => (lerp(CFG.forearmRadius[0], CFG.forearmRadius[1], clamp(t, 0, 1)) * g + P.slack + P.thickness);
    const gp = this.g.pouch;
    const cap = 6; // rows forming the closed elbow end
    const body = gp.nv - cap;
    const s0 = -P.behindElbow / len;
    const s1 = 1 - P.stopBeforeWrist / len;
    this.pouchFrame = { dir: dir.clone(), A: A.clone(), B: Bv.clone(), s0, s1, len, radius };
    for (let j = 0; j < gp.nv; j++) {
      let s;
      let rr;
      if (j < cap) {
        const q = (j / cap) * (Math.PI / 2); // 0 = pole behind the elbow
        s = s0 - (radius(0) * Math.cos(q) * 0.6) / len;
        rr = radius(0) * Math.sin(q);
      } else {
        s = lerp(s0, s1, (j - cap) / (body - 1));
        rr = radius(s);
      }
      const c = _c.copy(arm.E).addScaledVector(dir, s * len).addScaledVector(A, -P.slack * 0.45); // hangs a little
      for (let i = 0; i < gp.nu; i++) {
        const ph = (i / (gp.nu - 1)) * TAU;
        const ca = Math.cos(ph) * rr * 1.08; // a little deeper than wide
        const sb = Math.sin(ph) * rr;
        gp.set(i, j, c.x + A.x * ca + Bv.x * sb, c.y + A.y * ca + Bv.y * sb, c.z + A.z * ca + Bv.z * sb);
      }
    }
    gp.finish();
    // piping around the wrist opening
    const gr = this.g.pipePouch;
    const cEnd = _c.copy(arm.E).addScaledVector(dir, s1 * len).addScaledVector(A, -P.slack * 0.45);
    const rEnd = radius(s1);
    const n = gr.nv - 1;
    for (let k = 0; k <= n; k++) {
      const ph = (k / n) * TAU;
      const O = _o.copy(A).multiplyScalar(Math.cos(ph) * 1.08).addScaledVector(Bv, Math.sin(ph));
      const Q = _q.copy(cEnd).addScaledVector(O, rEnd);
      const tang = _t.copy(A).multiplyScalar(-Math.sin(ph) * 1.08).addScaledVector(Bv, Math.cos(ph)).normalize();
      const tA = O.normalize();
      const tB = _e.crossVectors(tA, tang);
      for (let i = 0; i < gr.nu; i++) {
        const a = (i / (gr.nu - 1)) * TAU;
        const c = Math.cos(a) * CFG.piping;
        const s = Math.sin(a) * CFG.piping;
        gr.set(i, k, Q.x + tA.x * c + tB.x * s, Q.y + tA.y * c + tB.y * s, Q.z + tA.z * c + tB.z * s);
      }
    }
    gr.finish();
  }

  /** Band front z at (x, y) from the actual hull rows (the band bulges over the arm). */
  bandFrontZ(x, y) {
    const rows = this.bandRows;
    if (!rows || y < this.yBot || y > this.yTop) return -Infinity;
    const j = clamp(Math.round(((y - this.yBot) / (this.yTop - this.yBot)) * (rows.length - 1)), 1, rows.length - 2);
    const ring = rows[j];
    let best = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if ((p[0] - x) * (q[0] - x) > 0) continue; // segment doesn't span x
      const t = Math.abs(q[0] - p[0]) < 1e-9 ? 0 : (x - p[0]) / (q[0] - p[0]);
      best = Math.max(best, p[1] + (q[1] - p[1]) * t);
    }
    return best;
  }

  /** Front-most surface z at (x, y): band / torso / pouch. */
  frontSurface(x, y, g, torso) {
    let z = Math.max(torso.frontZ(x, y, g), this.bandFrontZ(x, y));
    const pf = this.pouchFrame;
    if (pf) {
      // pouch: project onto its axis in the x/y plane and intersect the tube's vertical section
      const dx = pf.dir.x;
      const dy = pf.dir.y;
      const l2 = dx * dx + dy * dy;
      if (l2 > 1e-6) {
        const E = this._E;
        const s = ((x - E.x) * dx + (y - E.y) * dy) / l2 / pf.len;
        if (s > pf.s0 && s < pf.s1) {
          const cx = E.x + dx * s * pf.len;
          const cy = E.y + dy * s * pf.len - CFG.pouch.slack * 0.45;
          const cz = E.z + pf.dir.z * s * pf.len;
          // the pouch section is 1.08x deeper (vertically) than wide
          const r = pf.radius(s);
          const h = Math.hypot(x - cx, (y - cy) / 1.08);
          if (h < r) z = Math.max(z, cz + Math.sqrt(r * r - h * h) + 0.002);
        }
      }
    }
    return z;
  }

  buildXStraps(arm, g, torso, yBot) {
    this._E = arm.E;
    const pf = this.pouchFrame;
    const ring = this.bandRows[0];
    // band bottom anchors: the front-most band points nearest to the target x positions
    const anchor = (x) => {
      let best = null;
      for (const q of ring) if (q[1] > 0 && (!best || Math.abs(q[0] - x) < Math.abs(best[0] - x))) best = q;
      return new THREE.Vector3(best[0], yBot + 0.03, best[1] + CFG.band.thickness * 0.9);
    };
    // pouch anchors: lower-front of the pouch at two places along the forearm
    const pouchPt = (s) => {
      const o = new THREE.Vector3(0, -1.3, 1);
      const out = o.addScaledVector(pf.dir, -o.dot(pf.dir)).normalize();
      return arm.E.clone().addScaledVector(pf.dir, s * pf.len).addScaledVector(pf.A, -CFG.pouch.slack * 0.45).addScaledVector(out, pf.radius(s) * 1.02);
    };
    const xA = lerp(arm.E.x, arm.W.x, 0.22);
    const xB = lerp(arm.E.x, arm.W.x, 0.7);
    this.drapeStrap(this.g.xA, anchor(xA), pouchPt(0.72), g, torso);
    this.drapeStrap(this.g.xB, anchor(xB), pouchPt(0.28), g, torso);
  }

  /** Flat strap from p to q, lifted onto the front-most surface. */
  drapeStrap(grid, p, q, g, torso) {
    const n = grid.nv;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const P = p.clone().lerp(q, t);
      const zs = this.frontSurface(P.x, P.y, g, torso);
      // the end points are on their anchors; the middle drapes over whatever is in front
      if (Number.isFinite(zs)) P.z = Math.max(P.z, zs + CFG.xStrap.thickness);
      pts.push(P);
    }
    // a strap under tension bridges small dips: smooth the lift (never below the surface)
    for (let it = 0; it < 3; it++) {
      const z = pts.map((P) => P.z);
      for (let k = 1; k < n - 1; k++) pts[k].z = Math.max(z[k], (z[k - 1] + 2 * z[k] + z[k + 1]) / 4);
    }
    this.ribbon(grid, pts, (k) => _n.set(0, 0, 1), CFG.xStrap.width, CFG.xStrap.thickness);
  }

  /** Shoulder strap at x = sx * cfg.x: up the front, over the shoulder, down the back. */
  buildShoulderStrap(sx, yTop, g, torso) {
    const S = CFG.shoulderStrap;
    const x = sx * S.x;
    const off = S.thickness * 0.5 + 0.004; // over clothing
    // crest: the highest y where the torso is still wider than |x|
    let yc = yTop;
    for (let y = yTop; y < 0.14; y += 0.002) {
      if (Number.isFinite(torso.frontZ(x, y, g))) yc = y;
      else break;
    }
    const n = 72;
    const half = n / 2;
    const pts = [];
    const nor = [];
    for (let k = 0; k < n; k++) {
      // front branch going up, then back branch going down; dense near the crest
      const front = k < half;
      const u = front ? k / (half - 1) : (n - 1 - k) / (half - 1);
      // 1 - (1-u)^2 has zero slope at the crest: samples crowd where the strap turns over the top
      const yy = Math.min(lerp(yTop - 0.01, yc, 1 - (1 - u) ** 2), yc - 1e-4);
      const z = front ? torso.frontZ(x, yy, g) : torso.backZ(x, yy, g);
      pts.push(new THREE.Vector3(x, yy, z));
    }
    // outward normals in the sagittal plane, then lift
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(k - 1, 0)];
      const b = pts[Math.min(k + 1, n - 1)];
      const ty = b.y - a.y;
      const tz = b.z - a.z;
      // contour runs up the front then down the back (clockwise seen from +X): outward = (y,z) -> (-tz, ty)?
      let ny = -tz;
      let nz = ty;
      const centreZ = (pts[0].z + pts[n - 1].z) / 2;
      const p = pts[k];
      if (ny * (p.y - (yTop - 0.1)) + nz * (p.z - centreZ) < 0) {
        ny = -ny;
        nz = -nz;
      }
      const l = Math.hypot(ny, nz) || 1;
      nor.push(new THREE.Vector3(0, ny / l, nz / l));
    }
    pts.forEach((p, k) => p.addScaledVector(nor[k], off));
    this.ribbon(sx > 0 ? this.g.shL : this.g.shR, pts, (k) => nor[k], S.width, S.thickness);
    // slider buckle on the front branch
    let kb = 0;
    while (kb < half - 1 && pts[kb].y < S.buckleY) kb++;
    const tng = pts[kb + 1].clone().sub(pts[kb]).normalize();
    const across = new THREE.Vector3().crossVectors(nor[kb], tng).normalize();
    const C = pts[kb].clone().addScaledVector(nor[kb], S.thickness + 0.002);
    this.rectRing(sx > 0 ? this.g.bkL : this.g.bkR, C, across, tng, nor[kb], S.width / 2 + 0.006, 0.009, 0.0028);
  }

  /** Flat strap: closed flattened tube along pts; nfn(k) = surface normal at k. */
  ribbon(grid, pts, nfn, width, thick) {
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(k - 1, 0)];
      const b = pts[Math.min(k + 1, n - 1)];
      const T = _t.subVectors(b, a).normalize();
      const N = _a.copy(nfn(k)).addScaledVector(T, -nfn(k).dot(T)).normalize();
      const W = _b.crossVectors(N, T);
      const p = pts[k];
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        // rounded rectangle-ish section: wide along W, thin along N
        const c = Math.cos(ph);
        const s = Math.sin(ph);
        const cw = spow(s, 0.3) * width * 0.5;
        const cn = spow(c, 0.3) * thick * 0.5;
        grid.set(i, k, p.x + N.x * cn + W.x * cw, p.y + N.y * cn + W.y * cw, p.z + N.z * cn + W.z * cw);
      }
    }
    grid.finish();
  }

  /** Rectangular slider ring (buckle) centred at C in the plane (U, V), normal N. */
  rectRing(grid, C, U, V, N, hu, hv, r) {
    const n = grid.nv - 1;
    const per = 4 * (hu + hv);
    const at = (d) => {
      d = ((d % per) + per) % per;
      if (d < 2 * hu) return [-hu + d, -hv];
      d -= 2 * hu;
      if (d < 2 * hv) return [hu, -hv + d];
      d -= 2 * hv;
      if (d < 2 * hu) return [hu - d, hv];
      d -= 2 * hu;
      return [-hu, hv - d];
    };
    for (let k = 0; k <= n; k++) {
      const [a, b] = at((k / n) * per);
      const [a2, b2] = at(((k + 1) / n) * per);
      const P = C.clone().addScaledVector(U, a).addScaledVector(V, b);
      const T = U.clone().multiplyScalar(a2 - a).addScaledVector(V, b2 - b).normalize();
      const B2 = new THREE.Vector3().crossVectors(N, T);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const c = Math.cos(ph) * r;
        const s = Math.sin(ph) * r * 1.6;
        grid.set(i, k, P.x + N.x * c + B2.x * s, P.y + N.y * c + B2.y * s, P.z + N.z * c + B2.z * s);
      }
    }
    grid.finish();
  }

  /** Inspector mannequin limb. */
  capsule(grid, a, b, r0, r1) {
    const dir = _d.subVectors(b, a);
    const len = dir.length();
    dir.divideScalar(len);
    const A = _a.set(1, 0, 0).addScaledVector(dir, -dir.x);
    if (A.lengthSq() < 1e-6) A.set(0, 0, 1).addScaledVector(dir, -dir.z);
    A.normalize();
    const Bv = _b.crossVectors(A, dir);
    for (let j = 0; j < grid.nv; j++) {
      const t = j / (grid.nv - 1);
      const r = lerp(r0, r1, t);
      const c = _c.copy(a).addScaledVector(dir, t * len);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        grid.set(i, j, c.x + (A.x * Math.cos(ph) + Bv.x * Math.sin(ph)) * r, c.y + (A.y * Math.cos(ph) + Bv.y * Math.sin(ph)) * r, c.z + (A.z * Math.cos(ph) + Bv.z * Math.sin(ph)) * r);
      }
    }
    grid.finish();
  }

  dispose() {
    Object.values(this.g).forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skin.dispose();
  }
}

/**
 * Horizontal cross-section (plane y) of the upper arm (cylinder S->E, radius r), as an ellipse in
 * (x, z): centre, unit axes u (minor, r) and v (major, r/|dir.y|, capped). Near the elbow end it
 * rounds off like the end of a capsule. Returns null if the plane misses the arm.
 */
export function armEllipse(arm, y, r) {
  const S = arm.S;
  const E = arm.E;
  const dy = E.y - S.y;
  if (Math.abs(dy) < 1e-4) return null;
  let t = (y - S.y) / dy;
  let rr = r;
  if (t > 1) {
    const over = ((t - 1) * Math.abs(dy)) / r; // below the elbow: capsule end
    if (over >= 1) return null;
    rr = r * Math.sqrt(1 - over * over);
    t = 1;
  }
  if (t < 0) return null;
  const cx = S.x + (E.x - S.x) * t;
  const cz = S.z + (E.z - S.z) * t;
  const d = _d.subVectors(E, S).normalize();
  const h = Math.hypot(d.x, d.z);
  let vx = 1;
  let vz = 0;
  if (h > 1e-4) {
    vx = d.x / h;
    vz = d.z / h;
  }
  const stretch = Math.min(1 / Math.max(Math.abs(d.y), 1e-3), 3);
  return { cx, cz, ux: -vz, uz: vx, ra: rr, vx, vz, rb: rr * (t >= 1 ? 1 : stretch) };
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();
const _q = new THREE.Vector3();
const _t = new THREE.Vector3();
