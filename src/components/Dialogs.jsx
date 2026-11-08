import { useEffect, useRef, useState } from 'react';
import { IconClose } from './icons.jsx';

function Sheet({ open, onClose, label, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      className="sheet"
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()} // a tap on the backdrop
    >
      <button className="sheet-close" onClick={onClose} aria-label="Close"><IconClose /></button>
      {children}
    </dialog>
  );
}

export function DetailsSheet({ open, product, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} label="Product details">
      {product && (
        <>
          <p className="sheet-kicker">{product.brand}</p>
          <h2>{product.name}</h2>
          <p className="sheet-tag">{product.tagline}</p>
          <p>{product.description}</p>
          <ul className="sheet-list">{product.features.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="sheet-fine">{product.disclaimer}</p>
        </>
      )}
    </Sheet>
  );
}

export function CaptureSheet({ shot, error, product, onClose }) {
  const [canShare, setCanShare] = useState(false);
  const file = shot && product ? new File([shot.blob], `${product.captureName}.png`, { type: 'image/png' }) : null;
  useEffect(() => {
    setCanShare(!!file && !!navigator.canShare?.({ files: [file] }));
  }, [shot]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={!!(shot || error)} onClose={onClose} label="Your picture">
      {error && <p>{error}</p>}
      {shot && <img className="shot" src={shot.url} alt={`You wearing the ${product?.name}`} />}
      {shot && (
        <div className="sheet-actions">
          {canShare && (
            <button className="pill-btn ghost" onClick={() => navigator.share({ files: [file] }).catch(() => {})}>Share</button>
          )}
          <a className="pill-btn" href={shot.url} download={`${product?.captureName}.png`}>Save</a>
        </div>
      )}
    </Sheet>
  );
}

const ERRORS = {
  denied: ['Camera is blocked', 'Allow the camera for this site in your browser settings, then try again.'],
  notfound: ['No camera found', 'Use a phone or laptop with a camera.'],
  busy: ['Camera is busy', 'Close other apps using the camera, then try again.'],
  insecure: ['A secure link is needed', 'Open this page over https.'],
  unsupported: ['Camera not supported', 'Open this page in a recent version of Chrome or Safari.'],
  webgl: ['3D is unavailable', 'Turn on hardware acceleration, or try another browser.'],
  ended: ['The camera stopped', 'Try again to restart it.'],
};

export function ErrorSheet({ error, onRetry, onClose }) {
  const [title, text] = ERRORS[error?.kind] || ['Something went wrong', 'Please try again.'];
  return (
    <Sheet open={!!error} onClose={onClose} label={title}>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="sheet-actions">
        <button className="pill-btn" onClick={onRetry}>Try again</button>
      </div>
    </Sheet>
  );
}
