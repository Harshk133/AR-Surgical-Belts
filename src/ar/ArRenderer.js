// Three.js layer of the try-on. Renders into a transparent canvas that covers exactly the source
// video frame; the camera's intrinsics match the pinhole model used by TorsoTransform.
// The overlay is rendered UN-mirrored (true camera space); the stage mirrors video + canvas together.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createBrace, createMaskUniforms, disposeObject } from './BraceModel.js';
import { OcclusionLayer } from './OcclusionLayer.js';
import { createFitUniforms } from './BodyShapeFitter.js';
import { damp } from './filters.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class ArRenderer {
  constructor(canvas, { maxDpr = 2 } = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.maxDpr = maxDpr;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.05, 20);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.3;

    this.hemi = new THREE.HemisphereLight(0xf2f5f8, 0x3a3f45, 0.7);
    this.key = new THREE.DirectionalLight(0xffffff, 1.3);
    this.key.position.set(0.6, 1.2, 1.4);
    this.scene.add(this.hemi, this.key);

    this.maskUniforms = createMaskUniforms();
    this.fitUniforms = createFitUniforms();
    this.maskTexture = null;
    this.maskVersion = -1;

    this.anchor = new THREE.Group(); // tracked torso frame
    this.adjust = new THREE.Group(); // user alignment offsets in torso space
    this.anchor.add(this.adjust);
    this.scene.add(this.anchor);
    this.anchor.visible = false;
    this.occlusion = new OcclusionLayer(this.scene, this.maskUniforms);

    this.opacity = 0;
    this.brightness = 0.5;
    this.size = { w: 1, h: 1, frameW: 640, frameH: 480 };
    this.hfovDeg = 63;
  }

  async loadBrace(onProgress) {
    const { root, braceMeshes, occluders } = await createBrace({
      mode: 'ar',
      maskUniforms: this.maskUniforms,
      fitUniforms: this.fitUniforms,
      onProgress,
    });
    this.brace = root;
    this.braceMeshes = braceMeshes;
    this.bodyOccluders = occluders;
    this.adjust.add(root);
    // compile shaders up front so the first tracked frame doesn't hitch
    this.renderer.compile(this.scene, this.camera);
  }

  /** Match the canvas to its CSS box and the camera to the source frame geometry. */
  resize(cssW, cssH, frameW, frameH) {
    const s = this.size;
    if (s.w === cssW && s.h === cssH && s.frameW === frameW && s.frameH === frameH) return;
    Object.assign(s, { w: cssW, h: cssH, frameW, frameH });
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.setFov(this.hfovDeg);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.maskUniforms.uViewport.value.copy(buf);
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

  /** Mild exposure matching: brighter rooms -> brighter brace, so it doesn't glow in dim light. */
  setSceneBrightness(lum) {
    this.brightness = lum;
  }

  /**
   * @param st TorsoTransform state
   * @param adj { x, y, z (m), scale, yawDeg, rollDeg, pitchDeg }
   */
  update(st, adj, dt, { occlusion = true } = {}) {
    if (!this.brace) return;
    // Pose arrives at camera rate (~30 Hz) but we draw at display rate: ease toward the latest
    // tracked transform (~30 ms time constant) instead of stepping; snap while invisible.
    if (this.opacity < 0.02) {
      this.anchor.position.copy(st.position);
      this.anchor.quaternion.copy(st.quaternion);
      this.anchor.scale.copy(st.scale);
    } else {
      const k = damp(35, dt);
      this.anchor.position.lerp(st.position, k);
      this.anchor.quaternion.slerp(st.quaternion, k);
      this.anchor.scale.lerp(st.scale, k);
    }
    this.adjust.position.set(adj.x, adj.y, adj.z);
    this.adjust.rotation.set(
      THREE.MathUtils.degToRad(adj.pitchDeg),
      THREE.MathUtils.degToRad(adj.yawDeg),
      THREE.MathUtils.degToRad(adj.rollDeg),
      'YXZ',
    );
    this.adjust.scale.setScalar(adj.scale);

    const target = st.visible;
    this.opacity += (target - this.opacity) * damp(target > this.opacity ? 6 : 8, dt);
    if (Math.abs(this.opacity - target) < 0.01) this.opacity = target;
    this.anchor.visible = this.opacity > 0.01;
    this.canvas.style.opacity = this.opacity.toFixed(3);

    this.occlusion.enabled = occlusion;
    this.occlusion.update(st, st.scale.x * adj.scale);

    const b = this.brightness;
    const lightK = 0.8 + 0.35 * b; // gentle: the textures already carry the fabric's real albedo
    this.hemi.intensity += (0.7 * lightK - this.hemi.intensity) * damp(2, dt);
    this.key.intensity += (1.3 * lightK - this.key.intensity) * damp(2, dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.brace) disposeObject(this.brace);
    this.occlusion.dispose();
    this.maskTexture?.dispose();
    this.envTex.dispose();
    this.renderer.dispose();
  }
}
