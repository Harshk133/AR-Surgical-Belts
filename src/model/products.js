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
