// Three.js layer for the tennis elbow strap. Same camera contract and anchor/mirror handling as the
// wrist renderer; the model is the procedural ElbowStrap in the forearm frame. Occlusion: the forearm
// itself (from the strap's own section table) plus depth-only capsules in camera space for this upper
// arm and hand and for the other arm, trimmed to the person mask.
import * as THREE from 'three';
import { WristRenderer } from './WristRenderer.js';
import { ElbowStrap } from './ElbowStrap.js';
import { ARMS } from './ArmTransform.js';
import { applySilhouetteClip } from './BraceModel.js';

export class ElbowRenderer extends WristRenderer {
  async loadBrace() {
    this.brace = new ElbowStrap({ mode: 'ar', maskUniforms: this.maskUniforms });
    this.adjust.add(this.brace.root);
    this.anchor.add(this.brace.occluder);
    this.capMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    applySilhouetteClip(this.capMat, this.maskUniforms, { dilate: false, threshold: 0.5 });
    this.capGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false);
    this.caps = Array.from({ length: 5 }, () => {
      const m = new THREE.Mesh(this.capGeo, this.capMat);
      m.renderOrder = -1;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.renderer.compile(this.scene, this.camera);
  }

  updateGeometry(rig) {
    this.brace?.update(rig);
  }

  update(st, adj, dt, opts = {}) {
    const Lf = st.Lf || 0.26;
    super.update(st, adj, dt, { ...opts, span: 0.45 * Lf });
    this.adjust.rotation.set(0, THREE.MathUtils.degToRad(adj.rollDeg || 0), 0);
    const on = opts.occlusion && st.valid && st.arm;
    this.caps.forEach((c) => (c.visible = false));
    if (!on) return;
    const J = st.joints;
    const own = st.arm;
    const other = own === ARMS.left ? ARMS.right : ARMS.left;
    const hand = (a) => _h.addVectors(J[a.index], J[a.pinky]).multiplyScalar(0.5);
    // own upper arm starts a little above the elbow so it never cuts the strap at deep flexion
    _s.subVectors(J[own.S], J[own.E]).normalize().multiplyScalar(0.25 * Lf).add(J[own.E]);
    place(this.caps[0], _s, J[own.S], 0.15 * Lf);
    place(this.caps[1], J[own.W], hand(own), 0.11 * Lf);
    place(this.caps[2], J[other.S], J[other.E], 0.15 * Lf);
    place(this.caps[3], J[other.E], J[other.W], 0.12 * Lf);
    place(this.caps[4], J[other.W], hand(other), 0.1 * Lf);
  }

  dispose() {
    this.capGeo?.dispose();
    this.capMat?.dispose();
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
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
