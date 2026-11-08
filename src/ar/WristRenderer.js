// Three.js layer of the wrist try-on. Same camera contract as ArRenderer (pinhole camera matching the
// source frame; un-mirrored camera space; the stage mirrors video + canvas together).
//
// The brace geometry lives in the local hand frame and is rebuilt on the wearer's joints whenever a
// new tracking result arrives; the anchor carries the hand frame (rotation + mirror for right hands).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createMaskUniforms } from './BraceModel.js';
import { WristBrace } from './WristBrace.js';
import { damp } from './filters.js';

export class WristRenderer {
  constructor(canvas, { maxDpr = 2 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.maxDpr = maxDpr;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.02, 10);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.35;
    this.hemi = new THREE.HemisphereLight(0xf2f5f8, 0x3a3f45, 0.8);
    this.key = new THREE.DirectionalLight(0xffffff, 1.4);
    this.key.position.set(0.4, 1.0, 1.2);
    this.scene.add(this.hemi, this.key);

    this.maskUniforms = createMaskUniforms();
    this.maskTexture = null;
    this.maskVersion = -1;

    // hand frame (rotation + optional X mirror); matrices are set directly
    this.anchor = new THREE.Group();
    this.anchor.matrixAutoUpdate = false;
    this.adjust = new THREE.Group(); // user offsets in the hand frame
    this.anchor.add(this.adjust);
    this.scene.add(this.anchor);
    this.other = new THREE.Group(); // the other hand (occluder only)
    this.other.matrixAutoUpdate = false;
    this.scene.add(this.other);

    this.opacity = 0;
    this.brightness = 0.5;
    this.size = { w: 1, h: 1, frameW: 640, frameH: 480 };
    this.hfovDeg = 63;
    this._pos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._mirror = 1;
    this._scale = new THREE.Vector3();
  }

  async loadBrace() {
    this.brace = new WristBrace({ mode: 'ar', maskUniforms: this.maskUniforms });
    this.adjust.add(this.brace.root);
    this.anchor.add(this.brace.occluder); // the real hand does not move with the alignment sliders
    this.otherHand = new WristBrace({ mode: 'ar', occluderOnly: true });
    this.other.add(this.otherHand.occluder);
    this.renderer.compile(this.scene, this.camera);
  }

  resize(cssW, cssH, frameW, frameH) {
    const s = this.size;
    if (s.w === cssW && s.h === cssH && s.frameW === frameW && s.frameH === frameH) return;
    Object.assign(s, { w: cssW, h: cssH, frameW, frameH });
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.setFov(this.hfovDeg);
    this.maskUniforms.uViewport.value.copy(this.renderer.getDrawingBufferSize(new THREE.Vector2()));
  }

  setFov(hfovDeg) {
    this.hfovDeg = hfovDeg;
    const aspect = this.size.frameW / this.size.frameH;
    const hf = THREE.MathUtils.degToRad(hfovDeg);
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect));
    this.camera.updateProjectionMatrix();
  }

  updateMask(mask, enabled) {
    const on = enabled && mask;
    this.maskUniforms.uMaskOn.value = on ? 1 : 0;
    if (!on) return;
    if (!this.maskTexture || this.maskTexture.image.width !== mask.width || this.maskTexture.image.height !== mask.height) {
      this.maskTexture?.dispose();
      this.maskTexture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
      this.maskTexture.magFilter = THREE.LinearFilter;
      this.maskTexture.minFilter = THREE.LinearFilter;
      this.maskTexture.flipY = false;
      this.maskUniforms.uMask.value = this.maskTexture;
      this.maskVersion = -1;
    }
    if (this.maskVersion !== mask.version) {
      this.maskTexture.image.data = mask.data;
      this.maskTexture.needsUpdate = true;
      this.maskVersion = mask.version;
    }
  }

  setSceneBrightness(lum) {
    this.brightness = lum;
  }

  /** Rebuild the brace on new joints (call when the rig changes, not every display frame). */
  updateGeometry(rig, otherRig) {
    if (!this.brace) return;
    this.brace.update(rig);
    if (otherRig) this.otherHand.update(otherRig);
  }

  /**
   * @param st HandTransform state (position / quaternion / mirror, possibly latency-compensated)
   * @param adj { x, y, z (m, hand frame), rollDeg (twist about the arm) }
   */
  update(st, adj, dt, { occlusion = true, span = 0.065 } = {}) {
    if (!this.brace) return;
    const snap = this.opacity < 0.02 || this._mirror !== st.mirror;
    if (snap) {
      this._pos.copy(st.position);
      this._q.copy(st.quaternion);
    } else {
      const k = damp(40, dt);
      this._pos.lerp(st.position, k);
      this._q.slerp(st.quaternion, k);
    }
    this._mirror = st.mirror;
    this.anchor.matrix.compose(this._pos, this._q, this._scale.set(st.mirror, 1, 1));
    this.anchor.matrixWorldNeedsUpdate = true;

    this.adjust.position.set(adj.x, adj.y, adj.z);
    this.adjust.rotation.set(0, THREE.MathUtils.degToRad(adj.rollDeg || 0), 0);

    const o = st.other;
    this.other.visible = !!(occlusion && o?.valid && st.valid);
    if (this.other.visible) {
      this.other.matrix.compose(o.position, o.quaternion, this._scale.set(o.mirror, 1, 1));
      this.other.matrixWorldNeedsUpdate = true;
    }
    this.brace.occluder.visible = occlusion;

    // silhouette clip tolerance: the neoprene stands ~4 mm proud of the skin, plus mask softness
    const f = (this.size.frameW / 2) / Math.tan(THREE.MathUtils.degToRad(this.hfovDeg) / 2);
    const z = Math.max(-this._pos.z, 0.05);
    this.maskUniforms.uDilate.value = Math.min(0.03, ((0.1 * span * f) / z) / this.size.frameW);

    const target = st.visible;
    this.opacity += (target - this.opacity) * damp(target > this.opacity ? 6 : 8, dt);
    if (Math.abs(this.opacity - target) < 0.01) this.opacity = target;
    this.anchor.visible = this.opacity > 0.01;
    this.canvas.style.opacity = this.opacity.toFixed(3);

    const lightK = 0.8 + 0.35 * this.brightness;
    this.hemi.intensity += (0.8 * lightK - this.hemi.intensity) * damp(2, dt);
    this.key.intensity += (1.4 * lightK - this.key.intensity) * damp(2, dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.brace?.dispose();
    this.otherHand?.dispose();
    this.maskTexture?.dispose();
    this.envTex.dispose();
    this.renderer.dispose();
  }
}
