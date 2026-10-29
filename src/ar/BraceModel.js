// Loads the brace GLB once and hands out prepared clones.
// - Meshes named BRACE_MODEL.occluderPrefix* become depth-only body occluders.
// - Brace materials get an optional screen-space silhouette clip driven by the segmentation mask.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BRACE_MODEL } from '../model/braceConfig.js';

let gltfPromise = null;

export function loadBraceGLTF(onProgress) {
  if (!gltfPromise) {
    gltfPromise = new GLTFLoader()
      .loadAsync(BRACE_MODEL.url, (e) => {
        if (onProgress && e.total) onProgress(e.loaded / e.total);
      })
      .catch((err) => {
        gltfPromise = null;
        throw err;
      });
  } else if (onProgress) {
    gltfPromise.then(() => onProgress(1));
  }
  return gltfPromise;
}

export const occluderMaterial = () =>
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });

/**
 * Shared uniforms for the silhouette clip. uMask is a single-channel person mask in source-image
 * space (row 0 = top). The overlay canvas covers exactly the source frame, so screen UV == mask UV.
 */
export function createMaskUniforms() {
  return {
    uMask: { value: null },
    uMaskOn: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uDilate: { value: 0.012 },
  };
}

const MASK_GLSL = /* glsl */ `
uniform sampler2D uMask;
uniform float uMaskOn;
uniform vec2 uViewport;
uniform float uDilate;
float personMask() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  uv.y = 1.0 - uv.y;
  float m = texture2D(uMask, uv).r;
  vec2 d = vec2(uDilate, uDilate * uViewport.x / uViewport.y);
  m = max(m, texture2D(uMask, uv + vec2(d.x, 0.0)).r);
  m = max(m, texture2D(uMask, uv - vec2(d.x, 0.0)).r);
  m = max(m, texture2D(uMask, uv + vec2(0.0, d.y)).r);
  m = max(m, texture2D(uMask, uv - vec2(0.0, d.y)).r);
  m = max(m, texture2D(uMask, uv + d * 0.7).r);
  m = max(m, texture2D(uMask, uv - d * 0.7).r);
  m = max(m, texture2D(uMask, uv + vec2(d.x, -d.y) * 0.7).r);
  m = max(m, texture2D(uMask, uv + vec2(-d.x, d.y) * 0.7).r);
  return m;
}
`;

const FIT_N = BRACE_MODEL.fitLevels.length;
const FIT_GLSL = /* glsl */ `
uniform float uFitOn;
uniform float uFitY[${FIT_N}];
uniform vec4 uFit[${FIT_N}]; // width, front depth, back depth, lateral offset (m)
vec4 braceFit(float y) {
  vec4 id = vec4(1.0, 1.0, 1.0, 0.0);
  if (uFitOn < 0.5) return id;
  // Shoulders and straps follow the shoulder landmarks directly; the measured outline takes over
  // below the armpits (at armpit height the arms touch the body and the outline is unreliable).
  if (y >= -0.12) return id;
  if (y > uFitY[0]) return mix(id, uFit[0], (y + 0.12) / (uFitY[0] + 0.12));
  for (int i = 0; i < ${FIT_N - 1}; i++) {
    if (y <= uFitY[i] && y > uFitY[i + 1]) {
      return mix(uFit[i], uFit[i + 1], (uFitY[i] - y) / (uFitY[i] - uFitY[i + 1]));
    }
  }
  return uFit[${FIT_N - 1}];
}
`;

/**
 * Shader patches for AR materials:
 *  - fit:  reshape the mesh to the wearer's measured outline (per-height width / belly depth / offset)
 *  - clip: discard fragments outside the (dilated) person silhouette
 */
export function applyBraceShader(material, { maskUniforms = null, fitUniforms = null, clip = true, dilate = true, threshold = 0.35 } = {}) {
  const doClip = clip && maskUniforms;
  material.onBeforeCompile = (shader) => {
    if (fitUniforms) {
      Object.assign(shader.uniforms, fitUniforms);
      shader.vertexShader = FIT_GLSL + shader.vertexShader;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          {
            vec4 fn = braceFit(position.y);
            // inverse-transpose of the per-vertex scale keeps lighting correct after reshaping
            objectNormal = normalize(vec3(objectNormal.x / fn.x, objectNormal.y, objectNormal.z / (position.z >= 0.0 ? fn.y : fn.z)));
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec4 fp = braceFit(position.y);
            transformed.x = transformed.x * fp.x + fp.w;
            transformed.z *= transformed.z >= 0.0 ? fp.y : fp.z;
          }`,
        );
    }
    if (doClip) {
      Object.assign(shader.uniforms, maskUniforms);
      shader.fragmentShader = MASK_GLSL + shader.fragmentShader;
      const test = dilate ? 'personMask()' : 'texture2D(uMask, vec2(gl_FragCoord.x / uViewport.x, 1.0 - gl_FragCoord.y / uViewport.y)).r';
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `void main() {
  if (uMaskOn > 0.5 && ${test} < ${threshold.toFixed(2)}) discard;`,
      );
    }
  };
  material.customProgramCacheKey = () => `brace-${!!fitUniforms}-${!!doClip}-${dilate}-${threshold}`;
  material.needsUpdate = true;
}

/** Fragments outside the person silhouette are discarded (used by the arm occluders). */
export function applySilhouetteClip(material, uniforms, opts = {}) {
  applyBraceShader(material, { maskUniforms: uniforms, ...opts });
}

/**
 * Returns { root, braceMeshes, occluders } — a fresh clone of the brace, ready to add to a scene.
 * mode 'ar': occluders are depth-only; 'inspect': occluder is shown as a soft neutral dress form.
 */
export async function createBrace({ mode = 'ar', maskUniforms = null, fitUniforms = null, onProgress } = {}) {
  const gltf = await loadBraceGLTF(onProgress);
  const root = gltf.scene.clone(true);
  const braceMeshes = [];
  const occluders = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.startsWith(BRACE_MODEL.occluderPrefix)) {
      if (mode === 'ar') {
        o.material = occluderMaterial();
        // the body stand-in takes on the same measured shape as the brace
        if (fitUniforms) applyBraceShader(o.material, { fitUniforms, clip: false });
        o.renderOrder = -1;
      } else {
        o.material = new THREE.MeshStandardMaterial({ color: 0xc9b8aa, roughness: 0.85, transparent: true, opacity: 0.35, depthWrite: false });
        o.renderOrder = -1;
      }
      occluders.push(o);
      return;
    }
    o.material = o.material.clone();
    const tex = o.material.map;
    if (tex) {
      tex.anisotropy = 4;
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (mode === 'ar') applyBraceShader(o.material, { maskUniforms, fitUniforms });
    braceMeshes.push(o);
  });
  return { root, braceMeshes, occluders };
}

/** Geometry/textures are shared with the cached glTF (clone(true) shares them), so only the
 * per-clone materials are released here. */
export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => m?.dispose());
  });
}
