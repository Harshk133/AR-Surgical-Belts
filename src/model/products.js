// Product catalogue for the try-on. Each product names its tracking pipeline ('torso', 'wrist', 'elbow');
// the UI is driven by the fields on these objects.
import { PRODUCT as TAYLOR } from './braceConfig.js';
import { WRIST_PRODUCT } from './wristBraceConfig.js';
import { ELBOW_PRODUCT } from './elbowSupportConfig.js';
import { IMMOBILIZER_PRODUCT } from './immobilizerConfig.js';
import { ARM_SLING_PRODUCT } from './armSlingConfig.js';
import { LUMBAR_PRODUCT } from './lumbarConfig.js';
import { CLAVICLE_PRODUCT } from './clavicleConfig.js';

export const PRODUCTS = [TAYLOR, WRIST_PRODUCT, ELBOW_PRODUCT, IMMOBILIZER_PRODUCT, ARM_SLING_PRODUCT, LUMBAR_PRODUCT, CLAVICLE_PRODUCT];
export const productById = (id) => PRODUCTS.find((p) => p.id === id) || PRODUCTS[0];

// What the shelf shows: a short label, and the render from `npm run thumbs:build`.
const SHORT = {
  taylor: 'Taylor',
  thumbWrist: 'Wrist',
  tennisElbow: 'Elbow',
  shoulderImmobilizer: 'Shoulder',
  armSling: 'Sling',
  lumbarSacral: 'Lumbar',
  clavicleBrace: 'Clavicle',
};
export const shortName = (p) => SHORT[p.id] || p.name;
export const thumbOf = (p) => `/products/${p.id}.webp`;
