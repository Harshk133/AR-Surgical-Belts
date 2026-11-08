// Procedural figure-of-8 clavicle brace in the reference-torso space (see clavicleConfig.js).
//
// Each loop is a smooth closed curve through anatomical way points (back plate -> over the trapezius
// -> front of the shoulder -> under the armpit -> across the back), whose depth comes from the fitted
// torso: front / back surface or crest at that (x, y). The curve is then pushed out radially onto the
// torso surface (+ padding) so it hugs the body between the way points, and resampled evenly. The
// strap is a padded ribbon (wider and thicker over the shoulder) with green-piped edges; the two loops
// meet on a padded back plate carrying the buckle.
import * as THREE from 'three';
import { CLAVICLE as CFG } from '../model/clavicleConfig.js';
import { IMMOBILIZER } from '../model/immobilizerConfig.js';
import { applyBraceShader, occluderMaterial } from './BraceModel.js';
import { Grid, canvasTex, fabricMap, heightToNormalTex, knitHeight, stitchLine } from './WristBrace.js';
import { ImmobilizerModel, TorsoShape } from './ImmobilizerModel.js';

const TAU = Math.PI * 2;
const N_SUP = IMMOBILIZER.superN;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
const NL = 140; // samples along each loop

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const H = knitHeight(256, 256, 51);
  TEX = {
    // foam-laminated mesh; across the strap (u) the edges carry green piping (u ~ 0.25 / 0.75 are
    // the two edges of the ribbon's cross-section)
    strap: fabricMap(H, 256, 256, [98, 103, 109], 0.35, (ctx, w, h) => {
      for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) {
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, y, 2, 2); // mesh pores
      }
      for (const c of [0.25, 0.75]) {
        ctx.fillStyle = '#2c9a7b';
        ctx.fillRect(w * (c - 0.035), 0, w * 0.07, h);
        stitchLine(ctx, w * c, 0, w * c, h, 'rgba(220,245,235,0.7)', [6, 4], 1.5);
      }
    }),
    strapN: heightToNormalTex(H, 256, 256, 1.6),
    plate: fabricMap(H, 256, 256, [90, 95, 101], 0.3, (ctx, w, h) => {
      ctx.strokeStyle = '#2c9a7b';
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.save();
      ctx.strokeStyle = 'rgba(160,166,172,0.8)';
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 2;
      ctx.strokeRect(w * 0.12, h * 0.12, w * 0.76, h * 0.76);
      ctx.restore();
    }),
  };
  return TEX;
}

export class ClavicleModel {
  constructor({ mode = 'ar', maskUniforms = null } = {}) {
    this.mode = mode;
    this.root = new THREE.Group();
    this.root.name = 'ClavicleBrace';
    this.occluder = new THREE.Group();
    this.occluder.name = 'BodyOccluder';
    this.torso = new TorsoShape();
    const T = textures();
    const fabric = (map) =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        normalMap: T.strapN,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.9,
        metalness: 0,
        sheen: 0.7,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0x9aa1a8),
      });
    this.materials = {
      strap: fabric(T.strap),
      plate: fabric(T.plate),
      buckle: new THREE.MeshPhysicalMaterial({ color: 0x2d3034, roughness: 0.35, metalness: 0, clearcoat: 0.5 }),
    };
    if (mode === 'ar' && maskUniforms) for (const m of Object.values(this.materials)) applyBraceShader(m, { maskUniforms });
    this.skin = mode === 'ar'
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
      loopL: add('Loop_L', new Grid(13, NL + 1, { closedU: true, closedV: true, vScale: 10 }), this.materials.strap),
      loopR: add('Loop_R', new Grid(13, NL + 1, { closedU: true, closedV: true, vScale: 10 }), this.materials.strap),
      plate: add('BackPlate', new Grid(24, 24), this.materials.plate),
      buckle: add('Buckle', new Grid(7, 41, { closedU: true, closedV: true }), this.materials.buckle),
      body: add('Torso', new Grid(65, 36, { closedU: true }), this.skin, this.occluder),
    };
    if (mode === 'inspect') {
      for (const k of ['armLU', 'armLF', 'armRU', 'armRF']) this.g[k] = add(k, new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
    }
    this.helper = Object.create(ImmobilizerModel.prototype); // rectRing / capsule helpers
  }

  /** Normalised superellipse radius of (x, y, z) w.r.t. the torso grown by off (< 1 inside). */
  rho(x, y, z, off, g) {
    const sec = this.torso.section(y, g);
    const u = Math.abs(x - sec.cx) / (sec.a + off);
    const dz = z - sec.cz;
    const v = Math.abs(dz) / ((dz >= 0 ? sec.bf : sec.bb) + off);
    return { r: (u ** N_SUP + v ** N_SUP) ** (1 / N_SUP), sec };
  }

  pushOut(p, off, g) {
    const { r, sec } = this.rho(p.x, p.y, p.z, off, g);
    if (r < 1 && r > 1e-6) {
      p.x = sec.cx + (p.x - sec.cx) / r;
      p.z = sec.cz + (p.z - sec.cz) / r;
    }
    return p;
  }

  /** Wrap over the shoulder ball and the top of the upper arm of side sx (not in the armpit). */
  pushOutArm(p, sx, off) {
    const B = CFG.shoulderBall;
    const S = _s.set(sx * B.x, B.y, B.z);
    const rb = B.r + off;
    const d = p.distanceTo(S);
    if (d < rb && d > 1e-6) p.sub(S).multiplyScalar(rb / d).add(S);
    const U = CFG.upperArm;
    if (p.y > U.aboveY) {
      const E = _e.set(sx * U.to[0], U.to[1], U.to[2]);
      const ax = _a.subVectors(E, S);
      const L = ax.length();
      ax.divideScalar(L);
      const t = clamp(_b.subVectors(p, S).dot(ax), 0, L);
      const c = _c.copy(S).addScaledVector(ax, t);
      const rr = U.r + off;
      const dd = p.distanceTo(c);
      if (dd < rr && dd > 1e-6) p.sub(c).multiplyScalar(rr / dd).add(c);
    }
    return p;
  }

  crest(x, g) {
    let yc = -0.2;
    for (let y = -0.2; y < 0.14; y += 0.002) {
      if (Number.isFinite(this.torso.frontZ(x, y, g))) yc = y;
      else break;
    }
    return yc;
  }

  /** Way points (config) -> 3D on the fitted body, for side sx (+1 left, -1 right). */
  wayPoints(sx, g) {
    const off = CFG.offset;
    return CFG.loop.map((w) => {
      const x = sx * w.x;
      if (w.y === 'crest') {
        const yc = this.crest(x, g);
        const sec = this.torso.section(yc - 0.01, g);
        return new THREE.Vector3(x, yc + off, sec.cz);
      }
      const sec = this.torso.section(w.y, g);
      let z;
      if (w.on === 'front') z = this.torso.frontZ(x, w.y, g);
      else if (w.on === 'back') z = this.torso.backZ(x, w.y, g);
      else z = sec.cz;
      if (!Number.isFinite(z)) z = sec.cz; // beyond the torso's width (armpit): at the side
      if (w.inset) z = lerp(z, sec.cz, w.inset);
      return this.pushOutArm(this.pushOut(new THREE.Vector3(x, w.y, z), off, g), sx, off);
    });
  }

  /** rig: { factors, girth } */
  update(rig) {
    const g = rig.girth ?? 1;
    this.torso.set(rig.factors);
    for (const sx of [1, -1]) this.buildLoop(sx > 0 ? this.g.loopL : this.g.loopR, sx, g);
    this.buildPlate(g);

    const gt = this.g.body;
    const p = [0, 0];
    for (let j = 0; j < gt.nv; j++) {
      const y = lerp(-0.8, 0.13, j / (gt.nv - 1));
      const sec = this.torso.section(y, 1);
      for (let i = 0; i < gt.nu; i++) {
        this.torso.point(sec, (i / (gt.nu - 1)) * TAU, -0.004, p);
        gt.set(i, j, p[0], y, p[1]);
      }
    }
    gt.finish();
    if (this.g.armLU) this.mannequinArms();
  }

  buildLoop(grid, sx, g) {
    const wp = this.wayPoints(sx, g);
    const curve = new THREE.CatmullRomCurve3(wp, true, 'centripetal');
    let pts = curve.getSpacedPoints(NL * 2).slice(0, -1);
    // hug the body between the way points (a padded strap under tension lies on the surface)
    const off = CFG.offset;
    for (let it = 0; it < 10; it++) {
      pts = pts.map((p) => this.pushOutArm(this.pushOut(p.clone(), off, g), sx, off));
      const n = pts.length;
      pts = pts.map((p, k) => p.clone().multiplyScalar(0.5).addScaledVector(pts[(k - 1 + n) % n], 0.25).addScaledVector(pts[(k + 1) % n], 0.25));
    }
    pts = pts.map((p) => this.pushOutArm(this.pushOut(p, off, g), sx, off));
    pts = resampleClosed(pts, NL);
    const yc = this.crest(sx * 0.112, g);
    // the strap lies flat on the surface: orient it by the true surface normal (superellipse
    // gradient of the torso section), blending to the shoulder ball's normal where it wraps the joint
    // and tipping upward where it goes over the top of the shoulder
    const B = CFG.shoulderBall;
    const ball = new THREE.Vector3(sx * B.x, B.y, B.z);
    const normal = (p) => {
      const sec = this.torso.section(Math.min(p.y, yc - 0.02), g);
      const dx = p.x - sec.cx;
      const dz = p.z - sec.cz;
      const bz = dz >= 0 ? sec.bf : sec.bb;
      const nT = new THREE.Vector3(
        (Math.sign(dx) * Math.abs(dx / sec.a) ** (N_SUP - 1)) / sec.a,
        0,
        (Math.sign(dz) * Math.abs(dz / bz) ** (N_SUP - 1)) / bz,
      ).normalize();
      nT.y += Math.max(p.y - (yc - 0.07), 0) * 14; // over the crest the surface faces up
      nT.normalize();
      const db = p.distanceTo(ball);
      const k = 1 - smooth(B.r + off, B.r + off + 0.02, db); // on the ball: its own normal
      return nT.lerp(p.clone().sub(ball).normalize(), k).normalize();
    };
    const shoulder = (p) => smooth(0.08, 0.12, Math.abs(p.x)) * smooth(-0.17, -0.12, p.y);
    const n = pts.length;
    // a padded strap can't twist sharply: smooth the surface normals along the loop
    let nors = pts.map((p) => normal(p));
    for (let it = 0; it < 6; it++) {
      nors = nors.map((v, k) => v.clone().multiplyScalar(2).add(nors[(k - 1 + n) % n]).add(nors[(k + 1) % n]).normalize());
    }
    // padding (width/thickness) changes gradually along the strap, not with x
    let pad = pts.map((p) => shoulder(p));
    for (let it = 0; it < 12; it++) pad = pad.map((v, k) => (2 * v + pad[(k - 1 + n) % n] + pad[(k + 1) % n]) / 4);
    for (let k = 0; k <= n; k++) {
      const p = pts[k % n];
      const T = pts[(k + 1) % n].clone().sub(pts[(k - 1 + n) % n]).normalize();
      const N = nors[k % n].clone();
      N.addScaledVector(T, -N.dot(T)).normalize();
      const W = new THREE.Vector3().crossVectors(N, T);
      const s = pad[k % n];
      const w = lerp(CFG.width.back, CFG.width.shoulder, s);
      const th = lerp(CFG.thickness.back, CFG.thickness.shoulder, s);
      const c = p.clone().addScaledVector(N, th * 0.5);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const cw = spow(Math.sin(ph), 0.35) * w * 0.5;
        const cn = spow(Math.cos(ph), 0.35) * th * 0.5;
        grid.set(i, k, c.x + N.x * cn + W.x * cw, c.y + N.y * cn + W.y * cw, c.z + N.z * cn + W.z * cw);
      }
    }
    grid.finish();
  }

  /** Padded plate between the shoulder blades where the loops meet, with the buckle. */
  buildPlate(g) {
    const P = CFG.plate;
    const gp = this.g.plate;
    const off = CFG.offset + CFG.thickness.back + 0.001;
    for (let j = 0; j < gp.nv; j++) {
      const v = j / (gp.nv - 1);
      const y = P.y + (v - 0.5) * 2 * P.halfH;
      for (let i = 0; i < gp.nu; i++) {
        const u = i / (gp.nu - 1);
        const x = (u - 0.5) * 2 * P.halfW;
        const bump = Math.sqrt(Math.max(0, 1 - Math.abs(2 * u - 1) ** 6)) * Math.sqrt(Math.max(0, 1 - Math.abs(2 * v - 1) ** 6));
        const z = this.torso.backZ(x, y, g) - off - P.thickness * bump;
        gp.set(i, j, x, y, z);
      }
    }
    gp.finish();
    // buckle ring in the middle of the plate, lying on its surface
    const zc = this.torso.backZ(0, P.y, g) - off - P.thickness - 0.003;
    const C = new THREE.Vector3(0, P.y, zc);
    this.helper.rectRing.call(this, this.g.buckle, C, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), 0.03, 0.012, 0.003);
  }

  mannequinArms() {
    const cap = (grid, a, b, r0, r1) => this.helper.capsule.call(this, grid, a, b, r0, r1);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    cap(this.g.armLU, V(0.18, -0.01, 0), V(0.215, -0.31, -0.01), 0.055, 0.045);
    cap(this.g.armLF, V(0.215, -0.31, -0.01), V(0.225, -0.58, 0.04), 0.044, 0.034);
    cap(this.g.armRU, V(-0.18, -0.01, 0), V(-0.215, -0.31, -0.01), 0.055, 0.045);
    cap(this.g.armRF, V(-0.215, -0.31, -0.01), V(-0.225, -0.58, 0.04), 0.044, 0.034);
  }

  dispose() {
    Object.values(this.g).forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skin.dispose();
  }
}

const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Resample a closed polyline to n points evenly spaced by arc length. */
function resampleClosed(pts, n) {
  const P = [...pts, pts[0]];
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / n;
    while (j < P.length - 2 && cum[j + 1] < d) j++;
    const t = (d - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    out.push(P[j].clone().lerp(P[j + 1], clamp(t, 0, 1)));
  }
  return out;
}
