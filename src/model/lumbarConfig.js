// Lumbar & sacral support (DaynoR "L.S. Belt with Contour"): product data + fitting contract.
//
// Worn (box art; NHS Guy's & St Thomas' and LSO fitting guides): centred on the lower back with the
// bottom edge at the top of the buttocks so it covers the sacrum, wrapped round and fastened with velcro
// at the front (middle first), then the "double pull" side straps are pulled snug. It must not dig into
// the ribs or the groin, so the front is lower at the top and higher at the bottom than the back.
// Box: tempered spring-steel stays, contoured rigid rear splinting, double-pull side straps, surgical
// elastic with pores. Real product (photo 1): dark charcoal striped elastic, a horizontal velcro strip,
// a white DaynoR label.
//
// Built procedurally in the reference-torso space of the Taylor's brace (origin = shoulder-joint
// midpoint, +X wearer's left, +Y up, +Z front, shoulder width 0.36, shoulders -> hips 0.5), so the
// measured BodyShapeFitter factors apply directly. Angles: 0 = wearer's left, 90 = front, 270 = back.

export const LUMBAR = {
  // edges (ref y): the back covers the sacrum, the front stays clear of the ribs and the groin
  // ref anatomy: hip joints (MediaPipe hips) at -0.50, waist -0.33..-0.40, iliac crest ~-0.42, sacrum
  // ~-0.42..-0.56 (its tip about level with the hip joints), pubic bone ~-0.50 at the front
  top: { front: -0.335, back: -0.29 }, // front below the ribs; back about L1
  bottom: { front: -0.515, back: -0.575 }, // front above the groin; back over the whole sacrum
  thickness: 0.008,
  binding: 0.0045,
  // contoured rear panel with the spring-steel stays
  rearPanel: { halfDeg: 28, height: 0.011, inset: 0.03 },
  stays: { deg: [-21, -7, 7, 21], height: 0.0045, widthDeg: 1.6 }, // inside the panel (+-28 deg)
  // double-pull side straps: per side an upper and a lower strap converging toward the front
  pull: {
    fromDeg: 238, // starts at the rear panel edge
    toDeg: 62, // ends near the front closure (wearer's left side; mirrored for the right)
    upper: { back: -0.375, front: -0.405 },
    lower: { back: -0.505, front: -0.475 },
    height: 0.058,
    lift: 0.005,
  },
  flap: { fromDeg: 88, toDeg: 114, lift: 0.004 }, // front velcro closure overlap
};

export const LUMBAR_PRODUCT = {
  id: 'lumbarSacral',
  kind: 'lumbar',
  name: 'Lumbar & Sacral Support',
  brand: 'DaynoR Orthopedic',
  tagline: 'L.S. belt with contoured rear splinting',
  description:
    'A wide surgical-elastic belt that supports the lower back and sacrum: a contoured rear panel with spring-steel stays, a double-pull side strap system for a firm fit, and a velcro front closure. Dark charcoal striped elastic with pores for breathing.',
  features: [
    'Contoured rear panel with spring-steel stays',
    'Double-pull side straps',
    'Covers the lower back down to the sacrum',
    'Velcro front closure',
    'Breathable surgical elastic',
  ],
  swatches: ['#2e3135', '#3b3f44', '#2a8f8a'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size, posture or any medical condition. Ask a clinician or orthotist to select and fit a lumbar support.',
  tryOn: {
    title: 'See the belt on you',
    text: 'Use your camera to preview the Lumbar & Sacral Support on your own body. It sits over your lower back and hips; turn around to see the rear panel.',
    tips: [
      'Stand 1.5–2.2 m from the camera so your shoulders and hips are both in view.',
      'Wear fitted, plain clothing in even, front-facing light.',
      'Hold still for a second while it aligns, then turn sideways and around slowly.',
    ],
    stand: 'Line yourself up with the outline, hips in view',
  },
  facingLabels: { front: 'Front view', side: 'Side view', back: 'Back view' },
  views: [
    { id: 'front', label: 'Front', text: 'Face the camera to see the velcro front closure and where the belt sits below the ribs.' },
    { id: 'side', label: 'Side', text: 'Turn sideways to see the double-pull straps and the belt depth over your waist.' },
    { id: 'back', label: 'Back', text: 'Turn around to see the contoured rear panel and the stays over your lower back and sacrum. Back-view tracking is estimated: turn slowly.' },
  ],
  fitLabels: {
    width: ['Belt shaped to your waist and hips', 'Face the camera to fit the width'],
    depth: ['Waist and tummy depth fitted', 'Turn sideways once to fit the depth'],
  },
  sliders: [
    { key: 'y', label: 'Up / down', min: -0.1, max: 0.1, step: 0.005, unit: 'cm' },
    { key: 'x', label: 'Left / right', min: -0.08, max: 0.08, step: 0.005, unit: 'cm', screen: true },
    { key: 'scale', label: 'Girth', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Tilt', min: -15, max: 15, step: 1, unit: 'deg', screen: true },
    { key: 'yawDeg', label: 'Turn', min: -30, max: 30, step: 1, unit: 'deg', screen: true },
    { key: 'z', label: 'Depth', min: -0.05, max: 0.05, step: 0.005, unit: 'cm' },
  ],
  settingsLabels: { occlusion: 'Arms pass in front of the belt', fitShape: 'Shape the belt to my body' },
  inspectorViews: [
    ['front', 'Front'],
    ['left', 'Left'],
    ['back', 'Back'],
    ['right', 'Right'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'lumbar-sacral-support-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Stand 1.5–2.2 m from the camera so your shoulders AND hips are visible: the belt sits over the lower back and the top of the hips.',
        'Face the camera with your arms relaxed slightly away from your sides while it aligns.',
        'Fitted, plain clothing gives the most accurate shape; loose tops make the belt fit the clothes.',
        'Turn sideways once so the belt can fit your waist and tummy depth.',
        'If it sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Seeing the back',
      items: [
        'Turn around slowly to see the rear panel and stays. When your face is hidden the app infers that you face away; this is an estimate.',
        'For an exact look, use the 3D viewer in the side panel.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position, size and depth are estimated from a single camera image; there is no depth sensor.',
        'Arms and hands pass in front using approximations, so small clipping can occur.',
        'It does not measure you, choose a size, or check clinical fit.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
