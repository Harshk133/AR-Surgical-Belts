// The box-to-body animation. Everything here is transform/opacity through the Web Animations API, so
// it stays on the compositor while the main thread is busy loading the tracker and 3D model.
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMOOTH = 'cubic-bezier(.4,0,.2,1)';
const SPRING = 'cubic-bezier(.2,.9,.25,1.06)';
const HINGE = 'cubic-bezier(.3,1.3,.45,1)';
const LID_OPEN = 'rotateX(128deg)';
const ITEM_IN = 'translateZ(40px) translateY(14%) scale(.74)';
const ITEM_OUT = 'translateZ(40px) translateY(-3%) scale(1)';
const THUMB_FILL = 0.82; // the product fills about this much of its square render

function play(el, frames, opts) {
  return el.animate(frames, { fill: 'both', easing: SMOOTH, ...opts, duration: reduced() ? 1 : opts.duration, delay: reduced() ? 0 : opts.delay || 0 });
}
const finished = (...anims) => Promise.all(anims.map((a) => a.finished.catch(() => {})));
const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const wait = (ms) => new Promise((ok) => setTimeout(ok, reduced() ? 0 : ms));

export function resetBox(els) {
  [els.root, els.lid, els.glow, els.item, els.flyer, els.pulse].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  els.root.style.visibility = 'hidden';
  els.flyer.style.visibility = 'hidden';
  els.root.dataset.waiting = 'false';
}

/** From where the product sits on the shelf to the middle of the screen, lid opening on the way. */
export async function openBox(els, origin) {
  resetBox(els);
  els.root.style.visibility = 'visible';
  const home = els.root.getBoundingClientRect();
  const a = centre(origin);
  const b = centre(home);
  const from = `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${origin.width / home.width})`;
  await finished(
    play(els.root, [{ transform: from }, { transform: 'translate(0,0) scale(1)' }], { duration: 480, easing: SPRING }),
    play(els.glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 560, delay: 220 }),
    play(els.lid, [{ transform: 'rotateX(0deg)' }, { transform: LID_OPEN }], { duration: 640, delay: 220, easing: HINGE }),
    play(els.item, [{ opacity: 0, transform: ITEM_IN }, { opacity: 1, transform: ITEM_OUT }], { duration: 540, delay: 380, easing: SPRING }),
  );
  els.root.dataset.waiting = 'true';
}

/** The product leaves the box and lands exactly where the tracked 3D model is. */
export async function flyToBody(els, landing, wearOn) {
  els.root.dataset.waiting = 'false';
  const item = els.item.getBoundingClientRect();
  const to = landing || { x: window.innerWidth / 2, y: window.innerHeight * 0.42, w: window.innerWidth * 0.6, h: window.innerWidth * 0.6 };
  const size = Math.max(to.w, to.h);
  Object.assign(els.flyer.style, { left: `${item.left}px`, top: `${item.top}px`, width: `${item.width}px`, height: `${item.height}px`, visibility: 'visible' });
  const dx = to.x - (item.left + item.width / 2);
  const dy = to.y - (item.top + item.height / 2);
  const scale = Math.min(size / THUMB_FILL / item.width, 6);

  play(els.item, [{ opacity: 1 }, { opacity: 0 }], { duration: 1 });
  const flight = play(
    els.flyer,
    [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.42}px, ${dy * 0.6}px) scale(${1 + (scale - 1) * 0.62}) rotate(-5deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale * 1.05}) rotate(0deg)`, opacity: 0.9, offset: 0.82 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(0deg)`, opacity: 0, offset: 1 },
    ],
    { duration: 780, easing: 'cubic-bezier(.45,.05,.25,1)' },
  );
  await wait(470);
  wearOn();
  Object.assign(els.pulse.style, { left: `${to.x - size / 2}px`, top: `${to.y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  play(els.pulse, [{ transform: 'scale(.55)', opacity: 0.8 }, { transform: 'scale(1.25)', opacity: 0 }], { duration: 760, easing: 'cubic-bezier(.2,.7,.2,1)' });
  await finished(flight);
  els.flyer.style.visibility = 'hidden';
}

/** Lid shuts, and the box drops back into its place on the shelf. */
export async function closeBox(els, button) {
  els.root.dataset.waiting = 'false';
  const start = (a) => {
    a.getAnimations().forEach((x) => x.cancel());
  };
  const shut = play(els.lid, [{ transform: LID_OPEN }, { transform: 'rotateX(0deg)' }], { duration: 340, easing: SMOOTH });
  const dim = play(els.glow, [{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
  const hide = play(els.item, [{ opacity: 0 }, { opacity: 0 }], { duration: 1 });
  await finished(shut, dim, hide);
  start(els.root);
  const home = els.root.getBoundingClientRect();
  const to = button.getBoundingClientRect();
  const a = centre(to);
  const b = centre(home);
  await finished(
    play(
      els.root,
      [{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${to.width / home.width})` }],
      { duration: 420, easing: 'cubic-bezier(.5,0,.2,1)' },
    ),
  );
  resetBox(els);
  popOrb(button);
}

/** Taking it off: the product returns from the body to its circle. */
export async function flyHome(els, landing, button, src) {
  const to = button.getBoundingClientRect();
  const from = landing || { x: window.innerWidth / 2, y: window.innerHeight * 0.42, w: window.innerWidth * 0.6, h: window.innerWidth * 0.6 };
  const scale = Math.min(Math.max(from.w, from.h) / THUMB_FILL / to.width, 8);
  els.flyer.src = src;
  Object.assign(els.flyer.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, visibility: 'visible' });
  const c = centre(to);
  const flight = play(
    els.flyer,
    [
      { transform: `translate(${from.x - c.x}px, ${from.y - c.y}px) scale(${scale})`, opacity: 0 },
      { transform: `translate(${(from.x - c.x) * 0.8}px, ${(from.y - c.y) * 0.8}px) scale(${scale * 0.8})`, opacity: 1, offset: 0.25 },
      { transform: 'translate(0,0) scale(.86)', opacity: 1 },
    ],
    { duration: 560, easing: 'cubic-bezier(.5,0,.2,1)' },
  );
  await finished(flight);
  els.flyer.style.visibility = 'hidden';
  flight.cancel();
  popOrb(button);
}

function popOrb(button) {
  play(button.firstElementChild, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 320, fill: 'none' });
}

export function flash(el) {
  play(el, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 340, fill: 'none' });
}
