import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TryOnSession } from './ar/TryOnSession.js';
import { WristTryOnSession } from './ar/WristTryOnSession.js';
import { ElbowTryOnSession } from './ar/ElbowTryOnSession.js';
import { ImmobilizerTryOnSession } from './ar/ImmobilizerTryOnSession.js';
import { SlingTryOnSession } from './ar/SlingSession.js';
import { ClavicleTryOnSession, LumbarTryOnSession } from './ar/LumbarSession.js';
import TryOnViewport from './components/TryOnViewport.jsx';
import { AlignmentControls, ProductInformation, ProductInspector, Settings, ViewGuidance } from './components/SidePanel.jsx';
import { CaptureDialog, HelpDialog } from './components/Dialogs.jsx';
import { PRODUCTS, productById } from './model/products.js';

// QA hooks: ?source=/path/to/image-or-video.mp4 runs the full pipeline on a file instead of the camera;
// ?product=thumbWrist opens a product directly.
const params = new URLSearchParams(window.location.search);
const testSource = params.get('source') || undefined;
const SESSIONS = { torso: TryOnSession, wrist: WristTryOnSession, elbow: ElbowTryOnSession, immobilizer: ImmobilizerTryOnSession, sling: SlingTryOnSession, lumbar: LumbarTryOnSession, clavicle: ClavicleTryOnSession };

function initialProduct() {
  const fromUrl = params.get('product');
  if (fromUrl) return productById(fromUrl).id;
  try {
    return productById(sessionStorage.getItem('tryon.product')).id;
  } catch {
    return PRODUCTS[0].id;
  }
}

export default function App() {
  const [productId, setProductId] = useState(initialProduct);
  const product = productById(productId);
  // one session per product, created on first use and kept for the page's lifetime
  const sessions = useRef({});
  const session = (sessions.current[product.id] ||= new SESSIONS[product.kind]());
  if (import.meta.env.DEV) window.__tryon = session; // console debugging only
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shot, setShot] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [capturing, setCapturing] = useState(false);

  const choose = (id) => {
    if (id === productId) return;
    try {
      sessionStorage.setItem('tryon.product', id);
    } catch {
      /* private mode */
    }
    setProductId(id); // the viewport remounts: the old session releases the camera, the new one attaches
  };

  const capture = useCallback(async () => {
    setCapturing(true);
    try {
      const blob = await session.capture();
      setShot({ url: URL.createObjectURL(blob), blob });
    } catch (err) {
      setCaptureError(err?.message || 'The image could not be created');
    } finally {
      setCapturing(false);
    }
  }, [session]);

  const closeCapture = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    setCaptureError(null);
  };

  useEffect(() => () => shot && URL.revokeObjectURL(shot.url), [shot]);
  useEffect(() => {
    document.title = `${product.name} · Virtual Try-On`;
  }, [product]);

  return (
    <div className="app">
      <header className="header">
        <div className="logo" aria-label="Logo placeholder">LOGO</div>
        <h1>{product.name}</h1>
        <span className="brand">{product.brand}</span>
        <span className="spacer" />
        <div className="product-switch" role="group" aria-label="Choose a product">
          {PRODUCTS.map((p) => (
            <button key={p.id} aria-pressed={p.id === productId} onClick={() => choose(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <span className="badge">Virtual try-on · visual preview only</span>
      </header>
      <main className="main">
        <TryOnViewport
          key={product.id}
          session={session}
          snap={snap}
          product={product}
          testSource={testSource}
          onHelp={() => setHelpOpen(true)}
          onCapture={capture}
          capturing={capturing}
        />
        <aside className="panel" aria-label="Product and try-on settings" key={`panel-${product.id}`}>
          <ProductInformation product={product} />
          <ViewGuidance snap={snap} product={product} />
          <AlignmentControls session={session} snap={snap} product={product} />
          <ProductInspector product={product} />
          <Settings session={session} snap={snap} product={product} />
        </aside>
      </main>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} product={product} />
      <CaptureDialog shot={shot} error={captureError} onClose={closeCapture} product={product} />
    </div>
  );
}
