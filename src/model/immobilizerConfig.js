// Universal shoulder immobilizer (DaynoR): product data + fitting contract.
//
// Worn (box front, and manufacturer / hospital fitting guides): the injured arm is held against the
// body with the elbow at ~90 deg and the forearm across the stomach in a pouch; a wide body band (swathe)
// wraps the lower chest AND the upper arm; two shoulder straps run from the band over both shoulders;
// an X of straps ties the pouch to the band. "Universal": the same product fits either arm (turned
// upside down for the other shoulder), so the geometry is mirrored for the chosen side.
// Real product (photo 1): grey fabric with green piping on every edge.
//
// Geometry is built procedurally in the SAME reference-torso space as the Taylor's brace
// (origin = shoulder-joint midpoint, +X wearer's left, +Y up, +Z front, ref shoulder width 0.36 m), so
// it reuses TorsoTransform (placement, front/back) and BodyShapeFitter (measured torso shape).
// All lengths below are in those reference units unless noted.

export const IMMOBILIZER = {
  // body band (swathe). Measured on the box photo (shoulder joints = 0.36 ref): top 0.13-0.14 below the
  // shoulder line, bottom ~0.30, i.e. just above the elbow. The band follows the real elbow height:
  band: { height: 0.165, aboveElbow: 0.035, minBottom: -0.4, maxBottom: -0.24, thickness: 0.011 },
  // upper arm / forearm radii (ref) used to wrap the band and size the pouch, scaled by the
  // measured shoulder width through the anchor
  upperArmRadius: 0.05,
  forearmRadius: [0.046, 0.036], // elbow, wrist
  armGapToWrap: 0.06, // the band takes the arm in only if it lies within this gap of the torso
  pouch: { behindElbow: 0.05, stopBeforeWrist: 0.015, slack: 0.016, thickness: 0.008 },
  xStrap: { width: 0.036, thickness: 0.004 },
  shoulderStrap: { x: 0.105, width: 0.038, thickness: 0.004, buckleY: -0.06 },
  piping: 0.0045,
  // arm-in-sling detection (deg / ref); enter strict, leave lenient
  pose: { flexIn: [60, 130], flexOut: [45, 150], elbowGapIn: 0.09, elbowGapOut: 0.14 },
  superN: 2.6, // reference torso cross-section exponent (blender/build_brace.py SUPER_N)
};

export const IMMOBILIZER_PRODUCT = {
  id: 'shoulderImmobilizer',
  kind: 'immobilizer',
  name: 'Universal Shoulder Immobilizer',
  brand: 'DaynoR Orthopedic',
  tagline: 'Arm pouch with body band and shoulder straps',
  description:
    'Holds the arm against the body with the elbow at 90°: the forearm rests in a pouch across the stomach, a wide body band wraps the lower chest and the upper arm, and two shoulder straps carry the weight. Grey fabric with green piping; fits either arm.',
  features: [
    'Forearm pouch, elbow at 90°, hand free',
    'Wide body band around the chest and upper arm',
    'Two adjustable shoulder straps',
    'X straps tie the pouch to the band',
    'Universal: left or right arm',
  ],
  swatches: ['#5c6166', '#4a4f54', '#2f9e7f'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size or any medical condition. A shoulder immobilizer should be fitted and adjusted by a clinician.',
  tryOn: {
    title: 'See the immobilizer on you',
    text: 'Stand facing the camera, bend the arm to be supported to 90° and rest the forearm across your stomach. The band, pouch and straps are built on your own body.',
    tips: [
      'Stand 1.2–2 m from the camera with your head, shoulders and waist in view.',
      'Keep the upper arm against your side, elbow bent to about 90°, forearm across your stomach.',
      'Wear fitted clothing. Hold still for a second while it aligns, then turn sideways once.',
    ],
    stand: 'Line yourself up with the outline, forearm across your stomach',
  },
  facingLabels: { front: 'Front view', side: 'Side view', back: 'Back view' },
  views: [
    { id: 'front', label: 'Front', text: 'Face the camera to see the pouch, the X straps and the body band over your arm.' },
    { id: 'side', label: 'Side', text: 'Turn your supported side toward the camera to see how the band wraps the upper arm and the pouch holds the forearm.' },
    { id: 'back', label: 'Back', text: 'Turn around to see the shoulder straps and the band across your back. Back-view tracking is estimated.' },
  ],
  fitLabels: {
    width: ['Band shaped to your outline', 'Face the camera to fit the band width'],
    depth: ['Chest depth fitted', 'Turn sideways once to fit the depth'],
  },
  sliders: [
    { key: 'y', label: 'Up / down', min: -0.1, max: 0.1, step: 0.005, unit: 'cm' },
    { key: 'x', label: 'Left / right', min: -0.08, max: 0.08, step: 0.005, unit: 'cm', screen: true },
    { key: 'scale', label: 'Size', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Tilt', min: -15, max: 15, step: 1, unit: 'deg', screen: true },
    { key: 'z', label: 'Depth', min: -0.05, max: 0.05, step: 0.005, unit: 'cm' },
  ],
  settingsLabels: { occlusion: 'Hands and the other arm pass in front', fitShape: 'Shape the band to my body' },
  inspectorViews: [
    ['front', 'Front'],
    ['left', 'Left'],
    ['back', 'Back'],
    ['right', 'Right'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'shoulder-immobilizer-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Stand 1.2–2 m from the camera so your head, shoulders and waist are visible.',
        'Bend the arm to be supported to about 90° and rest the forearm across your stomach, upper arm against your side, as the immobilizer would hold it.',
        'The app picks the bent arm automatically. To choose, open Display & tracking settings and pick an arm.',
        'If your arm hangs straight or moves away from your body, the pouch hides and the band wraps only your chest until you bring the arm back.',
        'If it sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Seeing the sides and back',
      items: [
        'Turn slowly. The band follows your torso; the pouch follows your forearm.',
        'From behind, the pouch is hidden by your body and you see the shoulder straps and the band.',
        'For an exact look at every strap, use the 3D viewer in the side panel.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position, size and depth are estimated from a single camera image; there is no depth sensor.',
        'Your other hand passes in front using estimated positions, so small clipping can occur.',
        'It does not measure you, choose a size, or check clinical fit.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
