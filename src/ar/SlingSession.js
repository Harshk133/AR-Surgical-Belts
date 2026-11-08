// Arm sling pouch: the immobilizer's torso + snapped-arm pipeline with the sling model.
// Differences: no body band (the upper arm need not be against the side), the forearm must be about
// level, the forearm/upper arm are occluders (the open pouch shows the arm inside it), and the sling
// stays drawn for a moment after the arm leaves the position so it doesn't blink during movement.
import { ImmobilizerTryOnSession, DEFAULT_OPTIONS } from './ImmobilizerTryOnSession.js';
import { ARM_SLING as CFG, ARM_SLING_PRODUCT } from '../model/armSlingConfig.js';

export class SlingTryOnSession extends ImmobilizerTryOnSession {
  constructor() {
    super({ storeKey: 'tryon.sling', product: ARM_SLING_PRODUCT, defaultOptions: DEFAULT_OPTIONS });
    this.armCfg = CFG;
    this.needsWrap = false;
    this.outFor = 0;
  }

  async loadModelModule() {
    const [{ ImmobilizerRenderer }, { SlingModel, canonicalSlingRig }] = await Promise.all([
      import('./ImmobilizerRenderer.js'),
      import('./SlingModel.js'),
    ]);
    class SlingRenderer extends ImmobilizerRenderer {
      createModel() {
        return new SlingModel({ mode: 'ar' });
      }

      async loadBrace() {
        await super.loadBrace();
        this.occlusion.forearm = true;
      }
    }
    return { Renderer: SlingRenderer, canonicalRig: canonicalSlingRig, label: 'Preparing the sling' };
  }

  shownInPose(A, dt = 0.033) {
    this.outFor = A.inPose ? 0 : this.outFor + dt;
    return A.inPose || (this.lastShown && A.valid && this.outFor < CFG.hideAfter);
  }

  onPoseResult(pose, st, fw, fh, dt) {
    super.onPoseResult(pose, st, fw, fh, dt);
    this.lastShown = this.armState.inPose || (this.lastShown && this.outFor < CFG.hideAfter);
  }

  get depthHint() {
    return 'Turn sideways for a moment so the strap can follow your chest and back';
  }

  armHint() {
    const A = this.armState;
    const side = this.side || 'left';
    if (!A.valid) return `Keep your ${side} elbow and wrist in view so the pouch can hold the forearm`;
    if (!A.inPose) {
      if (A.flexDeg < 40) return `Bend your ${side} elbow to about 90°, forearm level across your body`;
      if (!A.level) return `Lower your ${side} hand so the forearm is about level`;
      if (!A.front) return `Bring your ${side} forearm in front of your body`;
      return `Hold your ${side} forearm level across your body, elbow by your side`;
    }
    return null;
  }
}
