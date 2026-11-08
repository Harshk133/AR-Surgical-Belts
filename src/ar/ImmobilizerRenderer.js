// Renderer for the shoulder immobilizer: the Taylor's-brace renderer (same torso anchor, lighting,
// mask clip, latency handling) with the GLB replaced by the procedural ImmobilizerModel, and the arm
// occluders rebuilt on depth-ray-snapped joints so they line up with the band and pouch exactly.
import * as THREE from 'three';
import { ArRenderer } from './ArRenderer.js';
import { ImmobilizerModel } from './ImmobilizerModel.js';
import { applySilhouetteClip } from './BraceModel.js';

export class SnappedOcclusion {
  constructor(scene, maskUniforms) {
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false });
    applySilhouetteClip(this.material, maskUniforms, { dilate: false, threshold: 0.5 });
    this.cyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    this.sph = new THREE.SphereGeometry(1, 14, 10);
    const mk = (g) => {
      const m = new THREE.Mesh(g, this.material);
      m.renderOrder = -1;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    this.caps = Array.from({ length: 9 }, () => mk(this.cyl));
    this.forearm = false; // the arm sling's open pouch needs the forearm itself as an occluder
    this.head = mk(this.sph);
    this.enabled = true;
    this.data = null; // { J: camera-space snapped joints, side: 'left'|'right', S: body scale }
  }

  update(st) {
    const d = this.data;
    const on = this.enabled && st.valid && d;
    this.caps.forEach((c) => (c.visible = false));
    this.head.visible = false;
    if (!on) return;
    const { J, side, S } = d;
    const inj = side === 'left' ? [11, 13, 15] : [12, 14, 16];
    const oth = side === 'left' ? [12, 14, 16] : [11, 13, 15];
    const hand = (e, w, k) => _h.subVectors(J[w], J[e]).normalize().multiplyScalar(k).add(J[w]);
    // supported arm: only the parts outside the immobilizer (upper arm above the band, the hand)
    place(this.caps[0], J[inj[0]], _u.lerpVectors(J[inj[0]], J[inj[1]], 0.3), 0.05 * S);
    place(this.caps[1], J[inj[2]], d.H || hand(inj[1], inj[2], 0.09 * S), 0.035 * S);
    if (this.forearm) {
      place(this.caps[7], J[inj[1]], J[inj[2]], 0.04 * S);
      place(this.caps[8], J[inj[0]], J[inj[1]], 0.05 * S);
    }
    // other arm (often supporting the forearm: it must pass in front of the pouch)
    place(this.caps[2], J[oth[0]], J[oth[1]], 0.05 * S);
    place(this.caps[3], J[oth[1]], J[oth[2]], 0.04 * S);
    place(this.caps[4], J[oth[2]], hand(oth[1], oth[2], 0.08 * S), 0.035 * S);
    // neck + head hide the back straps in side views
    _m.addVectors(J[11], J[12]).multiplyScalar(0.5);
    _e.addVectors(J[7], J[8]).multiplyScalar(0.5);
    place(this.caps[5], _m, _e, 0.055 * S);
    this.head.visible = true;
    this.head.position.copy(_e);
    this.head.scale.setScalar(0.1 * S);
  }

  dispose() {
    this.cyl.dispose();
    this.sph.dispose();
    this.material.dispose();
  }
}

export class ImmobilizerRenderer extends ArRenderer {
  async loadBrace() {
    // No silhouette trim on the immobilizer itself: unlike a brace that hugs the skin, it legitimately
    // bridges gaps outside the body outline (band between arm and chest, pouch behind the elbow).
    // The mask is still used for the body-shape fit and to trim the occluders.
    this.model = this.createModel();
    this.adjust.add(this.model.root);
    this.anchor.add(this.model.occluder); // the body does not move with the alignment sliders
    this.occlusion.dispose();
    this.occlusion = new SnappedOcclusion(this.scene, this.maskUniforms);
    this.brace = this.model.root;
    this.renderer.compile(this.scene, this.camera);
  }

  createModel() {
    return new ImmobilizerModel({ mode: 'ar', maskUniforms: null });
  }

  updateGeometry(rig) {
    this.model?.update(rig);
  }

  update(st, adj, dt, opts) {
    super.update(st, adj, dt, opts);
    this.adjust.scale.setScalar(1); // "Size" is applied as girth inside the model, not as a scale
  }

  dispose() {
    this.model?.dispose();
    this.brace = null;
    super.dispose();
  }
}

function place(mesh, a, b, r) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-4) return;
  mesh.visible = true;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, _d.divideScalar(len));
  mesh.scale.set(r, len, r);
}

const _d = new THREE.Vector3();
const _h = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Vector3();
const _e = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
