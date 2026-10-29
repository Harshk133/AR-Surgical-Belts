import { useEffect, useRef, useState } from 'react';
import { PRODUCT } from '../model/braceConfig.js';
import { TorsoBack, TorsoFront, TorsoSide } from './icons.jsx';

export function ProductInformation() {
  return (
    <section className="section" aria-labelledby="prod-title">
      <h2 className="product-title" id="prod-title">{PRODUCT.name}</h2>
      <p className="product-sub">{PRODUCT.brand} · {PRODUCT.tagline}</p>
      <p className="product-desc">{PRODUCT.description}</p>
      <ul className="features">{PRODUCT.features.map((f) => <li key={f}>{f}</li>)}</ul>
      <div className="swatches" aria-label="Colours">
        {['#6e7b86', '#47525e', '#2b3549', '#3a8580'].map((c) => <span key={c} className="swatch" style={{ background: c }} />)}
      </div>
      <p className="note">{PRODUCT.disclaimer}</p>
    </section>
  );
}

const VIEWS = [
  { id: 'front', label: 'Front', Icon: TorsoFront, text: 'Face the camera to see the shoulder straps and the front belt closure.' },
  { id: 'side', label: 'Side', Icon: TorsoSide, text: 'Turn slowly to your left or right to see the strap routing under the arm and the brace thickness.' },
  { id: 'back', label: 'Back', Icon: TorsoBack, text: 'Turn around to preview the rear panel and diagonal straps. Back-view tracking is estimated and less stable: turn slowly, and use the 3D viewer below for a precise look.' },
];

export function ViewGuidance({ snap }) {
  const [target, setTarget] = useState('front');
  const live = snap.phase === 'tracking';
  const facing = snap.tracking.valid ? snap.tracking.facing : null;
  const current = VIEWS.find((v) => v.id === target);
  return (
    <section className="section" aria-labelledby="views-h">
      <h3 id="views-h">Viewing guide <span className="muted">{live && facing ? `Detected: ${facing} (est.)` : ''}</span></h3>
      <div className="views">
        {VIEWS.map(({ id, label, Icon }) => (
          <button key={id} className="view-btn" aria-pressed={target === id} onClick={() => setTarget(id)}>
            <Icon />
            {label}
            <span className="met">{live && facing === id ? '✓ in view' : ''}</span>
          </button>
        ))}
      </div>
      <p className="guide-text">{current.text}</p>
    </section>
  );
}

function Slider({ label, min, max, step, value, onChange, format }) {
  const id = `s-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

const cm = (v) => `${Math.round(v * 100)} cm`;
const deg = (v) => `${Math.round(v)}°`;

export function AlignmentControls({ session, snap }) {
  const a = snap.adjust;
  // Sliders are in screen terms; in a mirrored view screen-right is the wearer's right (-X).
  const sx = snap.mirrored ? -1 : 1;
  const disabled = !['tracking', 'manual'].includes(snap.phase);
  return (
    <section className="section" aria-labelledby="align-h">
      <h3 id="align-h">Adjust alignment <span className="muted">{disabled ? 'available while tracking' : 'this session only'}</span></h3>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, opacity: disabled ? 0.55 : 1 }}>
        <Slider label="Up / down" min={-0.15} max={0.15} step={0.005} value={a.y} format={cm} onChange={(y) => session.setAdjust({ y })} />
        <Slider label="Left / right" min={-0.12} max={0.12} step={0.005} value={a.x * sx} format={cm} onChange={(v) => session.setAdjust({ x: v * sx })} />
        <Slider label="Size" min={0.8} max={1.25} step={0.01} value={a.scale} format={(v) => `${Math.round(v * 100)}%`} onChange={(scale) => session.setAdjust({ scale })} />
        <Slider label="Tilt" min={-20} max={20} step={1} value={a.rollDeg * sx} format={deg} onChange={(v) => session.setAdjust({ rollDeg: v * sx })} />
        <Slider label="Turn" min={-30} max={30} step={1} value={a.yawDeg * sx} format={deg} onChange={(v) => session.setAdjust({ yawDeg: v * sx })} />
        <Slider label="Depth" min={-0.06} max={0.06} step={0.005} value={a.z} format={cm} onChange={(z) => session.setAdjust({ z })} />
      </fieldset>
      {snap.options.fitShape && snap.fit && snap.phase === 'tracking' && <FitStatus fit={snap.fit} />}
      <div className="row end" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => session.resetAlignment({ recalibrate: false })}>Clear adjustments</button>
        <button className="btn small" onClick={() => session.resetAlignment()} disabled={snap.phase !== 'tracking'}>Re-align</button>
      </div>
    </section>
  );
}

export function Settings({ session, snap }) {
  const o = snap.options;
  return (
    <details className="section">
      <summary>Display &amp; tracking settings</summary>
      <label className="check">
        <input type="checkbox" checked={o.silhouette} onChange={(e) => session.setOption('silhouette', e.target.checked)} />
        Fit to body outline <small>(segmentation)</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={o.fitShape} onChange={(e) => session.setOption('fitShape', e.target.checked)} />
        Shape the brace to my body <small>(outline fitting)</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={o.armOcclusion} onChange={(e) => session.setOption('armOcclusion', e.target.checked)} />
        Arms pass in front of the brace <small>(estimated)</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={snap.mirrored} onChange={(e) => session.setOption('mirror', e.target.checked)} />
        Mirror view
      </label>
      <label className="check">
        <input type="checkbox" checked={o.showStats} onChange={(e) => session.setOption('showStats', e.target.checked)} />
        Show performance stats
      </label>
      <Slider label="Camera FOV" min={45} max={90} step={1} value={o.hfov} format={deg} onChange={(v) => session.setOption('hfov', v)} />
      <p className="note" style={{ marginTop: 6 }}>Adjust the field of view if the brace looks too large or small at the edges of the frame. Most webcams are 60–75°.</p>
    </details>
  );
}

const INSPECT_VIEWS = [
  ['front', 'Front'],
  ['left', 'Left'],
  ['back', 'Back'],
  ['right', 'Right'],
  ['threeQuarter', '¾'],
];

export function ProductInspector() {
  const ref = useRef(null);
  const viewer = useRef(null);
  const [state, setState] = useState('idle');
  const [view, setView] = useState('threeQuarter');

  useEffect(() => {
    const el = ref.current;
    let disposed = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || viewer.current) return;
      io.disconnect();
      setState('loading');
      try {
        const { ProductViewer } = await import('../ar/ProductViewer.js');
        if (disposed) return;
        viewer.current = new ProductViewer(el);
        await viewer.current.load();
        if (!disposed) setState('ready');
      } catch (err) {
        console.error(err);
        if (!disposed) setState('error');
      }
    });
    io.observe(el);
    return () => {
      disposed = true;
      io.disconnect();
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  const go = (v) => {
    setView(v);
    viewer.current?.setView(v);
  };

  return (
    <section className="section" aria-labelledby="insp-h">
      <h3 id="insp-h">Inspect the brace in 3D <span className="muted">drag to rotate</span></h3>
      <div className="inspector">
        <canvas ref={ref} aria-label="3D model of the Taylor's Brace" />
        {state !== 'ready' && <div className="loading">{state === 'error' ? '3D viewer unavailable' : 'Loading 3D model…'}</div>}
      </div>
      <div className="seg" role="group" aria-label="Model view">
        {INSPECT_VIEWS.map(([id, label]) => (
          <button key={id} aria-pressed={view === id} onClick={() => go(id)}>{label}</button>
        ))}
      </div>
    </section>
  );
}

function FitStatus({ fit }) {
  const item = (label, v, todo) => (
    <li className={v > 0.5 ? 'done' : ''}>
      <span className="tick" aria-hidden="true">{v > 0.5 ? '✓' : '○'}</span>
      {v > 0.5 ? label : todo}
    </li>
  );
  return (
    <ul className="fit-status" aria-label="Body fit">
      {item('Width shaped to your outline', fit.width, 'Face the camera to fit the width')}
      {item('Waist and tummy depth fitted', fit.depth, 'Turn sideways once to fit the depth')}
    </ul>
  );
}
