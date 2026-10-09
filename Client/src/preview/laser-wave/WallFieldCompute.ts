import * as THREE from 'three/webgpu';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import {
  Fn,
  attributeArray,
  float,
  instanceIndex,
  textureStore,
  uniform,
  uvec2,
  vec3,
  vec4,
} from 'three/tsl';

import type { SceneConfig } from '../../model/SceneConfig';
import { createCppDiffuseReflectanceField } from './CppDiffuseWall';
import { releaseStorageBuffer } from './LaserGpuResources';
import { laserSamplingDimensions } from './LaserSamplingDimensions';
import {
  laserColorForWavelengthNm,
  nonNegativeNumber,
  planeBasis,
  positiveNumber,
  propertiesFor,
  vectorValue,
} from './LaserSceneParameters';
import { laserDirectionForScene, wallNormalForScene } from './OpticalAxis';

export interface WallFieldCompute {
  readonly field: StorageBufferNode<'vec2'>;
  readonly texture: THREE.StorageTexture;
  readonly width: number;
  readonly height: number;
  readonly pixelSizeXmm: number;
  readonly pixelSizeYmm: number;
  run(renderer: THREE.WebGPURenderer): Promise<void>;
  releaseWorkingResources(renderer: THREE.WebGPURenderer): void;
  dispose(renderer: THREE.WebGPURenderer): void;
}

/**
 * Erzeugt das komplexe Laserfeld auf der rauen Wand und seine Vorschautextur.
 */
export function createWallFieldCompute(scene: SceneConfig): WallFieldCompute {
  const settings = propertiesFor(scene, 'LaserSimulationSettings');
  const laser = propertiesFor(scene, 'Laser');
  const wall = propertiesFor(scene, 'DiffuseWall');
  const dimensions = laserSamplingDimensions(scene);
  const width = dimensions.wallWidth;
  const height = dimensions.wallHeight;
  const sampleCount = width * height;
  const pixelSizeXmm = dimensions.wallPixelSizeXmm;
  const pixelSizeYmm = dimensions.wallPixelSizeYmm;
  const correlationLengthMm = Math.max(
    pixelSizeXmm,
    pixelSizeYmm,
    positiveNumber(wall?.correlationLengthMm, 0.04),
  );
  const baseSeed = boundedSeed(settings?.baseSeed, 42069);
  const radiusMm = positiveNumber(laser?.radiusMm, 1);
  const wavelengthNm = positiveNumber(laser?.wavelengthNm, 650);
  const amplitudeVm = nonNegativeNumber(laser?.amplitudeVm, 500);
  const laserOn = laser?.on !== false;
  const albedo = nonNegativeNumber(wall?.albedo, 1);
  const laserCenter = vectorValue(laser?.center, new THREE.Vector3(128, 128, 0));
  const laserDirection = laserDirectionForScene(scene);
  const wallCenter = vectorValue(wall?.center, new THREE.Vector3(128, 128, 256));
  const wallNormal = wallNormalForScene(scene);
  const { right: wallRight, up: wallUp } = planeBasis(wallNormal);

  const wallField = attributeArray(sampleCount, 'vec2');
  wallField.setName('laserWallField');
  const diffuseReflectance = attributeArray(
    createCppDiffuseReflectanceField(
      width,
      height,
      pixelSizeXmm,
      pixelSizeYmm,
      correlationLengthMm,
      baseSeed,
    ),
    'vec2',
  );
  diffuseReflectance.setName('laserDiffuseReflectance');

  const outputTexture = new THREE.StorageTexture(width, height);
  outputTexture.name = 'laser-wall-field-intensity';
  outputTexture.colorSpace = THREE.LinearSRGBColorSpace;
  outputTexture.generateMipmaps = false;
  outputTexture.mipmapsAutoUpdate = false;

  const radiusUniform = uniform(radiusMm);
  const amplitudeUniform = uniform(laserOn ? amplitudeVm : 0);
  const albedoUniform = uniform(albedo);
  const colorUniform = uniform(laserColorForWavelengthNm(wavelengthNm));
  const laserCenterUniform = uniform(laserCenter);
  const laserDirectionUniform = uniform(laserDirection);
  const wallCenterUniform = uniform(wallCenter);
  const wallRightUniform = uniform(wallRight);
  const wallUpUniform = uniform(wallUp);

  const computeNodes: ComputeNode[] = [];
  computeNodes.push(Fn(() => {
    const pixelX = instanceIndex.mod(width);
    const pixelY = instanceIndex.div(width);
    const reflectance = diffuseReflectance.element(instanceIndex);

    const offsetX = float(pixelX)
      .sub((width - 1) * 0.5)
      .mul(pixelSizeXmm);
    const offsetY = float(pixelY)
      .sub((height - 1) * 0.5)
      .mul(pixelSizeYmm);
    const samplePosition = vec3(wallCenterUniform)
      .add(wallRightUniform.mul(offsetX))
      .add(wallUpUniform.mul(offsetY));
    const relative = samplePosition.sub(laserCenterUniform);
    const distanceAlongBeam = relative.dot(laserDirectionUniform);
    const radial = relative.sub(laserDirectionUniform.mul(distanceAlongBeam));
    const beamAmplitude = radial.dot(radial)
      .negate()
      .div(radiusUniform.mul(radiusUniform).max(1e-12))
      .exp()
      .mul(amplitudeUniform)
      .mul(albedoUniform.sqrt())
      .mul(distanceAlongBeam.greaterThan(0).select(1, 0));

    wallField.element(instanceIndex).assign(reflectance.mul(beamAmplitude));
  })().compute(sampleCount, [256]));

  const visualizeWallField = Fn(({ storageTexture }) => {
    const pixelX = instanceIndex.mod(width);
    const pixelY = instanceIndex.div(width);
    const field = wallField.element(instanceIndex);
    const referencePower = amplitudeUniform.mul(amplitudeUniform)
      .mul(albedoUniform)
      .max(1e-12);
    const displayValue = field.dot(field)
      .div(referencePower)
      .clamp(0, 1)
      .sqrt();

    textureStore(
      storageTexture,
      uvec2(pixelX, pixelY),
      vec4(colorUniform.mul(displayValue), 1),
    ).toWriteOnly();
  });

  const visualizationNode = visualizeWallField({ storageTexture: outputTexture })
    .compute(sampleCount, [256]);
  let workingResourcesReleased = false;
  let textureDisposed = false;

  function releaseWorkingResources(renderer: THREE.WebGPURenderer) {
    if (workingResourcesReleased) return;
    workingResourcesReleased = true;
    computeNodes.forEach((node) => node.dispose());
    computeNodes.length = 0;
    visualizationNode.dispose();
    releaseStorageBuffer(renderer, wallField);
    releaseStorageBuffer(renderer, diffuseReflectance);
  }

  return {
    field: wallField,
    texture: outputTexture,
    width,
    height,
    pixelSizeXmm,
    pixelSizeYmm,

    async run(renderer) {
      await renderer.computeAsync([...computeNodes, visualizationNode]);
    },

    releaseWorkingResources,

    dispose(renderer) {
      releaseWorkingResources(renderer);
      if (!textureDisposed) {
        outputTexture.dispose();
        textureDisposed = true;
      }
    },
  };
}

function boundedSeed(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(0, value) >>> 0
    : fallback;
}
