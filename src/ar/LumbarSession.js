// Torso products built procedurally on the measured body (lumbar & sacral support, clavicle brace):
// the Taylor's brace session unchanged (TorsoTransform placement + front/back, BodyShapeFitter body shape,
// calibration, latency compensation, arm occlusion, silhouette trim) with the GLB replaced by a model
// rebuilt on the measured body shape each pose result. "Size" becomes girth (it hugs the body).
import { TryOnSession } from './TryOnSession.js';
import { LUMBAR_PRODUCT } from '../model/lumbarConfig.js';
import { CLAVICLE_PRODUCT } from '../model/clavicleConfig.js';

const DEFAULT_OPTIONS = { silhouette: true, fitShape: true, armOcclusion: true, showStats: false, hfov: 63, mirror: null };

export class ProceduralTorsoSession extends TryOnSession {
  constructor(product, storeKey) {
    super({ storeKey, product, defaultOptions: DEFAULT_OPTIONS });
  }

  /** async () => { Model, label } */
  async loadModel() {
    throw new Error('loadModel() not implemented');
  }

  async createRenderer(E, opts) {
    const [{ ArRenderer }, { Model, label }] = await Promise.all([import('./ArRenderer.js'), this.loadModel()]);
    class ProceduralRenderer extends ArRenderer {
      async loadBrace() {
        this.model = new Model({ mode: 'ar', maskUniforms: this.maskUniforms });
        this.adjust.add(this.model.root);
        this.anchor.add(this.model.occluder); // the body does not move with the alignment sliders
        this.brace = this.model.root;
        this.renderer.compile(this.scene, this.camera);
      }

      updateGeometry(rig) {
        this.model.update(rig);
      }

      update(st, adj, dt, o) {
        super.update(st, adj, dt, o);
        this.adjust.scale.setScalar(1);
      }

      dispose() {
        this.model?.dispose();
        this.brace = null;
        super.dispose();
      }
    }
    const r = new ProceduralRenderer(this.el.canvas, opts);
    this.set({ loading: { label, progress: null } });
    await r.loadBrace();
    r.updateGeometry({ factors: null, girth: 1 });
    return r;
  }

  onPoseResult(pose, st) {
    if (!st.valid) return;
    const fitOn = this.options.fitShape && this.fitter?.status.width > 0;
    this.renderer.updateGeometry({ factors: fitOn ? this.fitter.factors : null, girth: this.adjust.scale });
  }
}

export class LumbarTryOnSession extends ProceduralTorsoSession {
  constructor() {
    super(LUMBAR_PRODUCT, 'tryon.lumbar');
  }

  async loadModel() {
    const { LumbarModel } = await import('./LumbarModel.js');
    return { Model: LumbarModel, label: 'Preparing the belt' };
  }

  computeHint(pose, st, phase) {
    const base = super.computeHint(pose, st, phase);
    if (base) return base;
    // the belt covers the lower back and the top of the hips: without the hips the fit is a guess
    if (phase === 'tracking' && st.valid && !st.hipsVisible) return 'Step back so your hips are in view: the belt sits over your lower back and hips';
    return null;
  }
}

export class ClavicleTryOnSession extends ProceduralTorsoSession {
  constructor() {
    super(CLAVICLE_PRODUCT, 'tryon.clavicle');
    this.backSeenAt = null;
  }

  async loadModel() {
    const { ClavicleModel } = await import('./ClavicleModel.js');
    return { Model: ClavicleModel, label: 'Preparing the brace' };
  }

  computeHint(pose, st, phase) {
    let base = super.computeHint(pose, st, phase);
    if (phase !== 'tracking' || !st.valid) return base;
    // the brace is sized on the shoulders; the waist-depth tip doesn't apply to it
    if (base && base.startsWith('Turn sideways')) base = null;
    if (base) return base;
    if (st.facing === 'back') this.backSeenAt ??= performance.now();
    // the figure-of-8 crossing is on the back: suggest turning round once
    if (!this.backSeenAt && st.facing === 'front') return 'Turn around slowly to see the straps cross on your back';
    return null;
  }
}
