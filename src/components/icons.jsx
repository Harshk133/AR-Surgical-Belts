const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const IconCamera = () => (
  <svg {...base}><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
);
export const IconStop = () => (
  <svg {...base}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconReset = () => (
  <svg {...base}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></svg>
);
export const IconSwitch = () => (
  <svg {...base}><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><path d="M9 13.5h6M13 11.5l2 2-2 2" /></svg>
);
export const IconHelp = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4" /><path d="M12 17h.01" /></svg>
);
export const IconClose = () => (
  <svg {...base} width="18" height="18"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconDownload = () => (
  <svg {...base} width="18" height="18"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
);

// Simple torso glyphs for front / side / back guidance
export const TorsoFront = () => (
  <svg {...base}><circle cx="12" cy="4.5" r="2" /><path d="M7 8.5h10l-1 10H8z" /><path d="M9.5 8.5v3M14.5 8.5v3" /></svg>
);
export const TorsoSide = () => (
  <svg {...base}><circle cx="12" cy="4.5" r="2" /><path d="M10 8.5h4.5l.5 10h-5z" /></svg>
);
export const TorsoBack = () => (
  <svg {...base}><circle cx="12" cy="4.5" r="2" fill="currentColor" /><path d="M7 8.5h10l-1 10H8z" /><path d="M10.5 9v9M13.5 9v9" /></svg>
);

// Hand glyphs for the wrist brace views
export const HandBack = () => (
  <svg {...base}><path d="M8 21v-5l-2.5-3.5a1.4 1.4 0 0 1 2.2-1.7L9 12V5a1.2 1.2 0 0 1 2.4 0v5.5V3.8a1.2 1.2 0 0 1 2.4 0v6.7V5a1.2 1.2 0 0 1 2.4 0v6V7.2a1.2 1.2 0 0 1 2.4 0V15c0 3-1.5 4-2.6 6" /><path d="M8.5 17.5h8" /></svg>
);
export const HandPalm = () => (
  <svg {...base}><path d="M8 21v-5l-2.5-3.5a1.4 1.4 0 0 1 2.2-1.7L9 12V5a1.2 1.2 0 0 1 2.4 0v5.5V3.8a1.2 1.2 0 0 1 2.4 0v6.7V5a1.2 1.2 0 0 1 2.4 0v6V7.2a1.2 1.2 0 0 1 2.4 0V15c0 3-1.5 4-2.6 6" /><path d="M11 14.5c1 .8 2.6.8 3.6 0" /></svg>
);
export const HandThumb = () => (
  <svg {...base}><path d="M10 21v-4.5c-1.5-.8-3-2.6-3-5.5V9.5a1.3 1.3 0 0 1 2.6 0V11l1-6.2a1.3 1.3 0 0 1 2.6.3V11h3.3a1.6 1.6 0 0 1 1.5 2.1l-1.2 4.2c-.3 1-1 1.7-1.8 2V21" /><path d="M9.5 17.5h6" /></svg>
);

// Forearm glyphs for the elbow strap views (elbow at the top, strap band below it)
export const ArmOuter = () => (
  <svg {...base}><path d="M9 3c-1 2-1.5 4-1 6l1 12h5l1-11c.3-2.5-.3-5-1.5-7" /><path d="M7.8 11.5h7" /><path d="M8 14h6.8" /><rect x="11.5" y="11.6" width="2.6" height="2.3" rx="1" fill="currentColor" /></svg>
);
export const ArmInner = () => (
  <svg {...base}><path d="M9 3c-1 2-1.5 4-1 6l1 12h5l1-11c.3-2.5-.3-5-1.5-7" /><path d="M7.8 11.5h7" /><path d="M8 14h6.8" /><rect x="8.6" y="10.6" width="2.4" height="4.2" rx="0.6" /></svg>
);
export const ArmFront = () => (
  <svg {...base}><path d="M9 3c-1 2-1.5 4-1 6l1 12h5l1-11c.3-2.5-.3-5-1.5-7" /><path d="M7.8 11.5h7" /><path d="M8 14h6.8" /><path d="M10.5 12.7h2" /></svg>
);
