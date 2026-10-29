// Stand-alone 3D inspector for the brace (no camera). Lets shoppers see the front, sides and the
// rear assembly from any angle, without implying the live camera has seen their back.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createBrace, disposeObject } from './BraceModel.js';

export const VIEW_ANGLES = { front: 0, left: 90, back: 180, right: -90, threeQuarter: 35 };

export class ProductViewer {
  constructor(canvas) {
    this.canvas = canvas;
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

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
    this.target = new THREE.Vector3(0, -0.25, 0);
    this.radius = 1.55;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.target);
    this.controls.enablePan = false;
    this.controls.minDistance = 0.9;
    this.controls.maxDistance = 3.2;
    this.controls.minPolarAngle = Math.PI * 0.2;
    this.controls.maxPolarAngle = Math.PI * 0.8;
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => (this.anim = null));
    this.setView('threeQuarter', false);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.raf = 0;
  }

  async load() {
    const { root } = await createBrace({ mode: 'inspect' });
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
    const az = THREE.MathUtils.degToRad(VIEW_ANGLES[name] ?? 0);
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
    if (this.model) disposeObject(this.model);
    this.env.dispose();
    this.renderer.dispose();
  }
}
