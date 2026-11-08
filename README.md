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

## Thumb Wrist Brace (DaynoR)

Pick it with the switch in the header, or open `/?product=thumbWrist`. Reference photos are in
`public/thumb_wrist_brace/`. Fitting guides for this kind of brace put the distal edge just below the palm
crease (fingers free), the thumb through its own sleeve, and the straps closing around the wrist.

**There is no GLB.** The brace is generated procedurally on the wearer's own hand every tracking frame
(`src/ar/WristBrace.js`). Its pieces are the neoprene sleeve, the thumb sleeve, the stitched edge bindings,
the raised wrist strap with its rounded velcro tab, and the label. All the dimensions in
`src/model/wristBraceConfig.js` are ratios of the knuckle span `|MCP5-MCP17|` and the palm length
`|wrist-MCP9|`, so it scales to any hand.

| Step | File | What it does |
| --- | --- | --- |
| Inference | `hand.worker.js`, `HandTracker.js` | MediaPipe Hand Landmarker (2 hands, 21 joints each, metric world landmarks) + selfie segmenter for the person mask, in a worker |
| Placement | `HandTransform.js` | Same weighted perspective solve as the torso, then **depth-ray snapping**: each joint keeps its solved depth but moves onto the camera ray through its 2D landmark, so the brace sits on the hand to the pixel. Hand frame: wrist origin, +Y distal, +X radial, +Z dorsal; right hands use a mirrored basis |
| Handedness | `HandTransform.js` | The label sets the chirality. Finger curl (fingers always flex toward the palm) cross-checks it continuously. Measured: tasks-vision 1.2 labels the true hand on un-mirrored frames |
| Shape | `WristBrace.js` | One cross-section table drives every part. Palm sections come from the knuckle landmarks, forearm sections from the fitter. The thumb sleeve is swept along the tracked CMC → MCP → IP joints, so it follows the real thumb |
| Fit | `WristFitter.js` | At 4 levels up the forearm, the mask is scanned across the projected limb axis. The ellipse model `e² = a²(R·w)² + b²(D·w)²` is linear in (a², b²), so the back-of-hand views fit the width and one turn to the thumb side fits the thickness (recursive least squares + anatomical prior). The scan centres also give the wrist-centre offset and the **forearm direction**, so the sleeve bends with wrist flexion/deviation (max 50°) |
| Occlusion | `WristBrace.js` | Depth-only skin: forearm + palm, thumb and finger capsules for this hand and the other hand, so fingers curled over the palm or the other hand pass in front |

Robustness: the mask is used only while it agrees with the hand landmarks. An arm held in front of the body
merges with the torso in the mask; then the brace falls back to anatomical proportions and silhouette trimming
switches off. Measurements outside 0.72–1.4× the prior are rejected.

QA: `/?product=thumbWrist&source=/thumb_wrist_brace/WhatsApp%20Image%202026-11-07%20at%208.03.59%20PM%20(2).jpeg`
runs the pipeline on the product photo (a left hand, palm side). Result: left hand, palm view, and the thumb sleeve
on the thumb from CMC to past the MCP joint.

---

## Tennis Elbow Support (DaynoR)

Pick it in the header or open `/?product=tennisElbow`. Reference photos are in `public/tennis_elbow_support/`.
The box instructions say "wear 50 m.m. below Elbow"; the strap end passes through a plastic buckle, is pulled back
and locked on the velcro. The real product is a beige padded band with a raised pressure-pad pocket and a white
DaynoR label.

The strap is procedural (`src/ar/ElbowStrap.js`): padded band, stitched bindings, pressure pad, label, buckle and
folded-back tail. Its dimensions are ratios of the wearer's forearm length `Lf = |elbow-wrist|`
(`src/model/elbowSupportConfig.js`): centre 0.2·Lf below the elbow (≈5 cm), width 0.21·Lf (≈5.5 cm).

| Step | File | What it does |
| --- | --- | --- |
| Inference | `PoseTracker` / `pose.worker.js` | The existing body tracker, with a finer person mask (480 px instead of 320) because the forearm is narrow in the frame |
| Placement | `ArmTransform.js` | Same perspective solve as the torso, then depth-ray snapping of shoulder/elbow/wrist/hand points onto their 2D landmarks |
| Orientation | `ArmTransform.js` | **Lateral side from the elbow hinge**: `side · unit(upperArm × forearm)`. It is correct however the shoulder is rotated, so the pad sits over the extensor muscles. A nearly straight arm (< 25°) falls back to "away from the body" |
| Fit | `ElbowFitter.js` | Ellipse silhouette least squares at 3 strap levels, with the shape prior coupled both ways: the unseen axis follows the measured one. The measured silhouette centre corrects the elbow landmark's sideways error |
| Occlusion | `ElbowRenderer.js` | Depth-only forearm from the strap's own sections, plus mask-trimmed capsules for this upper arm and hand and for the other arm |

**Synthetic ground-truth test** (exact cylinder silhouettes in a matching mask, true forearm radius known, true axis
1 cm off the landmark):

| Case | Forearm length | Fitted radius (observed axis) | Axis offset recovered | Strap centre error |
| --- | --- | --- | --- | --- |
| Forearm out to the side, against background | 0.253 m (exact) | 4.48–4.90 cm vs 4.5 | 1.2 cm vs 1.0 | 1.9 px at 1280 px |
| Forearm raised beside the upper arm (one edge hidden) | exact | 4.88–5.06 cm vs 5.2 | n/a | 0 px |

The lateral direction was checked by hand against anatomy (forearm abducted with the humerus externally rotated:
the lateral side faces away from the camera, reported as "inner side"). The box photos crop the arms, so the body
tracker can't place an elbow on them; the app says so ("Show your elbow and forearm…").

---

## Universal Shoulder Immobilizer (DaynoR)

Pick it in the header or open `/?product=shoulderImmobilizer`. Reference photos are in `public/universal_shoulder_imoblizer/`:
the box front (how it is worn), the real product (grey fabric, green piping) and a box back from a related DaynoR product.
Its fitting notes (band around the lower chest, elbow at 90°, flip it for the other shoulder) match the
manufacturer and hospital guides consulted: body band around the torso, arm held against the body, forearm in a pouch,
strap over the shoulder.

It is a torso product, so it runs the **Taylor's brace pipeline unchanged** (TorsoTransform placement and
front/back, BodyShapeFitter body shape, calibration, latency compensation) through two hooks in `TryOnSession`
(`createRenderer`, `onPoseResult`), and adds the supported arm. Geometry (`src/ar/ImmobilizerModel.js`) is procedural
in the same reference-torso space as the Taylor GLB, so the measured body-shape factors apply directly:

- **Body band = convex hull.** A band pulled around a body takes the convex hull of what it wraps. Each band row is
  the hull of the fitted torso section (reference superellipses × measured factors) and, when the upper arm lies
  against the side, the arm's horizontal cross-section (cylinder ∩ plane = ellipse), offset by the band thickness.
  The band's height follows the real elbow (bottom 3.5 cm above it, clamped), as on the box photo.
- **Pouch** around the tracked forearm (closed and rounded behind the elbow, open at the wrist, green piping).
- **X straps** run from the band to the pouch, draped over whichever surface is in front (band hull, torso, pouch),
  and smoothed like a strap under tension.
- **Shoulder straps** follow the torso's side-view contour over each shoulder, with slider buckles.
- **Arm joints** are depth-ray snapped onto their 2D landmarks (keeping the torso solve's depth) before going into
  torso space. The occluders (other arm and hand, the supported hand, neck and head) use the same snapped joints.

Edge cases handled (`ImmobilizerTryOnSession.js`): which arm is supported (user choice, else the arm in the
sling pose, switching when the other arm goes into the sling); arm hanging, raised or not bent (the pouch hides,
with a specific hint); upper arm away from the body (the band wraps only the chest); arm briefly lost (held
0.5 s); the other hand in front of the pouch (occluded); back view (the pouch is hidden by the body). The sling-pose
check uses hysteresis (enter 60–130° flexion, stay 45–150°), so the pouch doesn't flicker.
The immobilizer is **not** trimmed to the body outline (it legitimately bridges gaps between arm and chest and behind
the elbow); the mask still drives the body-shape fit and trims the occluders.

**Synthetic end-to-end test** (drawn person + matching landmarks and mask through the real session loop):
left arm in the sling → left arm detected, 86° flexion, band wraps chest and upper arm, pouch and X straps on the
forearm; arm hanging → pouch hidden and "Bend your left elbow to about 90°…"; arm held out → band wraps only the chest
and "Bring your left upper arm against your side…"; right arm in the sling → auto-switch to the right, geometry
mirrored.

---

## Arm Sling Pouch (DaynoR)

Pick it in the header or open `/?product=armSling`. Reference photos are in `public/arm_sling_pouch/` (box front and back).
The real product is the grey pouch with green piping photographed in the immobilizer folder, next to its "ARM SLING
POUCH" pack. Fitting guides consulted ([3M Futuro](https://www.3m.com/3M/en_US/p/d/b00003224/),
[NHS SFH](https://www.sfh-tr.nhs.uk/media/5kcfcopq/pil202510-04-fps-how-to-fit-a-poly-sling.pdf),
[shoulderdoc](https://shoulderdoc.co.uk/pages/standard-sling-application)): elbow snug in the closed corner, forearm
about level, one strap from the elbow end across the back, over the **opposite** shoulder (on the shoulder, not the neck,
with a pad) and down to a buckle at the front.

It shares the immobilizer's pipeline (`ImmobilizerTryOnSession` is configurable: model, pose thresholds, band-wrap
requirement, hints). `src/ar/SlingModel.js`:

- **Pouch:** an open-topped, flat-bottomed U trough on the tracked forearm, with a closed elbow-end panel. Its walls are
  higher at the elbow than at the hand (the box's trapezoid), and it ends 60 % of the way to the knuckles (from the pose
  hand points, snapped at the wrist's depth), so the fingers come out. One piping loop runs along both top edges and
  round the hand opening.
- **Strap:** over the opposite shoulder, found by marching rays from inside the shoulder to the fitted torso surface
  in the side plane at the strap's x (it sits on the shoulder, not the neck). The chest and back runs are pushed onto
  the fitted torso surface, then smoothed (tension) and resampled. A comfort pad widens it over the shoulder, and a
  buckle sits on the chest run.
- **Occlusion:** the open pouch shows the arm inside it, so the forearm and upper arm are depth-only occluders (snapped
  joints), as are the other arm, the hand, neck and head, and the fitted torso.

Edge cases: arm hanging, raised or not level → the sling hides with a specific hint ("Lower your left hand so the
forearm is about level"…). Hysteresis is tight on exit (flexion ≤ 135°, incline ≤ ~46°), so a sweep through the level
pose doesn't latch. The sling stays drawn 0.6 s after leaving the pose so it doesn't blink. Arm state resets on every
start; either arm is detected automatically.

**Synthetic end-to-end test:** level left forearm → in the sling (95°), pouch and strap over the right shoulder; arm
hanging → hidden, "Bend your left elbow…"; forearm raised steeply → hidden, "Lower your left hand…"; right arm in the
sling → auto-switch, strap over the left shoulder. The immobilizer was re-run after the refactor (unchanged result).

---

## Lumbar & Sacral Support (DaynoR)

Pick it in the header or open `/?product=lumbarSacral`. Reference photos are in `public/lumber_sacral_support/`: box front and
back (rear panel with spring-steel stays, double-pull side straps) and the real product (dark charcoal striped elastic,
horizontal velcro strip, white label). The real product's colours are used. Fitting guides
([Guy's & St Thomas' NHS](https://guysandstthomas.nhs.uk/health-information/lumbar-sacral-corset),
[Drugs.com LSO](https://www.drugs.com/cg/lumbosacral-orthosis-ambulatory-care.html)): centred on the lower back,
bottom edge at the top of the buttocks so it covers the sacrum, velcro at the front, side straps pulled snug, and it
must not dig into the ribs or groin.

A pure torso product: `LumbarSession.js` is the **Taylor's brace session unchanged** (placement, front/back,
BodyShapeFitter, calibration, arm occlusion, silhouette trim), with the GLB replaced by `LumbarModel.js`. The
model is rebuilt on the measured body shape each pose result, and "Size" acts as girth:

- The belt is the fitted torso surface + elastic thickness. Its edges are placed by reference anatomy (hips =
  hip joints at −0.50; waist −0.33…−0.40; sacrum ≈ −0.42…−0.56; pubic bone ≈ −0.50 at the front). Back
  −0.29 → −0.575 (over the whole sacrum), front −0.335 → −0.515 (below the ribs, above the groin), blended smoothly
  around the body.
- A contoured rear panel (padded rounded rectangle) with four spring-steel stays as raised ridges in stitched
  channels; double-pull side straps (upper and lower on each side, converging toward the front, rounded pull tabs,
  teal stitching from the box art); the front velcro closure flap with the loop strip, centre seam and label; stitched
  edge bindings.

**Synthetic end-to-end test:** a drawn standing person through the real loop → tracking; width factors measured
from the mask ≈ 1.02–1.05 (the belt edges sit on the drawn outline); the hip joints fall just inside the front lower
edge. With the hips out of frame → "Step back so your hips are in view…".

---

## Meek Clavicle Brace (DaynoR)

Pick it in the header or open `/?product=clavicleBrace`. Reference photos are in `public/clavicle_belt/`: box front and back (worn,
seen from behind) and the real product (grey padded straps with green piping). It is a figure-of-8 brace: each wide
padded strap goes over the **front of the shoulder, under the armpit**, and the two loops meet on a padded back plate
between the shoulder blades, pulling the shoulders back
([BraceAbility](https://www.braceability.com/products/figure-8-clavicle-brace),
[Breg instructions](https://physiostore.ca/wp-content/uploads/pdf/Breg-Clavicle-Support-Instructions-The-Physio-Store.pdf)).

A pure torso product: `ClavicleTryOnSession` (in `LumbarSession.js`, which now holds the shared
`ProceduralTorsoSession`) runs the Taylor's brace session unchanged. `ClavicleModel.js`:

- Each loop is a smooth closed curve through anatomical way points (back plate → over the trapezius → front
  of the shoulder → anterior armpit fold → armpit → across the back). Their depth comes from the fitted torso,
  then the curve is pushed onto the torso surface **and over the shoulder joint and the top of the upper arm**
  (sphere + cylinder matching the arm occluders), smoothed like a strap under tension, and resampled.
- The strap lies flat on the surface: its orientation follows the true surface normal (superellipse gradient,
  the shoulder ball's normal where it wraps the joint), smoothed along the loop. It is wider and thicker over
  the shoulders, with green-piped edges and a mesh texture.
- A padded back plate with a buckle where the loops meet.
- Arms pass in front, so the straps disappear into the armpits as they really do.

**Synthetic end-to-end test:** front-facing person → tracking, straps over the front of both shoulders,
disappearing behind the arms into the armpits; the same person facing away (sides swapped, face behind the
shoulders) → "back" (yaw 180°), and the figure-of-8 crosses onto the back plate as on the box photo. Two
issues found and fixed during this: the front straps first ran *inside* the shoulder (the reference torso has
no shoulder ball), and they faced sideways (they were oriented from the torso axis instead of by the surface
normal).

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
