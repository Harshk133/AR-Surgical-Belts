import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { TryOnSession } from './ar/TryOnSession.js';
import { WristTryOnSession } from './ar/WristTryOnSession.js';
import { ElbowTryOnSession } from './ar/ElbowTryOnSession.js';
import { ImmobilizerTryOnSession } from './ar/ImmobilizerTryOnSession.js';
import { SlingTryOnSession } from './ar/SlingSession.js';
import { ClavicleTryOnSession, LumbarTryOnSession } from './ar/LumbarSession.js';
import { CameraController } from './ar/CameraController.js';
import Shelf, { BoxStage } from './components/Shelf.jsx';
import { CaptureSheet, DetailsSheet, ErrorSheet } from './components/Dialogs.jsx';
import { IconCapture, IconChevron, IconFlip } from './components/icons.jsx';
import { closeBox, flash, flyHome, flyToBody, openBox, resetBox } from './components/choreography.js';
import { PRODUCTS, productById, thumbOf } from './model/products.js';

// QA hooks: ?source=/path/to/image-or-video.mp4 runs the full pipeline on a file instead of the camera;
// ?product=thumbWrist puts a product on straight away (also usable as a deep link from a product page).
const params = new URLSearchParams(window.location.search);
const testSource = params.get('source') || undefined;
const deepLink = PRODUCTS.find((p) => p.id === params.get('product'))?.id;
const SESSIONS = { torso: TryOnSession, wrist: WristTryOnSession, elbow: ElbowTryOnSession, immobilizer: ImmobilizerTryOnSession, sling: SlingTryOnSession, lumbar: LumbarTryOnSession, clavicle: ClavicleTryOnSession };

const IDLE = { phase: 'idle', error: null, hint: null, cameras: [], deviceId: null, tracking: { valid: false }, sourceSize: null };
const noSubscribe = () => () => {};
const getIdle = () => IDLE;
const AUTO_ALIGN_MS = 3500; // don't make people hold perfectly still: once tracked for this long, go

function waitUntilReady(session, signal) {
  return new Promise((resolve) => {
    const check = () => {
      const { phase } = session.getSnapshot();
      if (signal.aborted || phase === 'tracking' || phase === 'manual' || phase === 'error') {
        unsubscribe();
        signal.removeEventListener('abort', check);
        resolve(phase);
      }
    };
    const unsubscribe = session.subscribe(check);
    signal.addEventListener('abort', check);
    check();
  });
}

export default function App() {
  const sessions = useRef({});
  const getSession = useCallback((id) => (sessions.current[id] ||= new SESSIONS[productById(id).kind]()), []);
  const [activeId, setActiveId] = useState(null);
  const [worn, setWorn] = useState(false);
  const [boxProduct, setBoxProduct] = useState(null); // what the box holds
  const [outId, setOutId] = useState(null); // the circle whose box is currently lifted off the shelf
  const [cameraOn, setCameraOn] = useState(false);
  const [details, setDetails] = useState(false);
  const [shot, setShot] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [capturing, setCapturing] = useState(false);

  const product = activeId ? productById(activeId) : null;
  const session = activeId ? getSession(activeId) : null;
  if (import.meta.env.DEV) window.__tryon = session; // console debugging only
  const snap = useSyncExternalStore(session ? session.subscribe : noSubscribe, session ? session.getSnapshot : getIdle);

  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const flashRef = useRef(null);
  const cameraRef = useRef(null);
  const flow = useRef(null);
  const live = useRef({ activeId: null, worn: false });
  live.current = { activeId, worn };

  // One camera for the whole app; the session (and its 3D canvas) changes with the product.
  useEffect(() => {
    if (!session) return undefined;
    cameraRef.current ||= new CameraController(videoRef.current);
    session.attach({ container: rootRef.current, stage: stageRef.current, video: videoRef.current, image: imageRef.current, canvas: canvasRef.current, camera: cameraRef.current });
    const t = setTimeout(() => session.start({ testSource }), 0);
    return () => {
      clearTimeout(t);
      session.detach({ keepCamera: true });
    };
  }, [session]);

  const { phase, tracking, sourceSize } = snap;
  useEffect(() => {
    if (phase === 'error') setCameraOn(false);
    else if (phase !== 'idle' && sourceSize) setCameraOn(true);
  }, [phase, sourceSize]);

  useEffect(() => {
    if (phase !== 'calibrating' || !tracking.valid) return undefined;
    const t = setTimeout(() => session.skipCalibration(), AUTO_ALIGN_MS);
    return () => clearTimeout(t);
  }, [phase, tracking.valid, session]);

  useEffect(() => {
    document.title = worn && product ? `${product.name} · Try-On` : 'Virtual Try-On';
  }, [worn, product]);

  const takeOff = useCallback(
    async (id, button, signal) => {
      const s = getSession(id);
      const els = boxRef.current;
      if (live.current.worn) {
        setWorn(false);
        const landing = s.landing();
        await Promise.all([s.wearOff(420), flyHome(els, landing, button, thumbOf(productById(id)))]);
      } else {
        await closeBox(els, button);
      }
      if (signal.aborted) return;
      s.resetAlignment({ recalibrate: false });
      flushSync(() => {
        setActiveId(null);
        setOutId(null);
        setBoxProduct(null);
      });
    },
    [getSession],
  );

  const choose = useCallback(
    async (id, button) => {
      flow.current?.abort();
      const { signal } = (flow.current = new AbortController());
      navigator.vibrate?.(8);
      const { activeId: prev, worn: prevWorn } = live.current;
      if (prev === id) return takeOff(id, button, signal);

      const els = boxRef.current;
      if (prev && prevWorn) {
        setWorn(false);
        await getSession(prev).wearOff(220);
        if (signal.aborted) return undefined;
      }

      const next = getSession(id);
      next.veil();
      next.resetAlignment({ recalibrate: false });
      const origin = button.getBoundingClientRect();
      flushSync(() => {
        setWorn(false);
        setBoxProduct(productById(id));
        setOutId(id);
        setActiveId(id);
      });
      button.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

      await openBox(els, origin);
      if (signal.aborted) return undefined;
      const outcome = await waitUntilReady(next, signal);
      if (signal.aborted) return undefined;
      if (outcome === 'error') {
        await closeBox(els, button);
        if (!signal.aborted) setOutId(null);
        return undefined;
      }
      await flyToBody(els, next.landing(), () => next.wearOn(640));
      if (signal.aborted) return undefined;
      setWorn(true);
      await closeBox(els, button);
      if (!signal.aborted) setOutId(null);
      return undefined;
    },
    [getSession, takeOff],
  );

  const retry = () => {
    const id = activeId;
    const button = document.querySelector(`.orb[data-id="${id}"]`);
    flow.current?.abort();
    resetBox(boxRef.current);
    flushSync(() => {
      setActiveId(null);
      setOutId(null);
    });
    live.current = { activeId: null, worn: false };
    choose(id, button);
  };

  const dismissError = () => {
    flow.current?.abort();
    resetBox(boxRef.current);
    setActiveId(null);
    setOutId(null);
  };

  const started = useRef(false);
  useEffect(() => {
    if (!deepLink || started.current) return;
    started.current = true;
    choose(deepLink, document.querySelector(`.orb[data-id="${deepLink}"]`));
  }, [choose]);

  const capture = async () => {
    setCapturing(true);
    flash(flashRef.current);
    navigator.vibrate?.(12);
    try {
      const blob = await session.capture();
      setShot({ url: URL.createObjectURL(blob), blob });
    } catch (err) {
      setCaptureError(err?.message || 'The picture could not be created.');
    } finally {
      setCapturing(false);
    }
  };
  const closeCapture = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setCaptureError(null);
  };

  const flip = () => {
    const list = snap.cameras;
    const i = list.findIndex((c) => c.deviceId === snap.deviceId);
    session.switchCamera(list[(i + 1) % list.length].deviceId);
  };

  useDirectManipulation(rootRef, worn ? session : null, product);
  const hint = useCalmHint(worn || outId ? snap.hint : null);

  return (
    <div className="app" data-camera={cameraOn} data-worn={worn}>
      <section className="view" ref={rootRef} aria-label="Live try-on">
        <div className="stage" ref={stageRef}>
          <video ref={videoRef} playsInline muted />
          <img ref={imageRef} alt="" hidden />
          <canvas key={activeId || 'none'} ref={canvasRef} aria-hidden="true" />
        </div>
      </section>
      <div className="scrim" aria-hidden="true" />

      <div className="hero">
        <h1>See it on you.</h1>
        <p>Your camera stays on this device.</p>
      </div>

      {worn && product && (
        <header className="top">
          <button className="name" onClick={() => setDetails(true)}>
            <strong>{product.name} <IconChevron /></strong>
            <span>Visual preview only</span>
          </button>
          <div className="top-actions">
            {snap.cameras.length > 1 && !testSource && (
              <button className="round" onClick={flip} aria-label="Switch camera"><IconFlip /></button>
            )}
            <button className="round" onClick={capture} disabled={capturing} aria-label="Take a picture"><IconCapture /></button>
          </div>
        </header>
      )}

      <p className="whisper" role="status" aria-live="polite" data-show={!!hint}>{hint}</p>

      <Shelf wornId={worn ? activeId : null} outId={outId} onChoose={choose} />
      <BoxStage ref={boxRef} product={boxProduct} />
      <div className="flash" ref={flashRef} aria-hidden="true" />

      <DetailsSheet open={details} product={product} onClose={() => setDetails(false)} />
      <CaptureSheet shot={shot} error={captureError} product={product} onClose={closeCapture} />
      <ErrorSheet error={phase === 'error' ? snap.error : null} onRetry={retry} onClose={dismissError} />
    </div>
  );
}

/** A hint only appears if it is still true a moment later, so the screen stays quiet. */
function useCalmHint(hint) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!hint) {
      const t = setTimeout(() => setShown(null), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown(hint), 1100);
    return () => clearTimeout(t);
  }, [hint]);
  return shown;
}

/** Instead of alignment sliders: drag the product to move it, pinch to resize it. */
function useDirectManipulation(ref, session, product) {
  useEffect(() => {
    const el = ref.current;
    if (!session || !product) return undefined;
    const limit = (key, v) => {
      const s = product.sliders.find((x) => x.key === key);
      return s ? Math.min(s.max, Math.max(s.min, v)) : v;
    };
    // the wrist and elbow frames follow the limb, so a screen drag has no fixed meaning there
    const canDrag = !['wrist', 'elbow'].includes(product.kind);
    const pts = new Map();
    let pinch = null;

    const spread = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e) => {
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = pts.size === 2 ? { d: spread(), scale: session.getSnapshot().adjust.scale } : null;
    };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      const snap = session.getSnapshot();
      if (pinch && pts.size === 2) {
        session.setAdjust({ scale: limit('scale', (pinch.scale * spread()) / pinch.d) });
      } else if (pts.size === 1 && canDrag) {
        const m = session.metersPerPixel();
        const sx = (snap.mirrored ? -1 : 1) * (snap.tracking.facing === 'back' ? -1 : 1);
        session.setAdjust({ x: limit('x', snap.adjust.x + dx * m * sx), y: limit('y', snap.adjust.y - dy * m) });
      }
    };
    const up = (e) => {
      pts.delete(e.pointerId);
      pinch = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [ref, session, product]);
}
