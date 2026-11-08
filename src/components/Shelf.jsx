import { forwardRef, useImperativeHandle, useRef } from 'react';
import { PRODUCTS, shortName, thumbOf } from '../model/products.js';

/** The row of circular boxes: the whole interface. */
export default function Shelf({ wornId, outId, onChoose }) {
  return (
    <nav className="shelf" aria-label="Products">
      <div className="shelf-track">
        {PRODUCTS.map((p, i) => (
          <button
            key={p.id}
            className="orb"
            data-id={p.id}
            data-out={p.id === outId}
            aria-pressed={p.id === wornId}
            aria-label={`${p.id === wornId ? 'Take off' : 'Try on'} ${p.name}`}
            style={{ '--i': i }}
            onClick={(e) => onChoose(p.id, e.currentTarget)}
          >
            <span className="orb-disc"><img src={thumbOf(p)} alt="" draggable="false" /></span>
            <span className="orb-name">{shortName(p)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** The opened box, plus the belt in flight. Always mounted: it is driven by choreography.js. */
export const BoxStage = forwardRef(function BoxStage({ product }, ref) {
  const root = useRef(null);
  const lid = useRef(null);
  const glow = useRef(null);
  const item = useRef(null);
  const flyer = useRef(null);
  const pulse = useRef(null);
  useImperativeHandle(ref, () => ({
    get root() { return root.current; },
    get lid() { return lid.current; },
    get glow() { return glow.current; },
    get item() { return item.current; },
    get flyer() { return flyer.current; },
    get pulse() { return pulse.current; },
  }));
  const src = product ? thumbOf(product) : undefined;
  return (
    <div className="box-layer" aria-hidden="true">
      <div className="box" ref={root}>
        <div className="box-glow" ref={glow} />
        <div className="box-3d">
          <div className="box-base" />
          <div className="box-float"><img className="box-item" ref={item} src={src} alt="" /></div>
          <div className="box-lid" ref={lid}>
            <div className="lid-face"><img src={src} alt="" /></div>
            <div className="lid-inner" />
          </div>
        </div>
        <svg className="box-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48.5" /></svg>
      </div>
      <img className="flyer" ref={flyer} src={src} alt="" />
      <div className="pulse" ref={pulse} />
    </div>
  );
});
