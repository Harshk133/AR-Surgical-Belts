// The moment the product goes on: the real 3D model closes around the body from both sides and cinches
// in, while it is already tracking. Works on every renderer because it only touches what they share
// (renderer.anchor / adjust / brace, and a scene that lives in camera space).
import * as THREE from 'three';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const CINCH = 0.09; // how much wider than the body the belt starts (fraction)

const _box = new THREE.Box3();
const _p = new THREE.Vector3();

export class WearReveal {
  constructor(renderer, amount = 1) {
    this.r = renderer;
    this.amount = amount; // 0 = not on the body, 1 = fully worn
    this.anim = null;
    this.bounds = null;
    this.saved = new THREE.Vector3(1, 1, 1);
    this.applied = false;
    // Visible = the union of the two outer half-spaces (clipIntersection), so the gap between them
    // is what closes. In camera space, which keeps the seam vertical on screen whichever way the
    // limb points.
    this.planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];
    renderer.renderer.localClippingEnabled = true;
  }

  get root() {
    return this.r.brace?.root ?? this.r.brace;
  }

  set(amount) {
    this.amount = amount;
    this.anim = null;
  }

  /** Animates to `to`; resolves when finished (or after a timeout if frames stop, e.g. a hidden tab). */
  play(to, ms) {
    this.finishAnim();
    if (ms <= 0) {
      this.amount = to;
      return Promise.resolve();
    }
    this.measure();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishAnim(), ms + 300);
      this.anim = { from: this.amount, to, ms, t0: null, resolve, timer };
    });
  }

  finishAnim() {
    const a = this.anim;
    if (!a) return;
    this.amount = a.to;
    this.anim = null;
    clearTimeout(a.timer);
    a.resolve();
  }

  /** Width and centre of the model in camera space, relative to the tracked anchor. */
  measure() {
    const root = this.root;
    if (!root) return false;
    this.r.scene.updateMatrixWorld(true);
    _box.setFromObject(root, true);
    if (_box.isEmpty()) return false;
    const e = this.r.anchor.matrixWorld.elements;
    this.bounds = { cx: (_box.min.x + _box.max.x) / 2 - e[12], half: (_box.max.x - _box.min.x) / 2 };
    return true;
  }

  /** Where the model is on screen right now, in viewport pixels: { x, y, w, h } (x, y = centre). */
  screenBounds(canvasRect, mirrored) {
    const root = this.root;
    if (!root) return null;
    this.r.scene.updateMatrixWorld(true);
    _box.setFromObject(root, true);
    if (_box.isEmpty()) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _p.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).project(this.r.camera);
      const nx = (_p.x + 1) / 2;
      const px = canvasRect.left + (mirrored ? 1 - nx : nx) * canvasRect.width;
      const py = canvasRect.top + ((1 - _p.y) / 2) * canvasRect.height;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    const b = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    return Number.isFinite(b.x + b.y + b.w + b.h) ? b : null;
  }

  useClipping() {
    this.root?.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.clippingPlanes === this.planes) continue;
        m.clippingPlanes = this.planes;
        m.clipIntersection = true;
        m.needsUpdate = true;
      }
    });
  }

  /** @param veiled true while the model waits for its cue: draw it clipped, so its shaders are ready. */
  before(now, veiled) {
    const r = this.r;
    if (this.anim || veiled) this.useClipping();
    if (veiled) r.anchor.visible = true; // the canvas itself is still fully transparent

    let cinch = 0;
    const a = this.anim;
    if (a) {
      a.t0 ??= now;
      const t = Math.min((now - a.t0) / a.ms, 1);
      this.amount = a.from + (a.to - a.from) * easeInOut(t);
      cinch = a.to > a.from ? CINCH * (1 - easeOutBack(t)) : CINCH * (1 - this.amount);
      if (t >= 1) this.finishAnim();
    }

    if (this.amount >= 1) {
      this.setGap(0, -1); // the two half-spaces overlap: everything is visible
    } else {
      if (!this.bounds) this.measure();
      const e = r.anchor.matrixWorld.elements;
      const cx = (this.bounds?.cx ?? 0) + e[12];
      const half = (this.bounds?.half ?? 1) * 1.04;
      this.setGap(cx, half * (1 - this.amount));
    }

    this.applied = cinch !== 0;
    if (this.applied) {
      this.saved.copy(r.adjust.scale);
      r.adjust.scale.x *= 1 + cinch;
      r.adjust.scale.z *= 1 + cinch;
    }
  }

  setGap(cx, halfGap) {
    this.planes[0].constant = -(cx + halfGap);
    this.planes[1].constant = cx - halfGap;
  }

  /** The cinch is per-frame only: renderers treat adjust.scale as their own state. */
  after() {
    if (this.applied) this.r.adjust.scale.copy(this.saved);
    this.applied = false;
  }
}
