// Procedural lumbar & sacral support in the reference-torso space (see lumbarConfig.js).
//
// The belt is the fitted torso surface (reference superellipse sections x BodyShapeFitter factors, the
// same surface the Taylor's brace is reshaped to) offset by the elastic's thickness, between edges that
// sit higher at the back than at the front (covers the sacrum, clears the ribs and the groin). On top:
// the contoured rear panel with its spring-steel stays as ridges, the double-pull side straps converging
// toward the front, the velcro closure flap, and stitched edge bindings.
import * as THREE from 'three';
import { LUMBAR as CFG } from '../model/lumbarConfig.js';
import { applyBraceShader, occluderMaterial } from './BraceModel.js';
import { Grid, canvasTex, fabricMap, heightToNormalTex, knitHeight, stitchLine } from './WristBrace.js';
import { TorsoShape } from './ImmobilizerModel.js';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 0 at the front (90deg), 1 at the back (270deg), smooth in between. */
const backness = (th) => smooth(-1, 1, -Math.sin(th));
export const topEdge = (th) => lerp(CFG.top.front, CFG.top.back, backness(th));
export const bottomEdge = (th) => lerp(CFG.bottom.front, CFG.bottom.back, backness(th));

// ---------------------------------------------------------------------------------------------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const H1 = knitHeight(256, 256, 41);
  const H2 = knitHeight(256, 256, 43);
  const stripes = (ctx, w, h) => {
    // surgical elastic: alternating darker / lighter vertical ribs
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, 14, h);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x + 16, 0, 2, h);
    }
  };
  TEX = {
    elastic: fabricMap(H1, 256, 256, [62, 66, 72], 0.35, stripes),
    elasticN: heightToNormalTex(H1, 256, 256, 1.8),
    panel: fabricMap(H2, 256, 256, [74, 78, 84], 0.3, (ctx, w, h) => {
      // stitched outline of the contoured panel + the stay channels
      ctx.save();
      ctx.strokeStyle = 'rgba(150,156,162,0.75)';
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 2;
      const r = w * 0.18;
      ctx.beginPath();
      ctx.moveTo(w * 0.06 + r, h * 0.05);
      ctx.arcTo(w * 0.94, h * 0.05, w * 0.94, h * 0.95, r);
      ctx.arcTo(w * 0.94, h * 0.95, w * 0.06, h * 0.95, r);
      ctx.arcTo(w * 0.06, h * 0.95, w * 0.06, h * 0.05, r);
      ctx.arcTo(w * 0.06, h * 0.05, w * 0.94, h * 0.05, r);
      ctx.stroke();
      // stitched channels holding the spring-steel stays (u = (deg + 28) / 56)
      for (const d of CFG.stays.deg) {
        const x = ((d + CFG.rearPanel.halfDeg) / (2 * CFG.rearPanel.halfDeg)) * w;
        for (const dx of [-5, 5]) stitchLine(ctx, x + dx, h * 0.1, x + dx, h * 0.9, 'rgba(140,146,152,0.6)', [6, 4], 1.5);
      }
      ctx.restore();
    }),
    pull: fabricMap(H1, 256, 128, [56, 60, 66], 0.35, (ctx, w, h) => {
      stripes(ctx, w, h);
      // teal stitched edges of the double-pull straps (box art)
      stitchLine(ctx, 0, h * 0.13, w, h * 0.13, 'rgba(52,170,160,0.95)', [8, 4], 3);
      stitchLine(ctx, 0, h * 0.87, w, h * 0.87, 'rgba(52,170,160,0.95)', [8, 4], 3);
    }),
    flap: fabricMap(H2, 256, 256, [58, 62, 68], 0.3, (ctx, w, h) => {
      stripes(ctx, w, h);
      // horizontal velcro loop strip across the closure (photo 1) and the white label above it
      ctx.fillStyle = '#4f5359';
      ctx.fillRect(0, h * 0.44, w, h * 0.16);
      for (let x = 0; x < w; x += 3) {
        ctx.fillStyle = x % 6 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, h * 0.44, 1, h * 0.16);
      }
      stitchLine(ctx, 0, h * 0.445, w, h * 0.445, 'rgba(140,146,152,0.8)', [5, 4], 2);
      stitchLine(ctx, 0, h * 0.595, w, h * 0.595, 'rgba(140,146,152,0.8)', [5, 4], 2);
      ctx.fillStyle = '#f3f3ef';
      ctx.fillRect(w * 0.42, h * 0.27, w * 0.26, h * 0.13);
      ctx.fillStyle = '#d63a3a';
      ctx.beginPath();
      ctx.arc(w * 0.49, h * 0.335, h * 0.035, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2f6fb6';
      ctx.font = `italic 600 ${Math.round(h * 0.045)}px Georgia, serif`;
      ctx.fillText('DaynoR', w * 0.53, h * 0.35);
      // centre seam (zig-zag stitch)
      ctx.strokeStyle = 'rgba(120,126,132,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = 0; y <= h; y += 6) ctx.lineTo(w * 0.15 + ((y / 6) % 2 ? 3 : -3), y);
      ctx.stroke();
    }),
    binding: canvasTex(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#25282c';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) {
        ctx.fillStyle = y % 4 ? '#2a2d31' : '#212327';
        ctx.fillRect(0, y, w, 1);
      }
      stitchLine(ctx, 3, 0, 3, h, 'rgba(120,126,132,0.85)', [8, 5], 3);
      stitchLine(ctx, w - 3, 0, w - 3, h, 'rgba(120,126,132,0.85)', [8, 5], 3);
    }),
  };
  return TEX;
}

const NB = 128;
const NR = 22;

export class LumbarModel {
  constructor({ mode = 'ar', maskUniforms = null } = {}) {
    this.root = new THREE.Group();
    this.root.name = 'LumbarSacralSupport';
    this.occluder = new THREE.Group();
    this.occluder.name = 'BodyOccluder';
    this.torso = new TorsoShape();
    const T = textures();
    const fabric = (map, extra = {}) =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        normalMap: T.elasticN,
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.88,
        metalness: 0,
        sheen: 0.8,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(0x7c838b),
        ...extra,
      });
    this.materials = {
      belt: fabric(T.elastic),
      panel: fabric(T.panel),
      pull: fabric(T.pull),
      flap: fabric(T.flap),
      binding: new THREE.MeshStandardMaterial({ map: T.binding, roughness: 0.7, metalness: 0 }),
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
      belt: add('Belt', new Grid(NB + 1, NR, { closedU: true, uScale: 14, vScale: 1 }), this.materials.belt),
      panel: add('RearPanel', new Grid(40, 24), this.materials.panel),
      flap: add('FrontClosure', new Grid(20, NR), this.materials.flap),
      pullLU: add('DoublePull_L_Upper', new Grid(48, 10, { uScale: 4 }), this.materials.pull),
      pullLL: add('DoublePull_L_Lower', new Grid(48, 10, { uScale: 4 }), this.materials.pull),
      pullRU: add('DoublePull_R_Upper', new Grid(48, 10, { uScale: 4 }), this.materials.pull),
      pullRL: add('DoublePull_R_Lower', new Grid(48, 10, { uScale: 4 }), this.materials.pull),
      bindTop: add('Binding_Top', new Grid(7, NB + 1, { closedU: true, closedV: true, vScale: 40 }), this.materials.binding),
      bindBot: add('Binding_Bottom', new Grid(7, NB + 1, { closedU: true, closedV: true, vScale: 40 }), this.materials.binding),
      body: add('Torso', new Grid(65, 36, { closedU: true }), this.skin, this.occluder),
    };
    this._p = [0, 0];
  }

  /** Point on the fitted torso at height y, angle th, pushed out by off (girth g). */
  at(y, th, off, g, out = new THREE.Vector3()) {
    const sec = this.torso.section(y, g);
    this.torso.point(sec, th, off, this._p);
    return out.set(this._p[0], y, this._p[1]);
  }

  /** rig: { factors, girth } */
  update(rig) {
    const g = rig.girth ?? 1;
    this.torso.set(rig.factors);
    const T = CFG.thickness;
    const v = new THREE.Vector3();

    // ---- belt -------------------------------------------------------------------------------------
    const gb = this.g.belt;
    for (let i = 0; i <= NB; i++) {
      const th = (i / NB) * TAU;
      const y0 = bottomEdge(th);
      const y1 = topEdge(th);
      for (let j = 0; j < NR; j++) {
        // bevelled edges: the first and last rows sit on the body
        const t = j === 0 ? 0 : j === NR - 1 ? 1 : 0.015 + (0.97 * (j - 1)) / (NR - 3);
        const off = j === 0 || j === NR - 1 ? T * 0.2 : T;
        this.at(lerp(y0, y1, t), th, off, g, v);
        gb.set(i, j, v.x, v.y, v.z);
      }
    }
    gb.finish();
    this.edgeLoop(this.g.bindTop, (th) => topEdge(th) - 0.002, T * 0.5, g);
    this.edgeLoop(this.g.bindBot, (th) => bottomEdge(th) + 0.002, T * 0.5, g);

    // ---- contoured rear panel with the stays -------------------------------------------------
    const P = CFG.rearPanel;
    const gp = this.g.panel;
    for (let i = 0; i < gp.nu; i++) {
      const u = i / (gp.nu - 1);
      const dDeg = (u - 0.5) * 2 * P.halfDeg;
      const th = (270 + dDeg) * D2R;
      const y0 = bottomEdge(th) + P.inset;
      const y1 = topEdge(th) - P.inset;
      let stay = 0;
      for (const s of CFG.stays.deg) stay += CFG.stays.height * Math.exp(-(((dDeg - s) / CFG.stays.widthDeg) ** 2));
      for (let j = 0; j < gp.nv; j++) {
        const w = j / (gp.nv - 1);
        // padded rounded-rectangle profile: full height inside, falling to the belt at the outline
        const bump = Math.sqrt(Math.max(0, 1 - Math.abs(2 * u - 1) ** 6)) * Math.sqrt(Math.max(0, 1 - Math.abs(2 * w - 1) ** 6));
        const inside = smooth(0, 0.08, Math.min(w, 1 - w));
        this.at(lerp(y0, y1, w), th, T + 0.0006 + P.height * bump + stay * inside, g, v);
        gp.set(i, j, v.x, v.y, v.z);
      }
    }
    gp.finish();

    // ---- front velcro closure flap -------------------------------------------------------------
    const F = CFG.flap;
    const gf = this.g.flap;
    for (let i = 0; i < gf.nu; i++) {
      const u = i / (gf.nu - 1);
      const th = lerp(F.fromDeg, F.toDeg, u) * D2R;
      const lip = i === 0 ? 0.15 : 1; // the free edge steps down onto the belt
      for (let j = 0; j < gf.nv; j++) {
        const t = j === 0 ? 0.01 : j === gf.nv - 1 ? 0.99 : 0.025 + (0.95 * (j - 1)) / (gf.nv - 3);
        this.at(lerp(bottomEdge(th), topEdge(th), t), th, T + F.lift * lip, g, v);
        gf.set(i, j, v.x, v.y, v.z);
      }
    }
    gf.finish();

    // ---- double-pull side straps (wearer's left: -58 -> 62 deg; right is the mirror) -------------
    const Q = CFG.pull;
    const leftFrom = 180 - Q.fromDeg; // -58
    const strap = (grid, side, band) => {
      // u always runs with increasing angle; the rounded pull tab is at the front end
      const a0 = side > 0 ? leftFrom : 180 - Q.toDeg;
      const a1 = side > 0 ? Q.toDeg : Q.fromDeg;
      const tabAtEnd = side > 0;
      const rho = (Q.height * 0.5) / 0.15; // ~ angular radius of the round tab (rad at a 15 cm radius)
      for (let i = 0; i < grid.nu; i++) {
        const u = i / (grid.nu - 1);
        const th = lerp(a0, a1, u) * D2R;
        const toFront = tabAtEnd ? u : 1 - u; // 0 at the rear panel, 1 at the tab
        const yc = lerp(band.back, band.front, smooth(0, 1, toFront));
        // rounded tab: the strap narrows to a semicircle over the last ~rho of its length
        const span = Math.abs(a1 - a0) * D2R;
        const fromTab = (1 - toFront) * span;
        const round = fromTab < rho ? Math.sqrt(Math.max(0, 1 - ((rho - fromTab) / rho) ** 2)) : 1;
        const rise = smooth(0, 0.12, toFront); // emerges from under the rear panel
        for (let j = 0; j < grid.nv; j++) {
          const edge = j === 0 || j === grid.nv - 1;
          const w = edge ? (j === 0 ? 0 : 1) : 0.05 + (0.9 * (j - 1)) / (grid.nv - 3);
          const y = yc + (w - 0.5) * Q.height * Math.max(round, 0.02);
          this.at(y, th, T + (edge ? 0.0005 : Q.lift * rise + 0.0005), g, v);
          grid.set(i, j, v.x, v.y, v.z);
        }
      }
      grid.finish();
    };
    strap(this.g.pullLU, 1, Q.upper);
    strap(this.g.pullLL, 1, Q.lower);
    strap(this.g.pullRU, -1, Q.upper);
    strap(this.g.pullRL, -1, Q.lower);

    // ---- fitted torso (depth-only in AR, dress form in the inspector) -----------------------
    const gt = this.g.body;
    for (let j = 0; j < gt.nv; j++) {
      const y = lerp(-0.8, 0.13, j / (gt.nv - 1));
      const sec = this.torso.section(y, 1);
      for (let i = 0; i < gt.nu; i++) {
        this.torso.point(sec, (i / (gt.nu - 1)) * TAU, -0.004, this._p);
        gt.set(i, j, this._p[0], y, this._p[1]);
      }
    }
    gt.finish();
  }

  /** Stitched binding along an edge y = yFn(theta). */
  edgeLoop(grid, yFn, off, g) {
    const r = CFG.binding;
    const n = grid.nv - 1;
    const pts = [];
    const outs = [];
    for (let k = 0; k < n; k++) {
      const th = (k / n) * TAU;
      const y = yFn(th);
      const p = this.at(y, th, off, g);
      const sec = this.torso.section(y, g);
      pts.push(p);
      outs.push(new THREE.Vector3(p.x - sec.cx, 0, p.z - sec.cz));
    }
    for (let k = 0; k <= n; k++) {
      const p = pts[k % n];
      const T = pts[(k + 1) % n].clone().sub(pts[(k - 1 + n) % n]).normalize();
      const A = outs[k % n].clone().addScaledVector(T, -outs[k % n].dot(T)).normalize();
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

  dispose() {
    Object.values(this.g).forEach((g) => g.geometry.dispose());
    Object.values(this.materials).forEach((m) => m.dispose());
    this.skin.dispose();
  }
}
