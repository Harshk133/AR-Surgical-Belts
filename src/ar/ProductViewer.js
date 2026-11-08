// Stand-alone 3D inspector for the brace (no camera). Lets shoppers see the front, sides and the
// rear assembly from any angle, without implying the live camera has seen their back.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createBrace, disposeObject } from './BraceModel.js';

export const VIEW_ANGLES = { front: 0, left: 90, back: 180, right: -90, threeQuarter: 35 };

const TORSO = { target: [0, -0.25, 0], radius: 1.55, minDistance: 0.9, maxDistance: 3.2, near: 0.05, viewAngles: VIEW_ANGLES, defaultView: 'threeQuarter' };

/**
 * opts.createModel: async () => { root } (defaults to the Taylor's brace GLB on its dress form);
 * target / radius / distances / viewAngles frame the model.
 */
export class ProductViewer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = { ...TORSO, ...opts };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.35;
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 2);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(-1.5, 1, -2);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x50555a, 0.6), key, rim);

    this.camera = new THREE.PerspectiveCamera(30, 1, this.opts.near, 20);
    this.target = new THREE.Vector3(...this.opts.target);
    this.radius = this.opts.radius;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.target);
    this.controls.enablePan = false;
    this.controls.minDistance = this.opts.minDistance;
    this.controls.maxDistance = this.opts.maxDistance;
    this.controls.minPolarAngle = Math.PI * 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.8;
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => (this.anim = null));
    this.setView(this.opts.defaultView, false);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.raf = 0;
  }

  async load() {
    const { root } = await (this.opts.createModel ? this.opts.createModel() : createBrace({ mode: 'inspect' }));
    this.model = root;
    this.scene.add(root);
    this.resize();
    this.requestRender();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setView(name, animate = true) {
    const az = THREE.MathUtils.degToRad(this.opts.viewAngles[name] ?? 0);
    const el = THREE.MathUtils.degToRad(name === 'threeQuarter' ? 12 : 4);
    const to = new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ).multiplyScalar(this.radius).add(this.target);
    if (!animate) {
      this.camera.position.copy(to);
      this.camera.lookAt(this.target);
      this.requestRender();
      return;
    }
    // animate around the target on a sphere (not through it)
    const from = this.camera.position.clone().sub(this.target);
    const fromSph = new THREE.Spherical().setFromVector3(from);
    const toSph = new THREE.Spherical().setFromVector3(to.clone().sub(this.target));
    let dTheta = toSph.theta - fromSph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.anim = { t: 0, fromSph, dTheta, dPhi: toSph.phi - fromSph.phi, dR: toSph.radius - fromSph.radius };
    this.requestRender();
  }

  requestRender() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = 0;
    let more = false;
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + 1 / 36);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      const s = new THREE.Spherical(a.fromSph.radius + a.dR * e, a.fromSph.phi + a.dPhi * e, a.fromSph.theta + a.dTheta * e);
      this.camera.position.setFromSpherical(s).add(this.target);
      this.camera.lookAt(this.target);
      if (a.t >= 1) this.anim = null;
      more = true;
    }
    more = this.controls.update() || more;
    this.renderer.render(this.scene, this.camera);
    if (more) this.requestRender();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    if (this.model) (this.model.userData.dispose || (() => disposeObject(this.model)))();
    this.env.dispose();
    this.renderer.dispose();
  }
}

/** Inspector setup for the thumb wrist brace: the brace on a neutral right-hand mannequin. */
export const WRIST_VIEWER = {
  target: [0, -0.01, 0],
  radius: 0.62,
  minDistance: 0.3,
  maxDistance: 1.2,
  near: 0.01,
  // the mannequin is a right hand: thumb on -X
  viewAngles: { back: 0, palm: 180, thumb: -90, pinky: 90, threeQuarter: -35 },
  defaultView: 'threeQuarter',
  async createModel() {
    const { WristBrace, canonicalRig } = await import('./WristBrace.js');
    const brace = new WristBrace({ mode: 'inspect' });
    brace.update(canonicalRig());
    const root = new THREE.Group();
    root.add(brace.root, brace.occluder);
    root.scale.x = -1; // mirror the (left-hand) canonical rig into a right hand
    root.userData.dispose = () => brace.dispose();
    return { root };
  },
};

/** Inspector setup for the tennis elbow strap: a right forearm, elbow at the top, outer side = +X. */
export const ELBOW_VIEWER = {
  target: [0, -0.07, 0],
  radius: 0.78,
  minDistance: 0.35,
  maxDistance: 1.5,
  near: 0.01,
  viewAngles: { outer: 90, inner: -90, front: 180, back: 0, threeQuarter: 55 },
  defaultView: 'threeQuarter',
  async createModel() {
    const { ElbowStrap, canonicalArmRig } = await import('./ElbowStrap.js');
    const strap = new ElbowStrap({ mode: 'inspect' });
    strap.update(canonicalArmRig());
    const root = new THREE.Group();
    root.add(strap.root, strap.occluder);
    root.rotation.x = Math.PI; // forearm hanging down from the elbow
    root.position.y = 0.06;
    root.userData.dispose = () => strap.dispose();
    return { root };
  },
};

/** Inspector setup for the shoulder immobilizer: on a dress form, left arm in the pouch. */
export const IMMOBILIZER_VIEWER = {
  ...TORSO,
  target: [0, -0.22, 0],
  radius: 1.45,
  async createModel() {
    const { ImmobilizerModel, canonicalImmobilizerRig } = await import('./ImmobilizerModel.js');
    const model = new ImmobilizerModel({ mode: 'inspect' });
    model.update(canonicalImmobilizerRig());
    const root = new THREE.Group();
    root.add(model.root, model.occluder);
    root.userData.dispose = () => model.dispose();
    return { root };
  },
};

/** Inspector setup for the arm sling pouch: on a dress form, left arm in the pouch. */
export const SLING_VIEWER = {
  ...TORSO,
  target: [0, -0.2, 0],
  radius: 1.45,
  async createModel() {
    const { SlingModel, canonicalSlingRig } = await import('./SlingModel.js');
    const model = new SlingModel({ mode: 'inspect' });
    model.update(canonicalSlingRig());
    const root = new THREE.Group();
    root.add(model.root, model.occluder);
    root.userData.dispose = () => model.dispose();
    return { root };
  },
};

/** Inspector setup for the lumbar & sacral support: on the fitted dress form. */
export const LUMBAR_VIEWER = {
  ...TORSO,
  target: [0, -0.42, 0],
  radius: 1.25,
  async createModel() {
    const { LumbarModel } = await import('./LumbarModel.js');
    const model = new LumbarModel({ mode: 'inspect' });
    model.update({ factors: null, girth: 1 });
    const root = new THREE.Group();
    root.add(model.root, model.occluder);
    root.userData.dispose = () => model.dispose();
    return { root };
  },
};

/** Inspector setup for the clavicle brace: dress form with arms, the back view matters most. */
export const CLAVICLE_VIEWER = {
  ...TORSO,
  target: [0, -0.1, 0],
  radius: 1.15,
  viewAngles: { ...VIEW_ANGLES, threeQuarter: 145 }, // the figure-of-8 is on the back: the 3/4 view is from behind
  async createModel() {
    const { ClavicleModel } = await import('./ClavicleModel.js');
    const model = new ClavicleModel({ mode: 'inspect' });
    model.update({ factors: null, girth: 1 });
    const root = new THREE.Group();
    root.add(model.root, model.occluder);
    root.userData.dispose = () => model.dispose();
    return { root };
  },
};
