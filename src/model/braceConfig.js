// Product-specific configuration. The tracking system only depends on the reference body
// dimensions and the occluder naming convention, so a different garment can be dropped in by
// exporting a GLB built on the same reference torso (see blender/build_brace.py) and editing this file.

export const BRACE_MODEL = {
  url: `${import.meta.env.BASE_URL}models/taylors_brace.glb`,
  // Body the GLB was modelled on (metres). Origin = midpoint of the shoulder joints,
  // +X = wearer's left, +Y = up, +Z = wearer's front.
  refShoulderWidth: 0.36,
  refTorsoLength: 0.5,
  // Meshes whose name starts with this are written to depth only (they stand in for the body).
  occluderPrefix: 'BodyOccluder',
  // Reference torso the brace was built on (same table as TORSO_KEYS in blender/build_brace.py).
  // [y (m, up from shoulder-joint line), half-width, front depth, back depth, centre offset toward back]
  refTorso: [
    [0.14, 0.06, 0.055, 0.05, 0.01],
    [0.08, 0.08, 0.062, 0.058, 0.012],
    [0.05, 0.125, 0.075, 0.072, 0.012],
    [0.02, 0.158, 0.088, 0.082, 0.01],
    [-0.04, 0.166, 0.105, 0.09, 0.006],
    [-0.12, 0.16, 0.118, 0.092, 0.0],
    [-0.22, 0.15, 0.114, 0.088, 0.0],
    [-0.32, 0.138, 0.102, 0.08, 0.004],
    [-0.4, 0.134, 0.1, 0.08, 0.008],
    [-0.48, 0.15, 0.1, 0.092, 0.01],
    [-0.56, 0.162, 0.098, 0.104, 0.012],
    [-0.64, 0.165, 0.095, 0.106, 0.012],
  ],
  // Heights at which the wearer's real outline is measured and the brace is reshaped.
  // Lower ribs down to the hips; the abdominal belt spans -0.33 .. -0.555.
  fitLevels: [-0.22, -0.28, -0.34, -0.4, -0.46, -0.51, -0.56, -0.61],
};

export const PRODUCT = {
  id: 'taylor',
  kind: 'torso',
  swatches: ['#6e7b86', '#47525e', '#2b3549', '#3a8580'],
  tryOn: {
    title: 'See the brace on you',
    text: "Use your camera to preview the Taylor's Brace on your own torso. Turn to see the sides, and turn around for the back.",
    tips: [
      'Stand 1.5–2 m from the camera with your shoulders and waist in view.',
      'Wear fitted, plain clothing in even, front-facing light.',
      'Hold still for a second while the brace aligns.',
    ],
    stand: 'Line yourself up with the outline',
  },
  facingLabels: { front: 'Front view', side: 'Side view', back: 'Back view' },
  views: [
    { id: 'front', label: 'Front', text: 'Face the camera to see the shoulder straps and the front belt closure.' },
    { id: 'side', label: 'Side', text: 'Turn slowly to your left or right to see the strap routing under the arm and the brace thickness.' },
    { id: 'back', label: 'Back', text: 'Turn around to preview the rear panel and diagonal straps. Back-view tracking is estimated and less stable: turn slowly, and use the 3D viewer below for a precise look.' },
  ],
  fitLabels: {
    width: ['Width shaped to your outline', 'Face the camera to fit the width'],
    depth: ['Waist and tummy depth fitted', 'Turn sideways once to fit the depth'],
  },
  sliders: [
    { key: 'y', label: 'Up / down', min: -0.15, max: 0.15, step: 0.005, unit: 'cm' },
    { key: 'x', label: 'Left / right', min: -0.12, max: 0.12, step: 0.005, unit: 'cm', screen: true },
    { key: 'scale', label: 'Size', min: 0.8, max: 1.25, step: 0.01, unit: '%' },
    { key: 'rollDeg', label: 'Tilt', min: -20, max: 20, step: 1, unit: 'deg', screen: true },
    { key: 'yawDeg', label: 'Turn', min: -30, max: 30, step: 1, unit: 'deg', screen: true },
    { key: 'z', label: 'Depth', min: -0.06, max: 0.06, step: 0.005, unit: 'cm' },
  ],
  settingsLabels: { occlusion: 'Arms pass in front of the brace', fitShape: 'Shape the brace to my body' },
  inspectorViews: [
    ['front', 'Front'],
    ['left', 'Left'],
    ['back', 'Back'],
    ['right', 'Right'],
    ['threeQuarter', '¾'],
  ],
  captureName: 'taylors-brace-preview',
  help: [
    {
      title: 'Getting a good alignment',
      items: [
        'Stand 1.5–2 m from the camera so your head, shoulders and waist are visible.',
        'Face the camera with arms relaxed slightly away from your sides while it aligns.',
        'Use even, front-facing light; avoid a bright window behind you.',
        'Fitted, plain clothing tracks better than loose or patterned clothes.',
        'If the brace sits a little off, use Adjust alignment in the side panel, or press Reset to re-align.',
      ],
    },
    {
      title: 'Seeing the sides and back',
      items: [
        "Turn slowly. The brace follows your torso's estimated rotation.",
        'When your face is hidden, the app infers that you are facing away. This is an estimate and can lag or flicker; turning slowly helps.',
        'For an exact look at the rear panel and straps, use the 3D viewer in the side panel.',
      ],
    },
    {
      title: "What this preview can and can't do",
      items: [
        'Position, size and depth are estimated from a single camera image; there is no true depth sensor.',
        'Arms and the body hide parts of the brace using approximations, so small clipping or floating edges can occur.',
        'It does not measure you, choose a size, or check clinical fit. A clinician or orthotist should fit the brace.',
        'Video is processed in your browser and is never uploaded.',
      ],
    },
  ],
  name: "Taylor's Brace",
  brand: 'MAXheal Orthotics',
  tagline: 'Thoraco-lumbar support brace',
  description:
    'A tall, semi-rigid rear support panel with twin stays, padded shoulder straps that loop under the arms to a padded scapular band, diagonal webbing straps, and a wide striped elastic abdominal belt that closes at the front with velcro.',
  features: [
    'Tall rear panel with two vertical stays',
    'Padded shoulder straps with axillary loops',
    'Scapular band with centre buckles and diagonal straps',
    'Striped elastic abdominal belt, front velcro closure',
    'Upper overlay strap and side adjustment tabs',
  ],
  disclaimer:
    'This try-on is a visual shopping preview only. It cannot assess fit, size, posture or any medical condition. Ask a clinician or orthotist to select and fit a brace.',
};
