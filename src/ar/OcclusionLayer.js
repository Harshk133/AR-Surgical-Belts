// Approximate body occlusion from a single RGB camera.
//  - Arms / neck / head are depth-only cylinders + spheres placed at the estimated 3D joints (from the same
//    perspective solve as the torso), so an arm hanging at the side hides the strap under it.
//  - Those capsules are trimmed to the segmentation mask so an over-fat capsule never hides the
//    brace where there is no person.
// This is a conservative approximation: landmark depth is estimated, not measured.
import * as THREE from 'three';
import { LM } from './TorsoTransform.js';
import { applySilhouetteClip } from './BraceModel.js';

const SEGMENTS = [
  // [from, to, radius (m at reference scale)]
  [LM.leftShoulder, LM.leftElbow, 0.05],
  [LM.leftElbow, LM.leftWrist, 0.04],
  [LM.rightShoulder, LM.rightElbow, 0.05],
  [LM.rightElbow, LM.rightWrist, 0.04],
];

export class OcclusionLayer {
  constructor(scene, maskUniforms) {
    this.group = new THREE.Group();
    this.group.name = 'OcclusionLayer';
    scene.add(this.group);
    this.material = new THREE.MeshBasicMaterial({ colorWrite: false });
    applySilhouetteClip(this.material, maskUniforms, { dilate: false, threshold: 0.5 });
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    this.sphere = new THREE.SphereGeometry(1, 12, 8);
    this.limbs = SEGMENTS.map(([a, b, r]) => {
      const m = new THREE.Mesh(this.geometry, this.material);
      m.renderOrder = -1;
      m.frustumCulled = false;
      this.group.add(m);
      return { a, b, r, mesh: m };
    });
    // spheres at shoulder/elbow/wrist close the gaps between cylinders
    this.jointSpheres = [LM.leftShoulder, LM.leftElbow, LM.leftWrist, LM.rightShoulder, LM.rightElbow, LM.rightWrist]
      .map((j, k) => {
        const m = new THREE.Mesh(this.sphere, this.material);
        m.renderOrder = -1;
        this.group.add(m);
        return { j, r: k % 3 === 0 ? 0.055 : k % 3 === 1 ? 0.045 : 0.035, mesh: m };
      });
    this.neck = new THREE.Mesh(this.geometry, this.material);
    this.neck.renderOrder = -1;
    this.head = new THREE.Mesh(this.sphere, this.material);
    this.head.renderOrder = -1;
    this.group.add(this.neck, this.head);
    this.enabled = true;
  }

  update(state, bodyScale) {
    this.group.visible = this.enabled && state.valid;
    if (!this.group.visible) return;
    const J = state.joints;
    for (const limb of this.limbs) {
      placeCapsule(limb.mesh, J[limb.a], J[limb.b], limb.r * bodyScale);
    }
    for (const s of this.jointSpheres) {
      s.mesh.position.copy(J[s.j]);
      s.mesh.scale.setScalar(s.r * bodyScale);
    }
    // Neck: shoulder midpoint -> between the ears (pulled slightly back, behind the chin).
    _a.addVectors(J[LM.leftShoulder], J[LM.rightShoulder]).multiplyScalar(0.5);
    _b.addVectors(J[LM.leftEar], J[LM.rightEar]).multiplyScalar(0.5);
    placeCapsule(this.neck, _a, _b, 0.055 * bodyScale);
    this.head.position.copy(_b);
    this.head.scale.setScalar(0.1 * bodyScale);
  }

  dispose() {
    this.geometry.dispose();
    this.sphere.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

function placeCapsule(mesh, a, b, r) {
  _d.subVectors(b, a);
  const len = _d.length();
  if (len < 1e-4) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, _d.divideScalar(len));
  mesh.scale.set(r, len, r);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
