// Procedural tennis elbow (counterforce) strap, rebuilt on the wearer's forearm.
//
// Local arm frame (see ArmTransform): origin = elbow joint, +Y distal, +X lateral, +Z volar.
// The forearm cross-section at each height is an ellipse (half-width a along X, half-thickness b along
// Z) from the outline fitter or anatomical priors, centred on the measured forearm centre line. Every
// part (padded band, edge bindings, pressure pad, label, buckle, folded-back tail and the depth-only
// skin) is evaluated on that one description, so the parts always sit on each other and on the arm.
import * as THREE from 'three';
import { ELBOW_STRAP as CFG } from '../model/elbowSupportConfig.js';
import { applyBraceShader, occluderMaterial } from './BraceModel.js';
import { Grid, canvasTex, fabricMap, heightToNormalTex, knitHeight, stitchLine } from './WristBrace.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Anatomical prior (x Lf -> metres). */
export function elbowPriorLevels(Lf) {
  return CFG.levels.map((_, i) => {
    const a = CFG.priorHalfWidth[i] * Lf;
    return { a, b: a * CFG.priorDepthRatio[i] };
  });
}

export function canonicalArmRig() {
  const Lf = 0.26;
  return { Lf, levels: elbowPriorLevels(Lf), offset: { x: 0, z: 0 }, girth: 1 };
}

/** Forearm cross-sections: ellipse per height, straight centre line (+ fitted offset). */
export class ForearmSection {
  set(rig) {
    this.Lf = rig.Lf;
    this.ys = CFG.levels.map((l) => l * rig.Lf);
    this.A = rig.levels.map((l) => l.a);
    this.B = rig.levels.map((l) => l.b);
    this.ox = rig.offset.x;
    this.oz = rig.offset.z;
    return this;
  }

  ab(y) {
    const { ys, A, B, Lf } = this;
    const n = ys.length - 1;
    if (y <= ys[0]) {
      // toward the elbow: slightly wider (epicondyles), capped
      const k = Math.min((ys[0] - y) / Lf, 0.25);
      return [A[0] * (1 + 0.5 * k), B[0] * (1 + 0.3 * k)];
    }
    if (y >= ys[n]) {
      // toward the wrist the forearm tapers to ~65 % of the proximal width
      const t = Math.min((y - ys[n]) / (Lf - ys[n]), 1);
      return [A[n] * lerp(1, 0.66, t), B[n] * lerp(1, 0.62, t)];
    }
    let i = 0;
    while (y > ys[i + 1]) i++;
    const t = (y - ys[i]) / (ys[i + 1] - ys[i]);
    return [lerp(A[i], A[i + 1], t), lerp(B[i], B[i + 1], t)];
  }

  /** Point at height y, angle th (0 = lateral, +90 = volar), extents*girth + off. */
  eval(y, th, off, girth, out) {
    const [a, b] = this.ab(y);
    out[0] = this.ox + Math.cos(th) * (a * girth + off);
    out[1] = y;
    out[2] = this.oz + Math.sin(th) * (b * girth + off);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
let TEX = null;
const BEIGE = [214, 186, 146];
function textures() {
  if (TEX) return TEX;
  const H1 = knitHeight(256, 256, 21);
  const H2 = knitHeight(256, 128, 23);
  TEX = {
    band: fabricMap(H1, 256, 256, BEIGE, 0.28),
    bandN: heightToNormalTex(H1, 256, 256, 1.8),
    edge: fabricMap(H2, 256, 128, BEIGE, 0.25, (ctx, w, h) => {
      // stitched seams just inside both edges of the band
      stitchLine(ctx, 0, h * 0.07, w, h * 0.07, 'rgba(150,120,82,0.9)', [6, 4], 2);
      stitchLine(ctx, 0, h * 0.93, w, h * 0.93, 'rgba(150,120,82,0.9)', [6, 4], 2);
    }),
    pad: fabricMap(H2, 256, 128, [221, 194, 155], 0.25, (ctx, w, h) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,120,82,0.85)';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      const r = h * 0.3;
      const x0 = w * 0.06;
      const y0 = h * 0.12;
      const x1 = w * 0.94;
      const y1 = h * 0.88;
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.arcTo(x1, y0, x1, y1, r);
      ctx.arcTo(x1, y1, x0, y1, r);
      ctx.arcTo(x0, y1, x0, y0, r);
      ctx.arcTo(x0, y0, x1, y0, r);
      ctx.stroke();
      ctx.restore();
    }, ),
    binding: canvasTex(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#c4a476';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        ctx.fillStyle = y % 4 ? '#c9aa7d' : '#bd9d6f';
        ctx.fillRect(0, y, w, 1);
      }
      stitchLine(ctx, 3, 0, 3, h, 'rgba(140,110,74,0.9)', [8, 5], 3);
      stitchLine(ctx, w - 3, 0, w - 3, h, 'rgba(140,110,74,0.9)', [8, 5], 3);
    }),
    label: canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f6f6f2';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3aa35a';
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.setLineDash([]);
      ctx.fillStyle = '#3aa35a';
      ctx.beginPath();
      ctx.arc(w / 2, 70, 34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(w / 2 + 8, 66, 18, 6);
      ctx.fillRect(w / 2 + 14, 60, 6, 18);
      ctx.fillStyle = '#2f6fb6';
      ctx.font = 'italic 700 46px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DaynoR', w / 2, 146);
      ctx.fillStyle = '#3aa35a';
      ctx.fillRect(48, 172, w - 96, 4);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('ALL TYPE REHABILITATION AIDS', w / 2, 204);
    }, { repeat: false }),
  };
  return TEX;
}

const NT = 96;

export class ElbowStrap {
  constructor({ mode = 'ar', maskUniforms = null } = {}) {
    this.mode = mode;
    this.root = new THREE.Group();
    this.root.name = 'TennisElbowStrap';
    this.occluder = new THREE.Group();
    this.occluder.name = 'BodyOccluder';
    this.sec = new ForearmSection();
    const T = textures();
    const fabric = (map, normalMap) =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        normalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.9,
        metalness: 0,
        sheen: 0.8,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0xf3e3c8),
      });
    this.materials = {
      band: fabric(T.edge, T.bandN),
      pad: fabric(T.pad, T.bandN),
      tail: fabric(T.edge, T.bandN),
      binding: new THREE.MeshStandardMaterial({ map: T.binding, roughness: 0.75, metalness: 0 }),
      label: new THREE.MeshStandardMaterial({ map: T.label, roughness: 0.65, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
      buckle: new THREE.MeshPhysicalMaterial({ color: 0xc8ae86, roughness: 0.38, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
    };
    if (mode === 'ar') for (const m of Object.values(this.materials)) applyBraceShader(m, { maskUniforms, clip: !!maskUniforms });
    this.skinMaterial = mode === 'ar'
      ? occluderMaterial()
      : new THREE.MeshStandardMaterial({ color: 0xd6b49b, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });

    const add = (name, grid, mat, parent = this.root) => {
      const mesh = new THREE.Mesh(grid.geometry, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      if (parent === this.occluder) mesh.renderOrder = -1;
      parent.add(mesh);
      return grid;
    };
    this.g = {
      band: add('PaddedBand', new Grid(NT + 1, 14, { closedU: true, uScale: 7 }), this.materials.band),
      bindA: add('Binding_Proximal', new Grid(9, NT + 1, { closedU: true, closedV: true, vScale: 22 }), this.materials.binding),
      bindB: add('Binding_Distal', new Grid(9, NT + 1, { closedU: true, closedV: true, vScale: 22 }), this.materials.binding),
      pad: add('PressurePad', new Grid(28, 16), this.materials.pad),
      label: add('Label', new Grid(8, 8), this.materials.label),
      tail: add('StrapTail', new Grid(36, 12, { uScale: 2 }), this.materials.tail),
      buckle: add('Buckle', new Grid(9, 65, { closedU: true, closedV: true }), this.materials.buckle),
      skin: add('Forearm', new Grid(41, 30, { closedU: true }), this.skinMaterial, this.occluder),
    };
    if (mode === 'inspect') {
      this.g.upper = add('UpperArm', new Grid(41, 16, { closedU: true }), this.skinMaterial, this.occluder);
      this.g.hand = add('Hand', new Grid(41, 16, { closedU: true }), this.skinMaterial, this.occluder);
    }
    this._p = [0, 0, 0];
    this._q = [0, 0, 0];
      }

  /** rig: { Lf, levels [{a,b}] skin, offset {x,z}, girth } */
  update(rig) {
    const Lf = rig.Lf;
    const g = rig.girth ?? 1;
    const sec = this.sec.set(rig);
    const p = this._p;
    const T = CFG.thickness * Lf;
    const yc = CFG.centre * Lf;
    const half = (CFG.width * Lf) / 2;
    const y0 = yc - half;
    const y1 = yc + half;
    const bev = 0.012 * Lf;
    // padded profile across the width: fuller in the middle
    const bandOff = (t) => T * (0.72 + 0.28 * Math.sin(Math.PI * t));

    // ---- padded band (bevelled edges) ----------------------------------------------------------
    const gb = this.g.band;
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU;
      for (let j = 0; j < gb.nv; j++) {
        let y;
        let off;
        if (j === 0) [y, off] = [y0, T * 0.15];
        else if (j === gb.nv - 1) [y, off] = [y1, T * 0.15];
        else {
          const t = (j - 1) / (gb.nv - 3);
          y = lerp(y0 + bev, y1 - bev, t);
          off = bandOff(t);
        }
        sec.eval(y, th, off, g, p);
        gb.set(i, j, p[0], p[1], p[2]);
      }
    }
    gb.finish();

    // ---- stitched bindings on both edges ---------------------------------------------------------
    const ring = (y) => {
      const pts = [];
      for (let k = 0; k <= NT; k++) {
        const th = (k / NT) * TAU;
        sec.eval(y, th, T * 0.45, g, p);
        const c = [sec.ox, y, sec.oz];
        pts.push([p[0], p[1], p[2]], [p[0] - c[0], 0, p[2] - c[2]]);
      }
      return pts;
    };
    this.loopTube(this.g.bindA, ring(y0 + 0.002 * Lf), CFG.binding * Lf, NT);
    this.loopTube(this.g.bindB, ring(y1 - 0.002 * Lf), CFG.binding * Lf, NT);

    // ---- pressure pad over the extensor mass -----------------------------------------------------
    const pd = CFG.pad;
    const gp = this.g.pad;
    for (let i = 0; i < gp.nu; i++) {
      const u = i / (gp.nu - 1);
      const th = (pd.centreDeg + (u - 0.5) * pd.spanDeg) * D2R;
      for (let j = 0; j < gp.nv; j++) {
        const v = j / (gp.nv - 1);
        const t = lerp(pd.v0, pd.v1, v);
        const bump = Math.sqrt(Math.max(0, 1 - Math.abs(2 * u - 1) ** 5)) * Math.sqrt(Math.max(0, 1 - Math.abs(2 * v - 1) ** 5));
        sec.eval(lerp(y0 + bev, y1 - bev, t), th, bandOff(t) + pd.height * Lf * bump + 0.0005 * Lf, g, p);
        gp.set(i, j, p[0], p[1], p[2]);
      }
    }
    gp.finish();

    // ---- label -----------------------------------------------------------------------------------
    const lb = CFG.label;
    const gl = this.g.label;
    for (let i = 0; i < gl.nu; i++) {
      const th = (lb.centreDeg + (i / (gl.nu - 1) - 0.5) * lb.spanDeg) * D2R;
      for (let j = 0; j < gl.nv; j++) {
        const t = lerp(lb.v0, lb.v1, j / (gl.nv - 1));
        sec.eval(lerp(y0 + bev, y1 - bev, t), th, bandOff(t) + 0.0015 * Lf, g, p);
        gl.set(i, j, p[0], p[1], p[2]);
      }
    }
    gl.finish();

    // ---- folded-back tail: from the buckle back toward the front, rounded end -----------------
    const tb = CFG.buckleDeg * D2R;
    const te = tb - CFG.tail.spanDeg * D2R;
    const gt = this.g.tail;
    const [ra] = sec.ab(yc);
    const rho = Math.min((half * 0.92) / (ra * g + T), (tb - te) * 0.45);
    for (let i = 0; i < gt.nu; i++) {
      const u = i / (gt.nu - 1);
      const th = lerp(te, tb, u);
      const round = th < te + rho ? Math.sqrt(Math.max(0, 1 - ((te + rho - th) / rho) ** 2)) : 1;
      const rise = smooth(0.75, 1, u); // climbs over the buckle bar
      for (let j = 0; j < gt.nv; j++) {
        const edge = j === 0 || j === gt.nv - 1;
        const vj = edge ? (j === 0 ? 0 : 1) : 0.05 + (0.9 * (j - 1)) / (gt.nv - 3);
        const y = yc + (vj - 0.5) * 2 * half * 0.9 * round;
        const off = T + (edge ? 0 : CFG.tail.lift * Lf) + rise * 0.01 * Lf;
        sec.eval(y, th, off, g, p);
        gt.set(i, j, p[0], p[1], p[2]);
      }
    }
    gt.finish();

    // ---- buckle: flat rectangular ring lying on the band at the closure --------------------------
    {
      const cth = tb + 0.04;
      sec.eval(yc, cth, T + 0.006 * Lf, g, p);
      const C = new THREE.Vector3(...p);
      sec.eval(yc, cth + 0.02, T + 0.006 * Lf, g, this._q);
      const tang = new THREE.Vector3(...this._q).sub(C).normalize(); // around the arm
      const n = new THREE.Vector3(C.x - sec.ox, 0, C.z - sec.oz).normalize(); // outward
      const hy = half + 0.02 * Lf;
      const ht = 0.028 * Lf;
      const rc = 0.012 * Lf;
      const pts = [];
      for (let k = 0; k <= 64; k++) {
        const q = rectPoint(k / 64, hy, ht, rc);
        const P = C.clone().addScaledVector(tang, q[0]).add(new THREE.Vector3(0, q[1], 0));
        pts.push([P.x, P.y, P.z], [n.x, n.y, n.z]);
      }
      this.loopTube(this.g.buckle, pts, 0.0065 * Lf, 64, 0.6);
    }

    // ---- skin: forearm (+ upper arm and hand for the inspector mannequin) ------------------------
    const gs = this.g.skin;
    for (let i = 0; i < gs.nu; i++) {
      const th = (i / (gs.nu - 1)) * TAU;
      for (let j = 0; j < gs.nv; j++) {
        sec.eval(lerp(-0.06 * Lf, 0.98 * Lf, j / (gs.nv - 1)), th, -0.004 * Lf, 1, p);
        gs.set(i, j, p[0], p[1], p[2]);
      }
    }
    gs.finish();
    if (this.g.upper) this.mannequin(rig, sec);
  }

  /** Inspector only: upper arm (elbow flexed 25 deg) and a flat hand. */
  mannequin(rig, sec) {
    const Lf = rig.Lf;
    const flex = 25 * D2R;
    const dir = new THREE.Vector3(0, -Math.cos(flex), Math.sin(flex));
    const side = new THREE.Vector3(1, 0, 0);
    const fwd = new THREE.Vector3().crossVectors(side, dir);
    const gu = this.g.upper;
    const [a0, b0] = sec.ab(0);
    for (let j = 0; j < gu.nv; j++) {
      const t = j / (gu.nv - 1);
      const c = dir.clone().multiplyScalar(lerp(-0.02, 1.15, t) * Lf);
      const a = lerp(a0 * 1.05, 0.17 * Lf, smooth(0, 0.3, t));
      const b = lerp(b0 * 1.1, 0.17 * Lf, smooth(0, 0.3, t));
      for (let i = 0; i < gu.nu; i++) {
        const th = (i / (gu.nu - 1)) * TAU;
        const P = c.clone().addScaledVector(side, Math.cos(th) * a).addScaledVector(fwd, Math.sin(th) * b);
        gu.set(i, j, P.x, P.y, P.z);
      }
    }
    gu.finish();
    const gh = this.g.hand;
    for (let j = 0; j < gh.nv; j++) {
      const t = j / (gh.nv - 1);
      const y = lerp(0.96, 1.62, t) * Lf;
      // starts at the wrist's width, widens across the palm, rounds off at the fingertips
      const env = (0.62 + 0.38 * smooth(0, 0.3, t)) * (t > 0.8 ? Math.cos(((t - 0.8) / 0.2) * Math.PI * 0.5) : 1);
      const tip = t > 0.8 ? Math.cos(((t - 0.8) / 0.2) * Math.PI * 0.5) : 1;
      const a = 0.17 * Lf * env;
      const b = lerp(0.085, 0.06, smooth(0, 0.4, t)) * Lf * tip; // wrist-thick, flattening into the palm
      for (let i = 0; i < gh.nu; i++) {
        const th = (i / (gh.nu - 1)) * TAU;
        gh.set(i, j, sec.ox + Math.cos(th) * a, y, sec.oz + Math.sin(th) * b);
      }
    }
    gh.finish();
  }

  /** Closed tube along a loop: pts = [p0, out0, p1, out1, ...] (last == first). */
  loopTube(grid, pts, r, n, flatten = 1) {
    const P = (k) => pts[2 * (((k % n) + n) % n)];
    const Tn = new THREE.Vector3();
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const a = P(k - 1);
      const b = P(k + 1);
      const c = P(k);
      Tn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const o = pts[2 * (k % n) + 1];
      A.set(o[0], o[1], o[2]);
      A.addScaledVector(Tn, -A.dot(Tn)).normalize();
      B.crossVectors(A, Tn);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const ca = Math.cos(ph) * r * flatten;
        const sb = Math.sin(ph) * r;
        grid.set(i, k, c[0] + A.x * ca + B.x * sb, c[1] + A.y * ca + B.y * sb, c[2] + A.z * ca + B.z * sb);
      }
    }
    grid.finish();
  }

  dispose() {
    Object.values(this.g).forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skinMaterial.dispose();
  }
}

/** Point on a rounded rectangle (half sizes hx, hy, corner radius r) at perimeter fraction t. */
function rectPoint(t, hy, hx, r) {
  // perimeter segments: straight sides then quarter arcs, counter-clockwise from (+hx, -hy+r)
  const sx = hx - r;
  const sy = hy - r;
  const arc = (Math.PI / 2) * r;
  const segs = [2 * sy, arc, 2 * sx, arc, 2 * sy, arc, 2 * sx, arc];
  const total = segs.reduce((a, b) => a + b, 0);
  let d = t * total;
  let k = 0;
  while (k < 7 && d > segs[k]) d -= segs[k++];
  const ang = (q) => (q * Math.PI) / 2 + d / r;
  switch (k) {
    case 0: return [hx, -sy + d];
    case 1: return [sx + r * Math.cos(ang(0)), sy + r * Math.sin(ang(0))];
    case 2: return [sx - d, hy];
    case 3: return [-sx + r * Math.cos(ang(1)), sy + r * Math.sin(ang(1))];
    case 4: return [-hx, sy - d];
    case 5: return [-sx + r * Math.cos(ang(2)), -sy + r * Math.sin(ang(2))];
    case 6: return [-sx + d, -hy];
    default: return [sx + r * Math.cos(ang(3)), -sy + r * Math.sin(ang(3))];
  }
}
