import { useEffect, useRef } from 'react';
import { IconClose, IconDownload } from './icons.jsx';

function Dialog({ open, onClose, title, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby={`${title}-h`}>
      <div className="dlg-head">
        <h2 id={`${title}-h`}>{title}</h2>
        <button className="btn ghost small" onClick={onClose} aria-label="Close"><IconClose /></button>
      </div>
      <div className="dlg-body">{children}</div>
      {footer && <div className="dlg-foot">{footer}</div>}
    </dialog>
  );
}

export function CaptureDialog({ shot, error, onClose, product }) {
  const open = !!(shot || error);
  const name = `${product.captureName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={error ? 'Capture failed' : 'Your preview'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {shot && (
            <a className="btn primary" href={shot.url} download={name}>
              <IconDownload /> Download PNG
            </a>
          )}
        </>
      }
    >
      {error ? (
        <p>{error}. Make sure the try-on is running and the brace is visible, then try again.</p>
      ) : (
        shot && <img className="shot" src={shot.url} alt="Captured try-on preview" />
      )}
    </Dialog>
  );
}

export function HelpDialog({ open, onClose, product }) {
  return (
    <Dialog open={open} onClose={onClose} title="Positioning guide">
      {product.help.map((sec) => (
        <div key={sec.title}>
          <h4>{sec.title}</h4>
          <ul>{sec.items.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ))}
    </Dialog>
  );
}
