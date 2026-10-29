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
