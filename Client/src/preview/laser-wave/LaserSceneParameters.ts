import * as THREE from 'three/webgpu';

import type { SceneConfig } from '../../model/SceneConfig';
import { isVector3, vectorComponents } from '../../model/RendererValidation';

/**
 * Liest und normalisiert gemeinsam verwendete Parameter der Laser-Szene.
 */
export function propertiesFor(scene: SceneConfig, objectType: string) {
  const value = scene.objects.find((object) => object.objectType === objectType)?.properties;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function positiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function nonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export function positiveInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function vectorValue(value: unknown, fallback: THREE.Vector3) {
  return isVector3(value)
    ? new THREE.Vector3(...vectorComponents(value))
    : fallback;
}

export function planeBasis(normal: THREE.Vector3) {
  const helper = Math.abs(normal.y) < 0.999
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const right = helper.clone().cross(normal).normalize();
  return {
    right,
    up: normal.clone().cross(right).normalize(),
  };
}

export function laserColorForWavelengthNm(wavelengthNm: number) {
  if (wavelengthNm < 500) return new THREE.Vector3(0.25, 0.45, 1);
  if (wavelengthNm < 580) return new THREE.Vector3(0.1, 1, 0.2);
  if (wavelengthNm < 620) return new THREE.Vector3(1, 0.9, 0.1);
  return new THREE.Vector3(1, 0.1, 0.1);
}
