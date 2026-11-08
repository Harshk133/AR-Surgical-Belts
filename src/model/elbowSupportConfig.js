// Tennis elbow support (DaynoR "Tennis Elbow Support"): a counterforce strap. Product data + fitting contract.
//
// Like the wrist brace, the strap is generated on the wearer every frame (src/ar/ElbowStrap.js).
// All dimensions are ratios of the wearer's forearm length Lf = |elbow - wrist| (about 26 cm on an
// adult), measured in the same solve that places the strap, so projected size stays consistent.
//
// Local arm frame: origin = elbow joint, +Y distal along the forearm, +X lateral (the outer side of the
// elbow: lateral epicondyle, extensor muscles), +Z volar (the palm side in supination). Left arms are the
// mirror image, applied by the renderer.
//
// From the box: "for best result wear 50 m.m. below Elbow"; the strap end goes through the plastic
// buckle, is pulled back and locked over the velcro hook. Real product (photo 2): beige padded strap with
// a raised pressure-pad pocket and a white DaynoR label.

export const ELBOW_STRAP = {
  centre: 0.2, // strap centre below the elbow joint (x Lf): ~5 cm on an adult forearm
  width: 0.21, // ~5.5 cm
  thickness: 0.016, // padded band (~4 mm) incl. a little ease
  binding: 0.007, // stitched edge binding radius
  pad: { centreDeg: -38, spanDeg: 56, height: 0.014, v0: 0.14, v1: 0.86 }, // over the extensor mass (lateral -> dorsal)
  label: { centreDeg: 18, spanDeg: 34, v0: 0.2, v1: 0.8 },
  buckleDeg: 150, // closure on the medial / volar side, away from the pad
  tail: { spanDeg: 58, lift: 0.009 }, // strap end folded back over the band toward the front
  // outline measurement levels (x Lf) and anatomical priors (x Lf): proximal forearm
  // breadth ~8.5 cm, thickness ~7 cm on an adult (circumference ~26 cm)
  levels: [0.1, 0.2, 0.3],
  priorHalfWidth: [0.172, 0.165, 0.156],
  priorDepthRatio: [0.82, 0.82, 0.83],
  axisLevels: [0.45, 0.6], // extra scans that only correct the forearm centre line
};

export const ELBOW_PRODUCT = {
  id: 'tennisElbow',
  kind: 'elbow',
  name: 'Tennis Elbow Support',
  brand: 'DaynoR Orthopedic',
  tagline: 'Counterforce strap for lateral epicondylitis',
  description:
    'A padded beige counterforce strap worn about 5 cm below the elbow. A raised pressure pad sits over the forearm extensor muscles, and the strap closes through a plastic buckle and locks back on itself with velcro.',
  features: [
    'Worn 50 mm below the elbow (as the box instructions say)',
    'Raised pressure pad over the extensor muscles',
    'Pull-through plastic buckle, velcro lock',
    'Padded band with stitched edges',
    'Medium and large sizes; also usable as a calf support',
  ],
  swatches: ['#d6b98f', '#c9a97a', '#f2f0ea'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size or any medical condition. Ask a clinician or physiotherapist how to position and tension the strap.',
  tryOn: {
    title: 'See the strap on your forearm',
    text: 'Show your forearm and elbow to the camera with your shoulders in view. The strap is built on your own arm, 5 cm below the elbow, with the pad over the outer side.',
    tips: [
      'Sit or stand about 1 m from the camera so your shoulders, elbow and wrist are in the frame.',
      'Bend your elbow a little and hold the forearm away from your body, against a plain background if you can.',
      'Hold still for a moment while it aligns, then rotate your forearm once so the strap can fit its thickness.',
    ],
    stand: 'Show your elbow and forearm, with your shoulders in view',
  },
  facingLabels: { outer: 'Outer side (pad)', inner: 'Inner side (buckle)', front: 'Front of forearm', back: 'Back of forearm' },
  views: [
    { id: 'outer', label: 'Outer', text: 'Turn the outer side of your elbow to the camera to see the pressure pad over the extensor muscles.' },
    { id: 'inner', label: 'Inner', text: 'Show the inner side of your forearm to see the buckle and the velcro closure.' },
    { id: 'front', label: 'Front', text: 'Turn your palm toward the camera to see the band and the label. This view also fits the thickness of your forearm.' },
  ],
  fitLabels: {
    width: ['Strap fitted to your forearm outline', 'Hold your forearm against a plain background to fit the strap'],
    depth: ['Forearm thickness fitted', 'Rotate your forearm once to fit its thickness'],
  },
  sliders: [
    { key: 'y', label: 'Along arm', min: -0.04, max: 0.04, step: 0.001, unit: 'cm' },
    { key: 'x', label: 'Outer / inner', min: -0.015, max: 0.015, step: 0.001, unit: 'cm' },
    { key: 'z', label: 'Front / back', min: -0.015, max: 0.015, step: 0.001, unit: 'cm' },
    { key: 'scale', label: 'Girth', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Rotate', min: -40, max: 40, step: 1, unit: 'deg' },
  ],
  settingsLabels: { occlusion: 'Hands and the other arm pass in front', fitShape: 'Fit the strap to my forearm outline' },
  inspectorViews: [
    ['outer', 'Outer'],
    ['front', 'Front'],
    ['inner', 'Inner'],
    ['back', 'Back'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'tennis-elbow-support-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Sit or stand about 1 m from the camera: the body tracker needs your shoulders, and the strap needs your elbow and wrist in view.',
        'Bend your elbow a little (20° or more). A bent elbow tells the app which side is the outer side, where the pad goes.',
        'Hold the forearm away from your body, against a plain background, so its outline can be measured. In front of your body it falls back to typical proportions.',
        'Rotate your forearm once so the thickness can be fitted.',
        'If the strap sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Left or right arm',
      items: ['The strap goes on the arm that is most clearly in view. To choose, open Display & tracking settings and pick an arm.'],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position and size are estimated from a single camera image; there is no depth sensor.',
        'The elbow position comes from body tracking and can be off by a centimetre or two; use "Along arm" to correct it.',
        'It does not measure you, choose a size, or check clinical fit.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
