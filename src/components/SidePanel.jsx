import { useEffect, useRef, useState } from 'react';
import { ArmFront, ArmInner, ArmOuter, HandBack, HandPalm, HandThumb, TorsoBack, TorsoFront, TorsoSide } from './icons.jsx';

const VIEW_ICONS = { front: TorsoFront, side: TorsoSide, back: TorsoBack };
const HAND_ICONS = { back: HandBack, palm: HandPalm, side: HandThumb };
const ARM_ICONS = { outer: ArmOuter, inner: ArmInner, front: ArmFront };
const ICONS = { torso: VIEW_ICONS, wrist: HAND_ICONS, elbow: ARM_ICONS, immobilizer: VIEW_ICONS, sling: VIEW_ICONS, lumbar: VIEW_ICONS, clavicle: VIEW_ICONS };

export function ProductInformation({ product }) {
  return (
    <section className="section" aria-labelledby="prod-title">
      <h2 className="product-title" id="prod-title">{product.name}</h2>
      <p className="product-sub">{product.brand} · {product.tagline}</p>
      <p className="product-desc">{product.description}</p>
      <ul className="features">{product.features.map((f) => <li key={f}>{f}</li>)}</ul>
      <div className="swatches" aria-label="Colours">
        {product.swatches.map((c) => <span key={c} className="swatch" style={{ background: c }} />)}
      </div>
      <p className="note">{product.disclaimer}</p>
    </section>
  );
}

export function ViewGuidance({ snap, product }) {
  const icons = ICONS[product.kind];
  const VIEWS = product.views.map((v) => ({ ...v, Icon: icons[v.id] }));
  const [target, setTarget] = useState(VIEWS[0].id);
  const live = snap.phase === 'tracking';
  const facing = snap.tracking.valid ? snap.tracking.facing : null;
  const current = VIEWS.find((v) => v.id === target) || VIEWS[0];
  const label = facing ? product.facingLabels[facing] || facing : '';
  return (
    <section className="section" aria-labelledby="views-h">
      <h3 id="views-h">Viewing guide <span className="muted">{live && facing ? `Detected: ${label.toLowerCase()} (est.)` : ''}</span></h3>
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
const FORMAT = {
  cm: (v) => (Math.abs(v) < 0.1 ? `${(v * 100).toFixed(1)} cm` : cm(v)),
  deg,
  '%': (v) => `${Math.round(v * 100)}%`,
};

export function AlignmentControls({ session, snap, product }) {
  const a = snap.adjust;
  // Sliders are in screen terms; in a mirrored view screen-right is the wearer's right (-X).
  const sx = snap.mirrored ? -1 : 1;
  const disabled = !['tracking', 'manual'].includes(snap.phase);
  return (
    <section className="section" aria-labelledby="align-h">
      <h3 id="align-h">Adjust alignment <span className="muted">{disabled ? 'available while tracking' : 'this session only'}</span></h3>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, opacity: disabled ? 0.55 : 1 }}>
        {product.sliders.map(({ key, label, min, max, step, unit, screen }) => {
          const k = screen ? sx : 1;
          return (
            <Slider key={key} label={label} min={min} max={max} step={step} value={a[key] * k} format={FORMAT[unit]} onChange={(v) => session.setAdjust({ [key]: v * k })} />
          );
        })}
      </fieldset>
      {snap.options.fitShape && snap.fit && snap.phase === 'tracking' && <FitStatus fit={snap.fit} labels={product.fitLabels} />}
      <div className="row end" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => session.resetAlignment({ recalibrate: false })}>Clear adjustments</button>
        <button className="btn small" onClick={() => session.resetAlignment()} disabled={snap.phase !== 'tracking'}>Re-align</button>
      </div>
    </section>
  );
}

export function Settings({ session, snap, product }) {
  const o = snap.options;
  const L = product.settingsLabels;
  return (
    <details className="section">
      <summary>Display &amp; tracking settings</summary>
      <label className="check">
        <input type="checkbox" checked={o.silhouette} onChange={(e) => session.setOption('silhouette', e.target.checked)} />
        Fit to body outline <small>(segmentation)</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={o.fitShape} onChange={(e) => session.setOption('fitShape', e.target.checked)} />
        {L.fitShape} <small>(outline fitting)</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={o.armOcclusion} onChange={(e) => session.setOption('armOcclusion', e.target.checked)} />
        {L.occlusion} <small>(estimated)</small>
      </label>
      {!['torso', 'lumbar', 'clavicle'].includes(product.kind) && (
        <div className="slider">
          <label htmlFor="hand-pref">{product.kind === 'wrist' ? 'Brace on' : product.kind === 'elbow' ? 'Strap on' : 'Arm in pouch'}</label>
          <select id="hand-pref" className="select" value={o.hand || 'auto'} onChange={(e) => session.setOption('hand', e.target.value)}>
            <option value="auto">{product.kind === 'wrist' ? 'Nearest hand' : product.kind === 'elbow' ? 'Clearest arm' : 'The bent arm'}</option>
            <option value="left">{product.kind === 'wrist' ? 'Left hand' : 'Left arm'}</option>
            <option value="right">{product.kind === 'wrist' ? 'Right hand' : 'Right arm'}</option>
          </select>
          <span />
        </div>
      )}
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

export function ProductInspector({ product }) {
  const INSPECT_VIEWS = product.inspectorViews;
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
        const { ProductViewer, WRIST_VIEWER, ELBOW_VIEWER, IMMOBILIZER_VIEWER, SLING_VIEWER, LUMBAR_VIEWER, CLAVICLE_VIEWER } = await import('../ar/ProductViewer.js');
        if (disposed) return;
        viewer.current = new ProductViewer(el, { wrist: WRIST_VIEWER, elbow: ELBOW_VIEWER, immobilizer: IMMOBILIZER_VIEWER, sling: SLING_VIEWER, lumbar: LUMBAR_VIEWER, clavicle: CLAVICLE_VIEWER }[product.kind]);
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
        <canvas ref={ref} aria-label={`3D model of the ${product.name}`} />
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

function FitStatus({ fit, labels }) {
  const item = (label, v, todo) => (
    <li className={v > 0.5 ? 'done' : ''}>
      <span className="tick" aria-hidden="true">{v > 0.5 ? '✓' : '○'}</span>
      {v > 0.5 ? label : todo}
    </li>
  );
  return (
    <ul className="fit-status" aria-label="Body fit">
      {item(labels.width[0], fit.width, labels.width[1])}
      {item(labels.depth[0], fit.depth, labels.depth[1])}
    </ul>
  );
}
