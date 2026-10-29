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

export function CaptureDialog({ shot, error, onClose }) {
  const open = !!(shot || error);
  const name = `taylors-brace-preview-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
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

export function HelpDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} title="Positioning guide">
      <h4>Getting a good alignment</h4>
      <ul>
        <li>Stand 1.5–2 m from the camera so your head, shoulders and waist are visible.</li>
        <li>Face the camera with arms relaxed slightly away from your sides while it aligns.</li>
        <li>Use even, front-facing light; avoid a bright window behind you.</li>
        <li>Fitted, plain clothing tracks better than loose or patterned clothes.</li>
        <li>If the brace sits a little off, use <em>Adjust alignment</em> in the side panel, or press <em>Reset</em> to re-align.</li>
      </ul>
      <h4>Seeing the sides and back</h4>
      <ul>
        <li>Turn slowly. The brace follows your torso's estimated rotation.</li>
        <li>When your face is hidden, the app infers that you are facing away. This is an estimate and can lag or flicker; turning slowly helps.</li>
        <li>For an exact look at the rear panel and straps, use the 3D viewer in the side panel.</li>
      </ul>
      <h4>What this preview can and can't do</h4>
      <ul>
        <li>Position, size and depth are estimated from a single camera image; there is no true depth sensor.</li>
        <li>Arms and the body hide parts of the brace using approximations, so small clipping or floating edges can occur.</li>
        <li>It does not measure you, choose a size, or check clinical fit. A clinician or orthotist should fit the brace.</li>
        <li>Video is processed in your browser and is never uploaded.</li>
      </ul>
    </Dialog>
  );
}
