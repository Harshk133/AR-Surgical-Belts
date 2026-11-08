// Camera lifecycle only: permissions, device selection, start/stop, error classification.
// Knows nothing about tracking or rendering.

export class CameraError extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind; // 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'unknown'
    this.cause = cause;
  }
}

function classify(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return new CameraError('denied', 'Camera permission was denied.', err);
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return new CameraError('notfound', 'No usable camera was found.', err);
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return new CameraError('busy', 'The camera is in use by another application or could not start.', err);
  return new CameraError('unknown', err?.message || 'The camera could not be started.', err);
}

export class CameraController {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.deviceId = null;
    this.facing = 'user';
    this.onEnded = null;
  }

  static checkSupport() {
    if (!window.isSecureContext) {
      return new CameraError('insecure', 'Camera access needs a secure (https or localhost) connection.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return new CameraError('unsupported', 'This browser does not support camera access.');
    }
    return null;
  }

  async listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
    } catch {
      return [];
    }
  }

  /** Starts the camera, or hands back the running stream: products share it while the user switches. */
  start(opts = {}) {
    if (this.active && (!opts.deviceId || opts.deviceId === this.deviceId)) {
      this.video.play().catch(() => {});
      return Promise.resolve(this.info());
    }
    // one permission prompt, however many products are tapped while it is open
    if (this.pending && !opts.deviceId) return this.pending;
    const p = this.open(opts).finally(() => {
      if (this.pending === p) this.pending = null;
    });
    this.pending = p;
    return p;
  }

  info() {
    return { deviceId: this.deviceId, facing: this.facing, width: this.video.videoWidth, height: this.video.videoHeight };
  }

  async open({ deviceId, facingMode = 'user' } = {}) {
    const unsupported = CameraController.checkSupport();
    if (unsupported) throw unsupported;
    this.stop();
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }),
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      if (err?.name === 'OverconstrainedError' && deviceId) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch((e) => {
          throw classify(e);
        });
      } else {
        throw classify(err);
      }
    }
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings?.() || {};
    this.deviceId = settings.deviceId || deviceId || null;
    // Laptop webcams usually report no facingMode: treat them as user-facing (mirrored).
    this.facing = settings.facingMode || (deviceId ? 'user' : facingMode);
    track.addEventListener('ended', () => this.onEnded?.());

    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
    if (this.video.readyState < 2) {
      await new Promise((resolve) => this.video.addEventListener('loadeddata', resolve, { once: true }));
    }
    return this.info();
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  get active() {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }
}
