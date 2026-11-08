// Procedural arm sling pouch in the reference-torso space (see armSlingConfig.js).
//
//  - Pouch: an open-topped U trough built on the tracked forearm. The elbow sits in the closed corner;
//    the U bottom lies just under the forearm (slack + fabric); the side walls rise higher at the elbow
//    than at the hand (the trapezoid of the box photo); the hand end is open with the fingers out.
//  - Strap: from the hand end, up the chest, over the OPPOSITE shoulder and down the back to the elbow
//    end. Over the shoulder it is found by marching rays from inside the torso to its fitted surface
//    in the side plane at the strap's x (so it sits on the shoulder, not on the neck); the chest and back
//    runs are straight lines pushed out onto the fitted torso surface (a strap under tension lies on
//    the body's convex side), then smoothed and resampled. A comfort pad widens it over the shoulder.
//  - Body: depth-only fitted torso; the forearm/upper arm/hand occluders live in the renderer.
import * as THREE from 'three';
import { ARM_SLING as CFG } from '../model/armSlingConfig.js';
import { IMMOBILIZER } from '../model/immobilizerConfig.js';
import { occluderMaterial } from './BraceModel.js';
import { Grid } from './WristBrace.js';
import { ImmobilizerModel, TorsoShape, textures } from './ImmobilizerModel.js';

const TAU = Math.PI * 2;
const N_SUP = IMMOBILIZER.superN;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;

const NU = 41; // around the U
const CAP = 5; // rows of the closed elbow end
const NV = 32; // rows along the pouch (incl. CAP)
const NSTRAP = 110;

export function canonicalSlingRig() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const E = V(0.2, -0.3, 0.04);
  const W = V(-0.04, -0.285, 0.2);
  return {
    factors: null,
    girth: 1,
    side: 1, // the wearer's left arm in the sling
    arm: { valid: true, inPose: true, wrap: true, S: V(0.18, 0, 0), E, W, H: W.clone().addScaledVector(W.clone().sub(E).normalize(), 0.08) },
    other: { S: V(-0.18, 0, 0), E: V(-0.21, -0.3, -0.01), W: V(-0.22, -0.55, 0.03) },
  };
}

export class SlingModel {
  constructor({ mode = 'ar' } = {}) {
    this.mode = mode;
    this.root = new THREE.Group();
    this.root.name = 'ArmSlingPouch';
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
        side: THREE.DoubleSide, // the inside of the open pouch is visible
      });
    this.materials = {
      pouch: fabric(T.fabric),
      strap: fabric(T.strap),
      pad: fabric(T.fabric),
      piping: new THREE.MeshStandardMaterial({ map: T.piping, roughness: 0.6, metalness: 0 }),
      buckle: new THREE.MeshPhysicalMaterial({ color: 0x2d3034, roughness: 0.35, metalness: 0, clearcoat: 0.5 }),
    };
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
    this.pipeN = 2 * NV + NU - 3; // edge (NV) + hand opening (NU-1) + other edge (NV-2)
    this.g = {
      pouch: add('Pouch', new Grid(NU, NV, { uScale: 3, vScale: 2.5 }), this.materials.pouch),
      piping: add('Piping', new Grid(7, this.pipeN + 1, { closedU: true, closedV: true, vScale: 40 }), this.materials.piping),
      strap: add('Strap', new Grid(9, NSTRAP, { closedU: true, vScale: 14 }), this.materials.strap),
      buckle: add('Buckle', new Grid(7, 41, { closedU: true, closedV: true }), this.materials.buckle),
      body: add('Torso', new Grid(65, 36, { closedU: true }), this.skin, this.occluder),
    };
    if (mode === 'inspect') {
      for (const k of ['armUp', 'armFore', 'hand', 'otherUp', 'otherFore']) this.g[k] = add(k, new Grid(25, 12, { closedU: true }), this.skin, this.occluder);
    }
    // borrow the immobilizer's helpers (ribbon, rect ring, capsule) without its meshes
    this.helper = Object.create(ImmobilizerModel.prototype);
  }

  /** rig: { factors, girth, side, arm: { valid, inPose, S, E, W, H } } (reference space) */
  update(rig) {
    const g = rig.girth ?? 1;
    const torso = this.torso.set(rig.factors);
    const arm = rig.arm;
    this.root.visible = !!(arm?.valid && arm.inPose);
    if (this.root.visible) {
      this.buildPouch(arm, g);
      this.buildStrap(arm, rig.side, g, torso);
    }
    // fitted torso (depth-only in AR, mannequin in the inspector)
    const gt = this.g.body;
    const p = [0, 0];
    for (let j = 0; j < gt.nv; j++) {
      const y = lerp(-0.8, 0.13, j / (gt.nv - 1));
      const sec = torso.section(y, 1);
      for (let i = 0; i < gt.nu; i++) {
        torso.point(sec, (i / (gt.nu - 1)) * TAU, -0.004, p);
        gt.set(i, j, p[0], y, p[1]);
      }
    }
    gt.finish();
    if (this.g.armUp) this.mannequin(rig);
  }

  // ---- pouch ----------------------------------------------------------------------------------
  buildPouch(arm, g) {
    const P = CFG.pouch;
    const dir = new THREE.Vector3().subVectors(arm.W, arm.E);
    const len = dir.length();
    dir.divideScalar(len);
    const A = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y);
    if (A.lengthSq() < 1e-6) A.set(0, 0, 1).addScaledVector(dir, -dir.z);
    A.normalize();
    const Bv = new THREE.Vector3().crossVectors(A, dir);
    const handReach = Math.max(arm.H.clone().sub(arm.W).dot(dir), 0.03);
    const s0 = -P.behindElbow;
    const s1 = len + P.endAlongHand * handReach;
    const e = 2 / 3; // n = 3: a flat-bottomed U
    const C = spow(Math.cos((P.openDeg * Math.PI) / 180), e);
    const phi0 = (P.openDeg * Math.PI) / 180;
    const section = (s) => {
      const t = clamp(s / len, 0, 1);
      const rf = lerp(CFG.forearmRadius[0], CFG.forearmRadius[1], t) * g;
      const db = rf + P.slack + P.thickness; // bottom below the forearm axis
      const ht = rf + lerp(P.wallAbove[0], P.wallAbove[1], clamp(s / s1, 0, 1)); // top edge above it
      const hv = (ht + db) / (1 + C);
      return { m: hv - db, hv, rh: rf + P.slack + P.thickness };
    };
    this.pouch = { dir, A, Bv, s0, s1, len, section };
    const gp = this.g.pouch;
    for (let j = 0; j < NV; j++) {
      let s;
      let kh; // horizontal scale (0 at the centre line of the closed end panel)
      if (j < CAP) {
        const q = (j / CAP) * (Math.PI / 2);
        s = s0 - P.endDepth * Math.cos(q);
        kh = Math.sin(q);
      } else {
        s = lerp(s0, s1, (j - CAP) / (NV - CAP - 1));
        kh = 1;
      }
      const sec = section(Math.max(s, 0));
      const c = arm.E.clone().addScaledVector(dir, s);
      for (let i = 0; i < NU; i++) {
        const phi = lerp(phi0, TAU - phi0, i / (NU - 1));
        const va = sec.m + sec.hv * spow(Math.cos(phi), e);
        const vb = sec.rh * kh * spow(Math.sin(phi), e);
        gp.set(i, j, c.x + A.x * va + Bv.x * vb, c.y + A.y * va + Bv.y * vb, c.z + A.z * va + Bv.z * vb);
      }
    }
    gp.finish();

    // piping: one closed loop along the top edges, round the hand opening and back
    const pos = gp.pos;
    const at = (i, j) => new THREE.Vector3(pos[(j * NU + i) * 3], pos[(j * NU + i) * 3 + 1], pos[(j * NU + i) * 3 + 2]);
    const loop = [];
    for (let j = 0; j < NV; j++) loop.push(at(0, j));
    for (let i = 1; i < NU; i++) loop.push(at(i, NV - 1));
    for (let j = NV - 2; j >= 1; j--) loop.push(at(NU - 1, j));
    const centre = (p) => {
      const s = clamp(p.clone().sub(arm.E).dot(dir), s0, s1);
      return arm.E.clone().addScaledVector(dir, s).addScaledVector(A, section(Math.max(s, 0)).m);
    };
    this.tubeLoop(this.g.piping, loop, (p) => p.clone().sub(centre(p)), CFG.piping);
    this.pouchPts = { front: [at(0, NV - 1), at(NU - 1, NV - 1)], back: at(0, 0) };
  }

  // ---- strap ----------------------------------------------------------------------------------
  /** Is (x, y, z) inside the fitted torso grown by off? Returns the normalised radius (<1 inside). */
  rho(x, y, z, off, g) {
    const sec = this.torso.section(y, g);
    const u = Math.abs(x - sec.cx) / (sec.a + off);
    const dz = z - sec.cz;
    const v = Math.abs(dz) / ((dz >= 0 ? sec.bf : sec.bb) + off);
    return { r: (u ** N_SUP + v ** N_SUP) ** (1 / N_SUP), sec };
  }

  /** Push a point out of the torso (radially in its horizontal section) onto surface + off. */
  pushOut(p, off, g) {
    const { r, sec } = this.rho(p.x, p.y, p.z, off, g);
    if (r < 1 && r > 1e-6) {
      p.x = sec.cx + (p.x - sec.cx) / r;
      p.z = sec.cz + (p.z - sec.cz) / r;
    }
    return p;
  }

  /** March from an inside point along dir to the torso surface (+ off). */
  rayToSurface(o, dir, off, g) {
    const p = o.clone();
    for (let t = 0; t < 0.6; t += 0.002) {
      p.copy(o).addScaledVector(dir, t);
      if (this.rho(p.x, p.y, p.z, off, g).r >= 1) return p;
    }
    return p;
  }

  buildStrap(arm, side, g, torso) {
    const S = CFG.strap;
    const xo = -side * S.shoulderX; // OPPOSITE shoulder
    // shoulder crest at that x: the highest y where the torso is still wider than |x|
    let yc = -0.2;
    for (let y = -0.2; y < 0.14; y += 0.002) {
      if (Number.isFinite(torso.frontZ(xo, y, g))) yc = y;
      else break;
    }
    const yF = yc - 0.07; // where the strap leaves the chest / back to go over the shoulder
    const off = S.offset;
    // over the shoulder: rays in the side plane from inside the shoulder
    const secF = torso.section(yF, g);
    const O = new THREE.Vector3(xo, yF, secF.cz);
    const arc = [];
    for (let k = 0; k <= 24; k++) {
      const th = (k / 24) * Math.PI; // 0 = front, pi/2 = up, pi = back
      arc.push(this.rayToSurface(O, new THREE.Vector3(0, Math.sin(th), Math.cos(th)), off, g));
    }
    const pf = this.pouchPts.front[0].z > this.pouchPts.front[1].z ? this.pouchPts.front[0] : this.pouchPts.front[1];
    const pb = this.pouchPts.back;
    const line = (a, b, n) => {
      const out = [];
      for (let k = 1; k < n; k++) out.push(this.pushOut(a.clone().lerp(b, k / n), off, g));
      return out;
    };
    let path = [pf.clone(), ...line(pf, arc[0], 30), ...arc, ...line(arc[arc.length - 1], pb, 36), pb.clone()];
    // tension: smooth, keep it on/outside the body, keep the ends on their attachments
    for (let it = 0; it < 6; it++) {
      path = path.map((p, k) => {
        if (k === 0 || k === path.length - 1) return p;
        const q = path[k - 1].clone().add(path[k + 1]).multiplyScalar(0.25).addScaledVector(p, 0.5);
        return this.pushOut(q, off, g);
      });
    }
    path = resample(path, NSTRAP);
    const normal = (p) => {
      const sec = torso.section(Math.min(p.y, yF), g);
      return new THREE.Vector3(p.x - sec.cx, Math.max(p.y - yF, 0) * 1.5, p.z - sec.cz).normalize();
    };
    const pad = (p) => smooth(yF - 0.06, yF, p.y);
    this.ribbonVar(this.g.strap, path, normal, (k) => lerp(S.width, S.padWidth, pad(path[k])), (k) => lerp(S.thickness, S.padThickness, pad(path[k])));
    // buckle on the chest run, 40 % of the way from the pouch to the shoulder
    const yB = lerp(pf.y, yF, 0.45);
    let kk = 2;
    while (kk < NSTRAP - 3 && path[kk].y < yB) kk++;
    const tng = path[kk + 1].clone().sub(path[kk - 1]).normalize();
    const nrm = normal(path[kk]);
    const across = new THREE.Vector3().crossVectors(nrm, tng).normalize();
    const Cb = path[kk].clone().addScaledVector(nrm, S.thickness + 0.002);
    this.helper.rectRing.call(this, this.g.buckle, Cb, across, tng, nrm, S.width / 2 + 0.006, 0.01, 0.0028);
  }

  /** Flat strap with varying width / thickness along its length. */
  ribbonVar(grid, pts, nfn, wfn, tfn) {
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(k - 1, 0)];
      const b = pts[Math.min(k + 1, n - 1)];
      const T = b.clone().sub(a).normalize();
      const N = nfn(pts[k]);
      N.addScaledVector(T, -N.dot(T)).normalize();
      const W = new THREE.Vector3().crossVectors(N, T);
      const w = wfn(k);
      const th = tfn(k);
      const p = pts[k];
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const cw = spow(Math.sin(ph), 0.3) * w * 0.5;
        const cn = spow(Math.cos(ph), 0.3) * th * 0.5;
        grid.set(i, k, p.x + N.x * cn + W.x * cw, p.y + N.y * cn + W.y * cw, p.z + N.z * cn + W.z * cw);
      }
    }
    grid.finish();
  }

  /** Closed tube through pts (last connects to first); outFn(p) = outward reference. */
  tubeLoop(grid, pts, outFn, r) {
    const n = pts.length;
    for (let k = 0; k <= n; k++) {
      const p = pts[k % n];
      const T = pts[(k + 1) % n].clone().sub(pts[(k - 1 + n) % n]).normalize();
      const A = outFn(p);
      A.addScaledVector(T, -A.dot(T)).normalize();
      const B = new THREE.Vector3().crossVectors(A, T);
      for (let i = 0; i < grid.nu; i++) {
        const ph = (i / (grid.nu - 1)) * TAU;
        const c = Math.cos(ph) * r;
        const s = Math.sin(ph) * r;
        grid.set(i, k, p.x + A.x * c + B.x * s, p.y + A.y * c + B.y * s, p.z + A.z * c + B.z * s);
      }
    }
    grid.finish();
  }

  mannequin(rig) {
    const cap = (grid, a, b, r0, r1) => this.helper.capsule.call(this, grid, a, b, r0, r1);
    const { arm, other } = rig;
    cap(this.g.armUp, arm.S, arm.E, 0.05, 0.047);
    cap(this.g.armFore, arm.E, arm.W, 0.046, 0.036);
    cap(this.g.hand, arm.W, arm.H.clone().addScaledVector(arm.H.clone().sub(arm.W).normalize(), 0.06), 0.034, 0.026);
    cap(this.g.otherUp, other.S, other.E, 0.05, 0.047);
    cap(this.g.otherFore, other.E, other.W.clone().addScaledVector(other.W.clone().sub(other.E).normalize(), 0.09), 0.046, 0.032);
  }

  dispose() {
    Object.values(this.g).forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skin.dispose();
  }
}

/** Resample a polyline to n points evenly spaced by arc length. */
function resample(pts, n) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    while (j < pts.length - 2 && cum[j + 1] < d) j++;
    const t = (d - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    out.push(pts[j].clone().lerp(pts[j + 1], clamp(t, 0, 1)));
  }
  return out;
}
