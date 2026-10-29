import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { TryOnSession } from './ar/TryOnSession.js';
import TryOnViewport from './components/TryOnViewport.jsx';
import { AlignmentControls, ProductInformation, ProductInspector, Settings, ViewGuidance } from './components/SidePanel.jsx';
import { CaptureDialog, HelpDialog } from './components/Dialogs.jsx';
import { PRODUCT } from './model/braceConfig.js';

// QA hook: ?source=/path/to/image-or-video.mp4 runs the full pipeline on a file instead of the camera.
const testSource = new URLSearchParams(window.location.search).get('source') || undefined;

export default function App() {
  const [session] = useState(() => new TryOnSession());
  if (import.meta.env.DEV) window.__tryon = session; // console debugging only
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shot, setShot] = useState(null);
  const [captureError, setCaptureError] = useState(null);
  const [capturing, setCapturing] = useState(false);

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

  return (
    <div className="app">
      <header className="header">
        <div className="logo" aria-label="Logo placeholder">LOGO</div>
        <h1>{PRODUCT.name}</h1>
        <span className="brand">{PRODUCT.brand}</span>
        <span className="spacer" />
        <span className="badge">Virtual try-on · visual preview only</span>
      </header>
      <main className="main">
        <TryOnViewport
          session={session}
          snap={snap}
          testSource={testSource}
          onHelp={() => setHelpOpen(true)}
          onCapture={capture}
          capturing={capturing}
        />
        <aside className="panel" aria-label="Product and try-on settings">
          <ProductInformation />
          <ViewGuidance snap={snap} />
          <AlignmentControls session={session} snap={snap} />
          <ProductInspector />
          <Settings session={session} snap={snap} />
        </aside>
      </main>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CaptureDialog shot={shot} error={captureError} onClose={closeCapture} />
    </div>
  );
}
