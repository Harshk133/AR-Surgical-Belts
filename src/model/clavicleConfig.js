// Meek clavicle brace (DaynoR): figure-of-8 brace. Product data + fitting contract.
//
// Worn (box front/back; BraceAbility, Breg and patent descriptions of figure-8 clavicle braces): each
// wide padded strap goes over the FRONT of the shoulder, down and UNDER the armpit, and back across the
// back; the two loops meet on a padded back plate between the shoulder blades (with the buckle), so
// tightening them pulls the shoulders back. Box: "wide shoulder straps with generous padding", "thick
// foam laminated fabric mesh", hook & loop fasteners. Real product (photo 3): grey padded straps with
// green piping on both edges.
//
// Reference-torso space (origin = shoulder-joint midpoint, +X wearer's left, +Y up, +Z front, shoulder
// joints at x = +-0.18). The loop's way points are given for the wearer's left; the right is mirrored.
// Each way point is (x, y) plus which surface it lies on; z comes from the fitted torso at run time.

export const CLAVICLE = {
  // one loop: back plate (upper) -> over the top of the shoulder -> down the front of the shoulder
  // -> under the armpit -> back across the back -> back plate (lower)
  loop: [
    { x: 0.03, y: -0.105, on: 'back' },
    { x: 0.075, y: -0.03, on: 'back' },
    { x: 0.112, y: 'crest' }, // over the trapezius, inside the shoulder joint (at x = 0.18)
    { x: 0.142, y: -0.015, on: 'front' }, // front of the shoulder, below the clavicle
    { x: 0.15, y: -0.085, on: 'front', inset: 0.2 }, // anterior armpit fold, in front of the arm
    { x: 0.165, y: -0.13, on: 'side' }, // in the armpit
    { x: 0.14, y: -0.165, on: 'back', inset: 0.55 },
    { x: 0.05, y: -0.155, on: 'back' },
  ],
  width: { back: 0.042, shoulder: 0.062 }, // wide padded over the shoulder, narrower across the back
  thickness: { back: 0.006, shoulder: 0.013 },
  offset: 0.005, // over clothing
  // the shoulder joint and the top of the upper arm stand proud of the torso: the strap wraps over them
  // (same proportions as the arm occluders: joint sphere ~0.055-0.06, upper arm radius ~0.05)
  shoulderBall: { x: 0.18, y: -0.012, z: 0, r: 0.062 },
  upperArm: { to: [0.205, -0.3, -0.005], r: 0.053, aboveY: -0.1 },
  plate: { y: -0.13, halfW: 0.055, halfH: 0.06, thickness: 0.009 },
};

export const CLAVICLE_PRODUCT = {
  id: 'clavicleBrace',
  kind: 'clavicle',
  name: 'Meek Clavicle Brace',
  brand: 'DaynoR Orthopedic',
  tagline: 'Figure-of-8 clavicle brace',
  description:
    'Wide, generously padded straps loop over the front of each shoulder and under the arms, and cross on a padded back plate between the shoulder blades, holding the shoulders back to stabilize and align a clavicle fracture. Foam-laminated mesh with hook and loop fasteners.',
  features: [
    'Wide padded shoulder straps',
    'Figure-of-8 design crossing on the back',
    'Padded back plate with buckle',
    'Foam-laminated breathable mesh',
    'Small, Medium, Large and X-Large',
  ],
  swatches: ['#5f6469', '#4a4f54', '#2f9e7f'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size, posture or any medical condition. A clavicle brace should be fitted and tightened as advised by a clinician.',
  tryOn: {
    title: 'See the brace on you',
    text: 'Use your camera to preview the clavicle brace on your own shoulders. Turn around to see the straps cross on your back.',
    tips: [
      'Stand 1.2–2 m from the camera with your head and shoulders in view.',
      'Relax your arms at your sides, slightly away from your body.',
      'Hold still for a second while it aligns, then turn around slowly.',
    ],
    stand: 'Line yourself up with the outline, shoulders in view',
  },
  facingLabels: { front: 'Front view', side: 'Side view', back: 'Back view' },
  views: [
    { id: 'front', label: 'Front', text: 'Face the camera to see the padded straps over the front of your shoulders.' },
    { id: 'side', label: 'Side', text: 'Turn sideways to see each strap loop round the shoulder and under the arm.' },
    { id: 'back', label: 'Back', text: 'Turn around to see the figure-of-8: the straps meet on the padded back plate between the shoulder blades. Back-view tracking is estimated: turn slowly.' },
  ],
  fitLabels: {
    width: ['Brace sized to your shoulders', 'Face the camera to fit your shoulders'],
    depth: ['Chest depth fitted', 'Turn sideways once to fit the depth'],
  },
  sliders: [
    { key: 'y', label: 'Up / down', min: -0.06, max: 0.06, step: 0.005, unit: 'cm' },
    { key: 'x', label: 'Left / right', min: -0.05, max: 0.05, step: 0.005, unit: 'cm', screen: true },
    { key: 'scale', label: 'Size', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Tilt', min: -15, max: 15, step: 1, unit: 'deg', screen: true },
    { key: 'z', label: 'Depth', min: -0.04, max: 0.04, step: 0.005, unit: 'cm' },
  ],
  settingsLabels: { occlusion: 'Arms and head pass in front of the straps', fitShape: 'Shape the brace to my body' },
  inspectorViews: [
    ['front', 'Front'],
    ['left', 'Left'],
    ['back', 'Back'],
    ['right', 'Right'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'clavicle-brace-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Stand 1.2–2 m from the camera so your head and both shoulders are clearly visible.',
        'Relax your arms at your sides, slightly away from your body, while it aligns.',
        'Fitted, plain clothing gives the most accurate result.',
        'If it sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Seeing the back',
      items: [
        'The figure-of-8 crossing and the back plate are on your back: turn around slowly to see them.',
        'When your face is hidden, the app infers that you face away. This is an estimate; turning slowly helps.',
        'For an exact look, use the 3D viewer in the side panel.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position and size are estimated from a single camera image; there is no depth sensor.',
        'The straps run under your arms, so the arms hide them there; small clipping can occur.',
        'It does not measure you, choose a size, or check clinical fit.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
