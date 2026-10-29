# Taylor's Brace — Live AR Virtual Try-On

A web app that previews the **MAXheal Taylor's Brace** (thoraco-lumbar orthosis) on the shopper's own torso
through the webcam or phone camera. Body tracking, segmentation and rendering run entirely in the browser;
no video leaves the device.

> **Visual shopping preview only.** The app estimates position, size and orientation from a single RGB
> camera. It does not measure the body, pick a size, or assess clinical fit or any medical condition.

---

## Quick start

```bash
npm install            # also copies the MediaPipe WASM runtime into public/mediapipe/wasm
npm run setup:assets   # downloads the pose models into public/models (only needed once)
npm run dev            # http://localhost:5173
```

- Camera access needs `https://` or `http://localhost`. To test on a phone, serve over HTTPS
  (for example with a tunnel, or `vite --https` with a certificate) and open the LAN/tunnel URL.
- `npm run build && npm run preview` serves the production build.

### Rebuilding the 3D brace

```bash
npm run model:build               # Blender headless: .blend + GLB + validation renders
npm run model:build -- --no-render
```

This needs Blender 4.2+ (built and tested with **Blender 5.2.3**). The script finds it under
`C:/Program Files/Blender Foundation/*` on Windows or in `/Applications` on macOS, or you can set `BLENDER=/path/to/blender`.

### QA without a camera

`http://localhost:5173/?source=/samples/worn-front.jpeg` runs the full pipeline (tracker, renderer,
capture) on an image or video file (`.mp4/.webm`) instead of the camera. The pose detector needs a
visible head and shoulders, so a person filmed from 1.5–2 m works best.

---

## What's in the repo

| Path | Contents |
| --- | --- |
| `reference/` | The four supplied product photos, renamed by what they show |
| `blender/build_brace.py` | Procedural, repeatable Blender build of the brace (geometry, UVs, textures, materials, validation scene, export) |
| `blender/taylors_brace.blend` | Editable Blender source: `TaylorsBrace` (22 separate components), `ValidationBody` mannequin, `Occluder`, six validation cameras |
| `blender/renders/` | Front, back, left, right, ¾ and ¾-back validation renders |
| `blender/textures/` | Generated fabric textures (embedded in the GLB) |
| `public/models/taylors_brace.glb` | Web asset: about 38k faces, 1.8 MB, includes the depth-only `BodyOccluder` |
| `src/ar/` | Camera, tracking, rendering, occlusion, capture (framework-free) |
| `src/components/` | React UI |
| `src/model/braceConfig.js` | Product data and the model's reference-body contract |

### Architecture

```
CameraController ──► video ──► TryOnSession (rAF loop, outside React)
                                 │  submit frame (ImageBitmap, 640 px)        ▲ throttled snapshot
                                 ▼                                             │ (useSyncExternalStore)
                         pose.worker.js  (MediaPipe Pose Landmarker + mask)   React UI
                                 │  landmarks, world landmarks, mask
                                 ▼
                         TorsoTransform ─► BodyShapeFitter (mask → per-height shape)
                                 │                        │
                                 ▼                        ▼
                         ArRenderer (three.js, latency-compensated pose, shape uniforms)
                                                ├─ BraceModel (GLB, silhouette-clip materials)
                                                ├─ BodyOccluder (depth only, from the GLB)
                                                └─ OcclusionLayer (arm/neck/head depth proxies)
```

- **Camera lifecycle** (`CameraController`) knows nothing about tracking or rendering.
- **Tracking** (`PoseTracker`, `pose.worker.js`, `TorsoTransform`) knows nothing about the product.
- **Product** (`BraceModel`, `braceConfig.js`): replace the GLB and the reference dimensions to try on
  a different garment. Nothing in tracking changes.
- Per-frame work never triggers React renders. The UI receives a snapshot at most about 7 times a second.

---

## The 3D model

### Reading the reference photos

| Photo | View | What it establishes |
| --- | --- | --- |
| `01-box-worn-front` | Worn, front | Open chest; padded shoulder straps over the shoulders and down the front; wide abdominal belt closing at the front with a lighter velcro tab whose rounded end points toward the centre |
| `02-box-worn-back` | Worn, back | Tall rear panel from below C7 to the sacrum, with two vertical stays; padded scapular band with **two centre buckles**; webbing straps running **diagonally down and out** (inverted V); horizontal lumbar bands; shoulder straps looping under the arms to the band |
| `03-product-flat-inner-elastic` | Flat, inner/elastic side | Navy/gray **striped elastic** belt with teal lines; upper overlay strap with velcro; side velcro tabs |
| `04-product-flat-outer-rear` | Flat, outer rear | Narrow thoracic section stepping out to a wider lumbar section; dark stays; **triangular V-buckle** on a webbing tab; padded band with a **waisted centre** and teal piping |

Photos 1 and 2 (box art) fix how the brace is worn and routed. Photos 3 and 4 (the actual item) fix the
materials and details. Where they differ (the box shows a plain dark belt, the real product has striped
elastic), the real product wins. Elements that could not be confirmed from the photos, such as the
folded lumbar pad visible only in photo 4, were left out rather than guessed.

### How it is built

The model is built procedurally on a **reference torso**: superelliptic cross-sections lofted along the
height, parameterised by arc length. Panels, belts and bands are thick patches that follow that surface,
with padded edges. Straps are swept along splines with a flat, pillowed profile. Buckles are extruded profiles.
Components are separate objects (`RearPanel`, `Stay_L/R`, `ScapularBand`, `ShoulderStrap_L/R`,
`DiagonalStrap_L/R`, `CentreBuckle_L/R`, `VBuckle`, `AbdominalBelt`, `UpperTorsoBelt`,
`FrontClosureTab`, `SideStrap_L/R`, lumbar bands, piping…) and can be adjusted individually.

Colours were sampled from the product photos and tuned against them. The validation renders in
`blender/renders/` are the comparison set.

**Model contract** (see `braceConfig.js`): origin at the midpoint of the shoulder **joints**; `+X` is
the wearer's left, `+Y` is up, `+Z` is the wearer's front. Reference body: shoulder-joint width 0.36 m,
shoulder-to-hip 0.50 m. Meshes named `BodyOccluder*` are drawn to the depth buffer only.

---

## Tracking and alignment algorithm

1. **Pose inference (worker).** MediaPipe Pose Landmarker (VIDEO mode) runs in a module Web Worker on a
   640-px `ImageBitmap`, with at most one frame in flight. It returns normalised image landmarks, metric
   **world** landmarks and an optional person mask. Rendering and the UI keep running at display rate
   while inference runs at its own rate.
   - *Self-healing:* if the GPU delegate returns empty segmentation masks (observed on this
     development machine) the worker re-creates the landmarker on CPU with the lite model. If the full
     model's median time exceeds 75 ms it drops to the lite model.
   - *Several people in view:* up to 2 poses are detected. The worker keeps following the same person
     (nearest to their last position), or else the one closest to the camera, and sends **only that
     person's own segmentation mask**. Someone standing or sitting next to the user can never merge
     into their outline.
2. **Filtering.** One Euro filters on the image and world landmarks remove jitter at rest without
   adding lag during fast movement.
3. **Orientation** comes from the world landmarks: X = right→left shoulder line (blended 25 % with the
   hip line), Y = hips→shoulders, orthogonalised; Z = X × Y.
4. **Front/back.** The facing comes from the 3D geometry: shoulder ordering plus whether the nose is in
   front of or behind the shoulder line. A jump of more than 120° is accepted only if it persists for 6 results,
   which rejects one-frame label flips.
   *Measured:* with the user's back to the camera, face-landmark visibility still read about 0.99, so
   visibility is deliberately **not** used as a cue.
5. **Translation (perspective solve).** We find `t` so that `world_i + t` projects onto the image landmarks
   under a pinhole camera (default 63° horizontal FOV, adjustable in settings). With rotation known this is a
   **linear least-squares** problem (two equations per landmark, weighted by visibility, with hips
   down-weighted when out of frame). The world landmarks and `t` share one metric scale, so the projected
   size stays correct even when MediaPipe misjudges absolute body size. The model is never "scaled by
   horizontal movement".
6. **Scale that is consistent at every distance.** The brace's base size comes from the **current**
   frame's world shoulder width, lightly smoothed. Calibration locks only the body *proportions*
   (torso length / shoulder width). The reason, measured live: MediaPipe's metric scale estimate drifted
   by about 15 % between 0.9 m and 1.2 m. The depth solve (step 5) uses the current scale, so the brace
   must use the same one; otherwise it would shrink or grow relative to the body as the user walks. With
   matching scales the projected size is `f * size / depth` for body and brace alike, so **stepping
   back makes the belt smaller exactly as the body gets smaller**. This also holds with an unknown
   camera FOV: a wrong focal length rescales size and depth together and cancels out.
7. **Body-shape fitting (slim to large builds).** See the section below. The brace is reshaped per
   height to the wearer's measured outline.
8. **Latency compensation.** Each pose describes a frame captured `now - ts` ago (inference time plus
   transfer). The renderer extrapolates the torso position by that age using the tracked velocity
   (capped at 120 ms, with a dead-band when standing still so jitter is never amplified). Slow and fast
   devices therefore show the belt on the body in the *current* video frame, not where it was.
9. **Smoothing and loss handling.** Position goes through a One Euro filter, rotation through an
   adaptive slerp. The renderer eases between pose updates (time constant about 30 ms). When the person
   is lost, the last pose is **held for 0.45 s**, then the overlay fades out. On re-acquisition after
   more than 0.8 s the filters reset and the brace fades in at the new pose. It never sweeps across the
   screen from a stale position.
10. **Calibration flow.** A torso guide is shown. The app waits for confident shoulders and hips, a
   sensible distance and low motion for 1.2 s, then locks proportions. The body-shape fit converges
   quickly during this step while the brace is hidden, so it appears already shaped. After 5 s it accepts
   shoulders-only framing (close laptop cameras). The user can **Skip**, fine-tune with sliders
   (up/down, left/right, size, tilt, turn, depth; session-only), or **Reset** to re-align.
11. **Mirroring.** Overlay and video are rendered in true camera space. The stage containing both is
   mirrored together with CSS for user-facing cameras, so landmarks, 3D overlay and screenshot always
   agree. Sliders are converted so "right" means screen-right in both modes.

### Body-shape fitting (`src/ar/BodyShapeFitter.js`)

The aim is a belt that sits **on** the body for any build: snug on a slim person, following the
belly of a larger person, and not a uniformly scaled shell.

1. **Where to measure.** Eight levels from the lower ribs to the hips (`fitLevels`). Each level is a
   point on the torso axis, projected with the *same* camera model and the *same frame's* unfiltered
   pose used for placement, so the measurement and the rendering share one geometry.
2. **Measuring the outline.** The person mask is sampled along a line perpendicular to the projected
   spine (valid at any yaw or lean) on 3 nearby scanlines. The contiguous body run around the spine
   point gives both edges with sub-pixel interpolation. This is robust to where the anchor lands inside
   the body; an earlier one-sided scan doubled the width in three-quarter views and was replaced.
   - Dips shorter than 3 cm inside the body are bridged. Dark clothing gets low mask confidence; this was
     seen live on a black tank top.
   - An edge walk that reaches an **arm capsule** (projected shoulder-elbow-wrist) or the frame border
     marks that side unseen, so arms hanging against the hips can't inflate the width. With one side
     unseen, the other side's distance from the spine is used (symmetry, reduced weight).
   - A **plausibility gate** rejects measurements outside 0.75-1.75x the landmark-based size (merged
     with a chair, a bag, another person). When facing the camera, a run whose centre is far off the
     spine falls back to the nearer edge.
3. **Pixels to metres** at each level: `half-width = px * depth / focal`, with the depth from the solve.
   Distance therefore changes the pixel size but not the fitted metric shape.
4. **Ellipse model across views.** The torso cross-section at each level is an ellipse (half-width
   *a*, half-depth *b*). Its silhouette half-extent at body yaw t is `e = sqrt(a^2 cos^2 t + b^2 sin^2 t)`.
   Facing the camera measures **a**; turning sideways measures **b**, the belly/waist depth. The app
   asks once: *"Turn sideways for a moment so the belt can fit your waist and tummy"*. Until depth is
   seen, it is assumed to scale with width.
5. **Temporal robustness.** Exponential smoothing (fast while calibrating, slow afterwards). A single
   frame that disagrees by more than 30 % moves the estimate only slightly. Levels with no valid
   measurement borrow from their neighbours, and a [1 2 1] filter across levels keeps the belt edge a
   smooth curve.
6. **Reshaping in the vertex shader.** Per-level factors (width, front depth, back depth, lateral
   offset) relative to the reference torso are uploaded as uniforms. Every brace mesh **and** the
   depth-only body occluder are reshaped per vertex by height, with normals corrected by the
   inverse-transpose. Extra depth goes 75 % to the front (belly) and 25 % to the back. Shoulders and
   straps above the armpits stay driven by the shoulder landmarks; the measured shape fades in below.
   The work runs on the GPU and costs only a few microseconds per level on the CPU, independent of the
   device.

The Body fit panel shows progress ("Width shaped to your outline", "Waist and tummy depth fitted").
"Shape the brace to my body" in settings turns it off.

### Occlusion (approximate, by design)

- **Body occluder:** a depth-only torso mesh shipped in the GLB. It hides the rear panel when you face the
  camera and the front closure when you face away.
- **Arms, neck, head:** depth-only cylinders and spheres placed at the estimated 3D joints from the same
  solve. An arm hanging at your side hides the strap behind it. These proxies are trimmed to the person
  mask, so an over-sized proxy never cuts the brace where there is no person.
- **Silhouette fit:** brace fragments outside the dilated person mask are discarded, which stops edges
  from floating off the body. This can be toggled in settings.

None of this is measured depth. Arm depth comes from landmark estimates and can be wrong (an arm judged
in front of the chest when it is beside it, for example).

---

## Testing performed

All of this was done on the development machine (Windows 11, Chrome, built-in 1280×720 webcam).

| Check | Result |
| --- | --- |
| Camera permission + live feed | ✅ |
| GLB loads (progress shown) | ✅ |
| Brace follows a real person's torso | ✅ Front view: straps over the shoulders, belt at the waist, front closure visible |
| Belt width fitted to the real waist | ✅ Live, slim user: the belt edges sit on the waist outline; arm-contaminated sides correctly rejected |
| Stable fit while standing still | ✅ Waist factor settled at 1.01 ± 0.03 over 10 s at 0.9 m |
| Size consistent with distance | ✅ Found and fixed a ~15 % drift between 0.9 m and 1.2 m (see Scale) |
| Another person in view | ✅ Found a seated person merging into the outline; fixed with per-person masks |
| Profile depth | ⚠️ Measured a depth-to-width ratio of about 0.8 for a slim user (plausible); visual profile check after the final fixes not yet repeated |
| Orientation follows torso rotation | ✅ Recorded yaw during a slow full turn: −74° → −121° → **back ±175° held steadily for 8 s** → side → front |
| Side view | ✅ Strap loop under the arm, panel depth and belt edge visible |
| Tracking loss / re-acquisition | ✅ One loss at the frame edge recovered with a fade, no jump; re-acquired a second person who stepped in |
| Manual correction | ✅ Sliders, Clear adjustments, Re-align |
| Screenshot includes the 3D overlay | ✅ PNG at source resolution, overlay pixels verified against the raw frame |
| Permission denied | ✅ Recovery card (simulated `NotAllowedError`) |
| Tracker failure | ✅ Falls back to manual placement mode with a banner |
| Mobile layout (390 px) | ✅ Full-height viewport, bottom toolbar, panel below (layout check only, no phone hardware test) |
| Production build | ✅ The bundled module worker and local WASM initialise |

**Measured performance (this machine):**

| Setup | Render rate | Pose rate | Inference time |
| --- | --- | --- | --- |
| Inference on main thread (first version) | 7–8 fps | 7–8 fps | 91–96 ms |
| Worker (current) | 48–58 fps | 10–14 fps | 57–78 ms (CPU/lite after auto-fallback) |

Turn on **Show performance stats** in settings to see live numbers on other devices.

**Not yet tested:** a real phone (iOS Safari / Android Chrome), rear-camera use, and a
`NotFound`/`NotReadable` camera on real hardware (those paths are implemented and share the same UI as
the tested denial path).

---

## Known limitations

- **Back view is estimated.** It works when turning slowly. Fast spins, or a back view without visible
  shoulders, can briefly show the wrong side until the persistence check settles (up to about 0.5 s).
- **Depth and occlusion are approximate.** There is no depth sensor. Body shape comes from the 2D outline
  plus an ellipse model, so it describes width and depth at each height, not asymmetries such as one
  hip higher.
- **Clothing counts as body.** Loose shirts, shorts or a jacket widen the outline and the belt fits the
  clothes. Fitted clothing gives the most accurate fit.
- **Arms against the sides** hide that edge. The app then measures the other side (assuming symmetry)
  or keeps the previous estimate. Holding arms slightly away from the body during calibration helps.
- **Depth needs one side view.** Until the user turns sideways once, belly depth is assumed to scale
  with waist width.
- **Sizing is not measured.** The brace is scaled to fit your detected proportions. It says nothing about
  which product size you need.
- **Field of view is assumed** (63°). Very wide or narrow lenses shift the perspective; adjust it in settings.
- **Fabric is rigid.** The brace does not deform when you bend or twist strongly, and straps don't drape.
- **Slow hardware** gives slower pose updates. The overlay stays smooth but lags fast movement.
- One person at a time: the nearest one, and once followed, that person stays selected while they remain
  in view.

## Suggested next steps

1. Skinned brace: bind the straps and belt to a simple spine/shoulder rig driven by the landmarks, so it
   bends with the body.
2. Front/back depth split: use the profile run's centre offset to separate belly depth from back depth,
   instead of the fixed 75/25 split.
3. A dedicated person-segmentation model (selfie segmenter, multiclass hair/body/clothes) to separate
   loose clothing from the body.
4. Use a dedicated face detector (BlazeFace) as an independent front/back cue for fast turns.
5. A per-device latency and FOV profile (auto-estimated) to tune prediction and perspective.
6. Size guidance only from clinician-validated measurements; never inferred from the camera alone.
7. Compress the GLB (Meshopt/Draco, KTX2 textures) and test on low-end Android.
