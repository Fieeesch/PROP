import * as THREE from 'three/webgpu';

import type { SceneConfig } from '../../model/SceneConfig';
import { isVector3, vectorComponents } from '../../model/RendererValidation';
import { propertiesFor } from './LaserSceneParameters';

const defaultWallNormal = new THREE.Vector3(0, 0, -1);

/**
 * Bestimmt die gemeinsame optische Achse und die Normalen von Wand, Linse und Sensor.
 */
export function wallNormalForScene(scene: SceneConfig) {
  const value = propertiesFor(scene, 'DiffuseWall')?.normal;
  if (!isVector3(value)) return defaultWallNormal.clone();

  const normal = new THREE.Vector3(...vectorComponents(value));
  return normal.lengthSq() > 1e-12
    ? normal.normalize()
    : defaultWallNormal.clone();
}

export function laserDirectionForScene(scene: SceneConfig) {
  return wallNormalForScene(scene).negate();
}

export function lensNormalForScene(scene: SceneConfig) {
  return wallNormalForScene(scene);
}

export function sensorNormalForScene(scene: SceneConfig) {
  return wallNormalForScene(scene).negate();
}
