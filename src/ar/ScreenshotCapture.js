// Composites the current camera frame + the rendered 3D overlay into a PNG.
// Must be called in the same task as ArRenderer.render() so the WebGL drawing buffer is intact
// (the renderer intentionally doesn't use preserveDrawingBuffer, which costs performance).

export function composeScreenshot({ source, overlay, overlayOpacity = 1, mirrored, frameW, frameH, caption }) {
  const maxW = 1920;
  const scale = Math.min(1, maxW / frameW);
  const w = Math.round(frameW * scale);
  const h = Math.round(frameH * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  if (mirrored) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalAlpha = overlayOpacity;
  ctx.drawImage(overlay, 0, 0, w, h);
  ctx.restore();

  if (caption) {
    const pad = Math.round(h * 0.018);
    const fs = Math.max(12, Math.round(h * 0.022));
    ctx.font = `500 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(caption).width;
    ctx.fillStyle = 'rgba(20, 26, 32, 0.62)';
    roundRect(ctx, pad, h - pad - fs * 1.9, tw + fs * 1.4, fs * 1.9, fs * 0.5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, pad + fs * 0.7, h - pad - fs * 0.95);
  }

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), 'image/png');
    } catch (err) {
      // a tainted canvas (cross-origin source without CORS) throws here
      reject(err);
    }
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
