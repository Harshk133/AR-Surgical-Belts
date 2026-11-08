// Thumb wrist brace (DaynoR "Thumb Wrist Brace"): product data and the fitting contract.
//
// Unlike the Taylor's brace there is no fixed GLB: the brace is generated every frame on the wearer's
// own hand (src/ar/WristBrace.js), so every dimension below is a RATIO of two landmark distances that
// MediaPipe reports for each hand:
//   span = |index MCP (5) - pinky MCP (17)|   (knuckle line, about 6.5 cm on an adult)
//   L    = |wrist (0) - middle MCP (9)|        (palm length, about 9 cm)
// Ratios are scale-free, so the brace fits a child's hand and a large adult hand the same way, and the
// metric scale MediaPipe guesses cancels out exactly as it does for the torso (same solve, same scale).
//
// Local hand frame used everywhere: origin = wrist landmark, +Y = distal (wrist -> middle MCP),
// +X = radial (toward the thumb), +Z = dorsal (back of the hand). Right hands are the mirror image
// (the renderer applies a mirrored basis), so the geometry is written once.

export const WRIST_BRACE = {
  // ---- brace extent along the limb (multiples of L) ------------------------------------------
  // Fitting guides for this kind of brace: the distal edge sits just below the palm crease so the
  // fingers move freely; the sleeve runs about 7-8 cm up the forearm.
  proximalEdge: -0.8,
  distalEdge: { dorsal: 0.56, palmar: 0.47, ulnar: 0.5, radial: 0.52 },
  // ---- thumb sleeve (fraction of the thumb segment lengths) ----------------------------------
  thumbStart: -0.35, // before the CMC joint (1), inside the palm sleeve
  thumbEnd: 0.4, // past the MCP joint (2), toward the IP joint (3): covers the base of the thumb
  // ---- wrist strap (multiples of L) -----------------------------------------------------------
  strap: { from: -0.44, to: -0.08, tabEndDeg: 128, tabSpanDeg: 78 },
  // ---- material (multiples of span) -----------------------------------------------------------
  neoprene: 0.052, // ~3.4 mm including a little ease over the skin
  strapLift: 0.03, // strap lies on the sleeve
  binding: 0.03, // radius of the stitched edge binding
  // ---- anatomical priors (multiples of span), refined by the outline fitter -------------------
  // Adult anthropometry: wrist breadth ~0.92 span, wrist thickness ~0.68 span, forearm breadth 8 cm
  // above the wrist ~1.12 span. Measured outline replaces these when it is trustworthy.
  levels: [-0.1, -0.3, -0.55, -0.8], // where the outline is measured (multiples of L)
  priorHalfWidth: [0.46, 0.49, 0.53, 0.56],
  priorDepthRatio: [0.7, 0.71, 0.73, 0.75], // thickness / breadth
  maxBendDeg: 50, // wrist flexion/deviation the forearm section may follow
};

export const WRIST_PRODUCT = {
  id: 'thumbWrist',
  kind: 'wrist',
  name: 'Thumb Wrist Brace',
  brand: 'DaynoR Orthopedic',
  tagline: 'Neoprene thumb spica and wrist support',
  description:
    'A soft black neoprene wrap that supports the wrist and the base of the thumb. The thumb passes through its own sleeve, the sleeve ends below the palm crease so the fingers stay free, and a velcro strap closes around the wrist.',
  features: [
    'Thumb sleeve over the CMC and MCP joints',
    'Wrist and lower-forearm neoprene sleeve',
    'Wrap-around velcro wrist strap',
    'Ends below the palm crease: fingers stay free',
    'Fits either hand',
  ],
  swatches: ['#1b1d20', '#2b2e33', '#3a3e44'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size or any medical condition. Ask a clinician or orthotist to select and fit a brace.',
  tryOn: {
    title: 'See the brace on your wrist',
    text: 'Hold your hand up to the camera with your forearm in view. The brace is built on your own hand and follows your thumb and wrist.',
    tips: [
      'Hold your hand 30–60 cm from the camera, fingers relaxed and spread a little.',
      'Keep your wrist and part of your forearm in the frame, against a plain background if you can.',
      'Hold still for a moment while it aligns, then rotate your wrist once to show the thumb side.',
    ],
    stand: 'Hold your hand up with your wrist and forearm in view',
  },
  facingLabels: { back: 'Back of hand', palm: 'Palm', side: 'Thumb side' },
  views: [
    { id: 'back', label: 'Back', text: 'Show the back of your hand to see the sleeve and the strap tab.' },
    { id: 'palm', label: 'Palm', text: 'Turn your palm to the camera to see where the sleeve ends below the palm crease and the fingers stay free.' },
    { id: 'side', label: 'Thumb', text: 'Rotate to the thumb side to see the thumb sleeve. This also lets the brace fit the thickness of your wrist.' },
  ],
  fitLabels: {
    width: ['Wrist width fitted to your outline', 'Hold your wrist against a plain background to fit the width'],
    depth: ['Wrist thickness fitted', 'Rotate your wrist once to show the thumb side'],
  },
  sliders: [
    { key: 'y', label: 'Along arm', min: -0.03, max: 0.03, step: 0.001, unit: 'cm' },
    { key: 'x', label: 'Thumb / pinky', min: -0.015, max: 0.015, step: 0.001, unit: 'cm' },
    { key: 'z', label: 'Back / palm', min: -0.015, max: 0.015, step: 0.001, unit: 'cm' },
    { key: 'scale', label: 'Girth', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Twist', min: -25, max: 25, step: 1, unit: 'deg' },
  ],
  settingsLabels: { occlusion: 'Fingers pass in front of the brace', fitShape: 'Fit the brace to my wrist outline' },
  inspectorViews: [
    ['back', 'Back'],
    ['palm', 'Palm'],
    ['thumb', 'Thumb'],
    ['pinky', 'Pinky'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'thumb-wrist-brace-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Hold your hand 30–60 cm from the camera with the wrist and some forearm in view.',
        'Relax your fingers and spread them a little while it aligns.',
        'A plain background behind your arm lets the app measure your wrist and forearm outline. In front of your body it falls back to typical proportions.',
        'Rotate your wrist once to show the thumb side, so the thickness of your wrist can be fitted.',
        'If the brace sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Left or right hand',
      items: [
        'The brace goes on the hand nearest the camera. To choose, open Display & tracking settings and pick a hand.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position and size are estimated from a single camera image; there is no depth sensor.',
        'Fingers pass in front of the brace using estimated finger positions, so small clipping can occur.',
        'It does not measure you, choose a size, or check clinical fit. A clinician or orthotist should fit the brace.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
