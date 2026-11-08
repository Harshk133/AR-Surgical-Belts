// Arm sling pouch (DaynoR "Arm Sling Pouch"): product data + fitting contract.
//
// Worn (box front/back; 3M Futuro, NHS and shoulderdoc fitting guides): the forearm lies in an
// open-topped pouch with the ELBOW SNUG IN THE CLOSED CORNER and the fingers out of the front; the forearm
// is about level; ONE strap runs from the elbow end across the back, over the OPPOSITE shoulder (on the
// fleshy part of the shoulder, not across the neck, with a comfort pad) and down the front to a buckle
// at the hand end. The pouch should leave room under the armpit.
// Real product: grey fabric with green piping (the "Arm Sling Pouch" pack in the reference photos).
//
// Same reference-torso space as the Taylor's brace and the immobilizer (origin = shoulder-joint
// midpoint, +X wearer's left, +Y up, +Z front, ref shoulder width 0.36 m). Lengths in ref units.

export const ARM_SLING = {
  upperArmRadius: 0.05,
  forearmRadius: [0.046, 0.036], // elbow, wrist
  armGapToWrap: 1, // a sling has no body band: never required
  pouch: {
    behindElbow: 0.03, // the closed corner sits just behind the elbow
    endAlongHand: 0.6, // the pouch ends this far from the wrist toward the knuckles (fingers out)
    wallAbove: [0.03, 0.012], // top edge above the forearm's top (elbow end, hand end): the trapezoid
    slack: 0.012,
    thickness: 0.006,
    openDeg: 34, // half-angle of the open top, measured from straight up
    endDepth: 0.02, // the closed elbow-end panel
  },
  strap: { shoulderX: 0.11, width: 0.032, padWidth: 0.056, thickness: 0.004, padThickness: 0.009, offset: 0.006 },
  piping: 0.0045,
  // in-sling detection (deg / ref); enter strict, stay lenient. A sling keeps the forearm about level.
  pose: { flexIn: [55, 125], flexOut: [40, 135], elbowGapIn: 0.12, elbowGapOut: 0.18, maxInclineIn: 0.6, maxInclineOut: 0.72 }, // incline 0.6 ~ 37 deg
  hideAfter: 0.6, // s out of the sling position before the sling is hidden
};

export const ARM_SLING_PRODUCT = {
  id: 'armSling',
  kind: 'sling',
  name: 'Arm Sling Pouch',
  brand: 'DaynoR Orthopedic',
  tagline: 'Pouch arm sling with shoulder strap',
  description:
    'A grey pouch that cradles the forearm with the elbow snug in the closed corner and the fingers free, held by a single strap that runs across the back, over the opposite shoulder on a comfort pad, and buckles at the front. Small, medium, large and extra large.',
  features: [
    'Open pouch, elbow in the closed corner',
    'Fingers free at the front',
    'Strap over the opposite shoulder with comfort pad',
    'Front buckle to set the arm height',
    'Fits either arm',
  ],
  swatches: ['#62676c', '#4a4f54', '#2f9e7f'],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size or any medical condition. Ask a clinician how to position the arm and tension the strap.',
  tryOn: {
    title: 'See the sling on you',
    text: 'Stand facing the camera, bend the arm to be supported to about 90° and hold the forearm level across your body. The pouch and strap are built on your own arm and shoulders.',
    tips: [
      'Stand 1.2–2 m from the camera with your head, shoulders and waist in view.',
      'Bend your elbow to about 90° and hold the forearm level in front of your body, as the sling would hold it.',
      'Hold still for a second while it aligns. Turn slowly to see the strap over your shoulder.',
    ],
    stand: 'Line yourself up with the outline, forearm level across your body',
  },
  facingLabels: { front: 'Front view', side: 'Side view', back: 'Back view' },
  views: [
    { id: 'front', label: 'Front', text: 'Face the camera to see the pouch, your fingers coming out of it, and the strap crossing your chest to the buckle.' },
    { id: 'side', label: 'Side', text: 'Turn your supported side toward the camera to see the elbow in the closed corner of the pouch.' },
    { id: 'back', label: 'Back', text: 'Turn around to see the strap crossing your back from the elbow to the opposite shoulder. Back-view tracking is estimated.' },
  ],
  fitLabels: {
    width: ['Strap follows your body outline', 'Face the camera to fit your chest width'],
    depth: ['Chest depth fitted', 'Turn sideways once to fit the depth'],
  },
  sliders: [
    { key: 'y', label: 'Up / down', min: -0.08, max: 0.08, step: 0.005, unit: 'cm' },
    { key: 'x', label: 'Left / right', min: -0.06, max: 0.06, step: 0.005, unit: 'cm', screen: true },
    { key: 'scale', label: 'Size', min: 0.85, max: 1.2, step: 0.01, unit: '%' },
    { key: 'z', label: 'Depth', min: -0.05, max: 0.05, step: 0.005, unit: 'cm' },
  ],
  settingsLabels: { occlusion: 'Hands and arms pass in front', fitShape: 'Shape the strap to my body' },
  inspectorViews: [
    ['front', 'Front'],
    ['left', 'Left'],
    ['back', 'Back'],
    ['right', 'Right'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'arm-sling-pouch-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Stand 1.2–2 m from the camera so your head, shoulders and waist are visible.',
        'Bend the arm to be supported to about 90° and hold the forearm level across your body, elbow by your side.',
        'The app picks the bent arm automatically. To choose, open Display & tracking settings and pick an arm.',
        'If your arm hangs straight or points up, the sling hides until you bring the forearm back to level.',
        'If it sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Seeing the strap',
      items: [
        'The strap goes over the OPPOSITE shoulder, on the shoulder rather than across the neck, and buckles at the front.',
        'Turn around slowly to see it cross your back to the elbow end of the pouch.',
        'For an exact look, use the 3D viewer in the side panel.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position, size and depth are estimated from a single camera image; there is no depth sensor.',
        'The forearm inside the pouch and your other hand pass in front using estimated positions, so small clipping can occur.',
        'It does not measure you, choose a size, or check clinical fit.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
};
