import * as THREE from 'three/webgpu';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import {
  Fn,
  If,
  attributeArray,
  atomicAdd,
  atomicLoad,
  atomicMax,
  atomicStore,
  float,
  floatBitsToUint,
  instanceIndex,
  textureStore,
  uint,
  uintBitsToFloat,
  uniform,
  uvec2,
  vec2,
  vec4,
} from 'three/tsl';

import type { SceneConfig } from '../../model/SceneConfig';
import {
  appendFftPasses,
  complexMultiply,
  finiteComplexOrZero,
  nextPowerOfTwo,
} from './ComplexFft';
import {
  affinePlaneValue,
  createPlaneSamplingTransform,
  sampleComplexBilinear,
} from './PlaneSampling';
import { releaseStorageBuffer } from './LaserGpuResources';
import { laserSamplingDimensions } from './LaserSamplingDimensions';
import {
  laserColorForWavelengthNm,
  nonNegativeNumber,
  planeBasis,
  positiveInteger,
  positiveNumber,
  propertiesFor,
  vectorValue,
} from './LaserSceneParameters';
import type { WallToLensCompute } from './WallToLensCompute';
import {
  laserDirectionForScene,
  lensNormalForScene,
  sensorNormalForScene,
  wallNormalForScene,
} from './OpticalAxis';

export interface LensToSensorCompute {
  readonly texture: THREE.StorageTexture;
  readonly lensOutputTexture: THREE.StorageTexture;
  run(renderer: THREE.WebGPURenderer): Promise<void>;
  releaseWorkingResources(renderer: THREE.WebGPURenderer): void;
  dispose(renderer: THREE.WebGPURenderer): void;
}

/**
 * Propagiert das komplexe Feld von der Linse bis zum Sensor und erzeugt dessen Ergebnistextur.
 */
export function createLensToSensorCompute(
  scene: SceneConfig,
  source: WallToLensCompute,
): LensToSensorCompute {
  const settings = propertiesFor(scene, 'LaserSimulationSettings');
  const laser = propertiesFor(scene, 'Laser');
  const wall = propertiesFor(scene, 'DiffuseWall');
  const lens = propertiesFor(scene, 'Lens');
  const dimensions = laserSamplingDimensions(scene);
  const supersampleFactor = positiveInteger(settings?.sensorSupersampleFactor, 2);
  const paddingFactor = positiveInteger(settings?.fftZeroPaddingFactor, 4);
  const outputWidth = dimensions.sensorOutputWidth;
  const outputHeight = dimensions.sensorOutputHeight;
  const sensorWidth = dimensions.sensorWidth;
  const sensorHeight = dimensions.sensorHeight;
  const sensorSampleCount = sensorWidth * sensorHeight;
  const outputSampleCount = outputWidth * outputHeight;
  const histogramBinCount = 256;
  const percentileTarget = Math.floor(0.995 * (outputSampleCount - 1)) + 1;
  const forwardWidth = nextPowerOfTwo(source.width * paddingFactor);
  const forwardHeight = nextPowerOfTwo(source.height * paddingFactor);
  const forwardSampleCount = forwardWidth * forwardHeight;
  const inverseWidth = forwardWidth * supersampleFactor;
  const inverseHeight = forwardHeight * supersampleFactor;
  const inverseSampleCount = inverseWidth * inverseHeight;
  const inversePixelSizeXmm = source.pixelSizeXmm / supersampleFactor;
  const inversePixelSizeYmm = source.pixelSizeYmm / supersampleFactor;
  const sensorPixelSizeXmm = dimensions.sensorPixelSizeXmm;
  const sensorPixelSizeYmm = dimensions.sensorPixelSizeYmm;
  const wavelengthNm = positiveNumber(laser?.wavelengthNm, 650);
  const wavelengthMm = wavelengthNm * 1e-6;
  const waveNumber = Math.PI * 2 / wavelengthMm;
  const focalLengthMm = positiveNumber(lens?.focalLengthMm, 128);
  const apertureRadiusMm = positiveNumber(lens?.apertureRadiusMm, 2.56);
  const transmission = nonNegativeNumber(lens?.transmission, 1);
  const wallCenter = vectorValue(wall?.center, new THREE.Vector3(128, 128, 256));
  const lensCenter = vectorValue(lens?.center, new THREE.Vector3(128, 128, -128));
  const lensNormal = lensNormalForScene(scene);
  const baseSensorNormal = sensorNormalForScene(scene);
  const sensorCenter = resolvedSensorCenterForScene(scene);
  const { right: lensRight, up: lensUp } = planeBasis(lensNormal);
  const { right: sensorRight, up: sensorUp } = planeBasis(baseSensorNormal);
  const lensReferenceDirection = lensCenter.clone().sub(wallCenter).normalize();
  const sensorReferenceDirection = sensorCenter.clone().sub(lensCenter).normalize();
  const propagationDistanceMm = sensorCenter.clone().sub(lensCenter).dot(lensNormal);
  const samplingTransform = createPlaneSamplingTransform({
    sourceCenter: lensCenter,
    sourceNormal: lensNormal,
    sourceRight: lensRight,
    sourceUp: lensUp,
    sourcePixelSizeXmm: inversePixelSizeXmm,
    sourcePixelSizeYmm: inversePixelSizeYmm,
    propagationDistanceMm,
    fftWidth: inverseWidth,
    fftHeight: inverseHeight,
    destinationCenter: sensorCenter,
    destinationRight: sensorRight,
    destinationUp: sensorUp,
    destinationWidth: sensorWidth,
    destinationHeight: sensorHeight,
    destinationPixelSizeXmm: sensorPixelSizeXmm,
    destinationPixelSizeYmm: sensorPixelSizeYmm,
    destinationReferenceDirection: sensorReferenceDirection,
    destinationReferenceOrigin: sensorCenter,
  });
  const sourceReferencePathOrigin = lensReferenceDirection.dot(lensRight)
    * -(source.width - 1) * 0.5 * source.pixelSizeXmm
    + lensReferenceDirection.dot(lensUp)
    * -(source.height - 1) * 0.5 * source.pixelSizeYmm;
  const sourceReferencePathStepX = lensReferenceDirection.dot(lensRight) * source.pixelSizeXmm;
  const sourceReferencePathStepY = lensReferenceDirection.dot(lensUp) * source.pixelSizeYmm;

  const lensOutputField = attributeArray(source.width * source.height, 'vec2');
  lensOutputField.setName('lensOutputField');
  const maxLensOutputAmplitudeBits = attributeArray(1, 'uint').toAtomic();
  maxLensOutputAmplitudeBits.setName('lensOutputMaxAmplitudeBits');
  const forwardA = attributeArray(forwardSampleCount, 'vec2');
  forwardA.setName('lensToSensorForwardA');
  const forwardB = attributeArray(forwardSampleCount, 'vec2');
  forwardB.setName('lensToSensorForwardB');
  const inverseA = attributeArray(inverseSampleCount, 'vec2');
  inverseA.setName('lensToSensorInverseA');
  const inverseB = attributeArray(inverseSampleCount, 'vec2');
  inverseB.setName('lensToSensorInverseB');
  const sensorField = attributeArray(sensorSampleCount, 'vec2');
  sensorField.setName('sensorField');
  const sensorPower = attributeArray(outputSampleCount, 'float');
  sensorPower.setName('sensorPower');
  const maxAmplitudeBits = attributeArray(1, 'uint').toAtomic();
  maxAmplitudeBits.setName('sensorMaxAmplitudeBits');
  const maxPowerBits = attributeArray(1, 'uint').toAtomic();
  maxPowerBits.setName('sensorMaxPowerBits');
  const histogram = attributeArray(histogramBinCount, 'uint').toAtomic();
  histogram.setName('sensorPowerHistogram');
  const whitePoint = attributeArray(1, 'float');
  whitePoint.setName('sensorWhitePoint');

  const outputTexture = new THREE.StorageTexture(outputWidth, outputHeight);
  outputTexture.name = 'laser-sensor-intensity';
  outputTexture.colorSpace = THREE.LinearSRGBColorSpace;
  outputTexture.generateMipmaps = false;
  outputTexture.mipmapsAutoUpdate = false;

  const lensOutputTexture = new THREE.StorageTexture(source.width, source.height);
  lensOutputTexture.name = 'laser-lens-output-intensity';
  lensOutputTexture.colorSpace = THREE.LinearSRGBColorSpace;
  lensOutputTexture.generateMipmaps = false;
  lensOutputTexture.mipmapsAutoUpdate = false;

  const colorUniform = uniform(laserColorForWavelengthNm(wavelengthNm));
  const computeNodes: ComputeNode[] = [];

  computeNodes.push(Fn(() => {
    const x = instanceIndex.mod(source.width);
    const y = instanceIndex.div(source.width);
    const offsetX = float(x).sub((source.width - 1) * 0.5).mul(source.pixelSizeXmm);
    const offsetY = float(y).sub((source.height - 1) * 0.5).mul(source.pixelSizeYmm);
    const radiusSquared = offsetX.mul(offsetX).add(offsetY.mul(offsetY));
    const target = lensOutputField.element(instanceIndex);
    target.assign(vec2(0, 0));
    If(radiusSquared.lessThanEqual(apertureRadiusMm * apertureRadiusMm), () => {
      const lensPhase = radiusSquared.mul(-waveNumber / (2 * focalLengthMm));
      target.assign(finiteComplexOrZero(
        complexMultiply(
          finiteComplexOrZero(source.field.element(instanceIndex)),
          vec2(lensPhase.cos(), lensPhase.sin()),
        ).mul(transmission),
      ));
    });
  })().compute(source.width * source.height, [256]));

  computeNodes.push(Fn(() => {
    atomicStore(maxLensOutputAmplitudeBits.element(0), uint(0));
  })().compute(1));

  computeNodes.push(Fn(() => {
    const field = lensOutputField.element(instanceIndex);
    const absoluteReal = field.x.abs();
    const absoluteImaginary = field.y.abs();
    const scale = absoluteReal.max(absoluteImaginary);
    const ratio = absoluteReal.min(absoluteImaginary).div(scale.max(1e-30));
    const amplitude = scale.mul(float(1).add(ratio.mul(ratio)).sqrt());
    const validAmplitude = amplitude.equal(amplitude)
      .and(amplitude.greaterThanEqual(0))
      .and(amplitude.lessThan(3e38));
    If(validAmplitude, () => {
      atomicMax(maxLensOutputAmplitudeBits.element(0), floatBitsToUint(amplitude));
    });
  })().compute(source.width * source.height, [256]));

  const visualizeLensOutput = Fn(({ storageTexture }) => {
    const pixelX = instanceIndex.mod(source.width);
    const pixelY = instanceIndex.div(source.width);
    const field = lensOutputField.element(instanceIndex);
    const absoluteReal = field.x.abs();
    const absoluteImaginary = field.y.abs();
    const scale = absoluteReal.max(absoluteImaginary);
    const ratio = absoluteReal.min(absoluteImaginary).div(scale.max(1e-30));
    const amplitude = scale.mul(float(1).add(ratio.mul(ratio)).sqrt());
    const maxAmplitude = uintBitsToFloat(
      atomicLoad(maxLensOutputAmplitudeBits.element(0)),
    ).max(1e-30);
    const brightness = amplitude.div(maxAmplitude).clamp(0, 1).sqrt();
    textureStore(
      storageTexture,
      uvec2(pixelX, pixelY),
      vec4(colorUniform.mul(brightness), 1),
    ).toWriteOnly();
  });
  computeNodes.push(visualizeLensOutput({ storageTexture: lensOutputTexture })
    .compute(source.width * source.height, [256]));

  const sourceColumnOffset = Math.floor((forwardWidth - source.width) * 0.5);
  const sourceRowOffset = Math.floor((forwardHeight - source.height) * 0.5);
  computeNodes.push(Fn(() => {
    const fftX = instanceIndex.mod(forwardWidth);
    const fftY = instanceIndex.div(forwardWidth);
    const target = forwardA.element(instanceIndex);
    target.assign(vec2(0, 0));
    const insideSource = fftX.greaterThanEqual(sourceColumnOffset)
      .and(fftX.lessThan(sourceColumnOffset + source.width))
      .and(fftY.greaterThanEqual(sourceRowOffset))
      .and(fftY.lessThan(sourceRowOffset + source.height));

    If(insideSource, () => {
      const sourceX = fftX.sub(sourceColumnOffset);
      const sourceY = fftY.sub(sourceRowOffset);
      const sourceIndex = sourceY.mul(source.width).add(sourceX);
      const referencePath = affinePlaneValue(
        sourceX,
        sourceY,
        sourceReferencePathOrigin,
        sourceReferencePathStepX,
        sourceReferencePathStepY,
      );
      const phase = referencePath.mul(waveNumber);
      target.assign(complexMultiply(
        lensOutputField.element(sourceIndex),
        vec2(phase.cos(), phase.sin()),
      ));
    });
  })().compute(forwardSampleCount, [256]));

  let forwardCurrent = forwardA;
  let forwardScratch = forwardB;
  ({ current: forwardCurrent, scratch: forwardScratch } = appendFftPasses(
    computeNodes,
    forwardCurrent,
    forwardScratch,
    forwardWidth,
    forwardHeight,
    false,
  ));

  const spectrum = forwardCurrent;
  computeNodes.push(Fn(() => {
    const x = instanceIndex.mod(forwardWidth);
    const y = instanceIndex.div(forwardWidth);
    const signedX = x.lessThanEqual(forwardWidth / 2)
      .select(float(x), float(x).sub(forwardWidth));
    const signedY = y.lessThanEqual(forwardHeight / 2)
      .select(float(y), float(y).sub(forwardHeight));
    const kx = signedX.mul(Math.PI * 2 / (forwardWidth * source.pixelSizeXmm));
    const ky = signedY.mul(Math.PI * 2 / (forwardHeight * source.pixelSizeYmm));
    const transverseSquared = kx.mul(kx).add(ky.mul(ky));
    const kzSquared = float(waveNumber * waveNumber).sub(transverseSquared);
    const propagated = vec2(0, 0).toVar();
    If(kzSquared.greaterThan(0), () => {
      const kz = kzSquared.sqrt();
      const phase = transverseSquared.negate()
        .div(kz.add(waveNumber))
        .mul(propagationDistanceMm);
      propagated.assign(complexMultiply(
        spectrum.element(instanceIndex),
        vec2(phase.cos(), phase.sin()),
      ));
    });
    spectrum.element(instanceIndex).assign(propagated);
  })().compute(forwardSampleCount, [256]));

  computeNodes.push(Fn(() => {
    inverseA.element(instanceIndex).assign(vec2(0, 0));
  })().compute(inverseSampleCount, [256]));
  computeNodes.push(Fn(() => {
    const x = instanceIndex.mod(forwardWidth);
    const y = instanceIndex.div(forwardWidth);
    const signedX = x.lessThanEqual(forwardWidth / 2)
      .select(float(x), float(x).sub(forwardWidth));
    const signedY = y.lessThanEqual(forwardHeight / 2)
      .select(float(y), float(y).sub(forwardHeight));
    const paddedX = signedX.greaterThanEqual(0)
      .select(signedX, signedX.add(inverseWidth)).toUint();
    const paddedY = signedY.greaterThanEqual(0)
      .select(signedY, signedY.add(inverseHeight)).toUint();
    inverseA.element(paddedY.mul(inverseWidth).add(paddedX))
      .assign(spectrum.element(instanceIndex));
  })().compute(forwardSampleCount, [256]));

  let inverseCurrent = inverseA;
  let inverseScratch = inverseB;
  ({ current: inverseCurrent, scratch: inverseScratch } = appendFftPasses(
    computeNodes,
    inverseCurrent,
    inverseScratch,
    inverseWidth,
    inverseHeight,
    true,
  ));

  const inverseResult = inverseCurrent;
  computeNodes.push(Fn(() => {
    const sensorX = instanceIndex.mod(sensorWidth);
    const sensorY = instanceIndex.div(sensorWidth);
    const sampleColumn = affinePlaneValue(
      sensorX,
      sensorY,
      samplingTransform.sampleColumnOrigin,
      samplingTransform.sampleColumnStepX,
      samplingTransform.sampleColumnStepY,
    );
    const sampleRow = affinePlaneValue(
      sensorX,
      sensorY,
      samplingTransform.sampleRowOrigin,
      samplingTransform.sampleRowStepX,
      samplingTransform.sampleRowStepY,
    );
    const sample = sampleComplexBilinear(
      inverseResult,
      inverseWidth,
      inverseHeight,
      sampleColumn,
      sampleRow,
    );
    const destinationPath = affinePlaneValue(
      sensorX,
      sensorY,
      samplingTransform.destinationPathOrigin,
      samplingTransform.destinationPathStepX,
      samplingTransform.destinationPathStepY,
    );
    const destinationPhase = destinationPath.mul(waveNumber).negate();
    sensorField.element(instanceIndex).assign(complexMultiply(
      sample,
      vec2(destinationPhase.cos(), destinationPhase.sin()),
    ));
  })().compute(sensorSampleCount, [256]));

  computeNodes.push(Fn(() => {
    atomicStore(maxAmplitudeBits.element(0), uint(0));
    atomicStore(maxPowerBits.element(0), uint(0));
  })().compute(1));

  computeNodes.push(Fn(() => {
    const field = sensorField.element(instanceIndex);
    const absoluteReal = field.x.abs();
    const absoluteImaginary = field.y.abs();
    const scale = absoluteReal.max(absoluteImaginary);
    const ratio = absoluteReal.min(absoluteImaginary).div(scale.max(1e-30));
    const amplitude = scale.mul(float(1).add(ratio.mul(ratio)).sqrt());
    const validAmplitude = amplitude.equal(amplitude)
      .and(amplitude.greaterThanEqual(0))
      .and(amplitude.lessThan(3e38));
    If(validAmplitude, () => {
      atomicMax(maxAmplitudeBits.element(0), floatBitsToUint(amplitude));
    });
  })().compute(sensorSampleCount, [256]));

  computeNodes.push(Fn(() => {
    const outputX = instanceIndex.mod(outputWidth);
    const outputY = instanceIndex.div(outputWidth);
    const maxAmplitude = uintBitsToFloat(
      atomicLoad(maxAmplitudeBits.element(0)),
    ).max(1e-30);
    const power = float(0).toVar();
    for (let y = 0; y < supersampleFactor; y += 1) {
      for (let x = 0; x < supersampleFactor; x += 1) {
        const sampleX = outputX.mul(supersampleFactor).add(x);
        const sampleY = outputY.mul(supersampleFactor).add(y);
        const field = sensorField.element(sampleY.mul(sensorWidth).add(sampleX))
          .div(maxAmplitude);
        power.addAssign(field.dot(field));
      }
    }
    const averagedPower = power.div(supersampleFactor * supersampleFactor);
    sensorPower.element(instanceIndex).assign(0);
    const validPower = averagedPower.equal(averagedPower)
      .and(averagedPower.greaterThanEqual(0))
      .and(averagedPower.lessThan(2));
    If(validPower, () => {
      sensorPower.element(instanceIndex).assign(averagedPower);
      atomicMax(maxPowerBits.element(0), floatBitsToUint(averagedPower));
    });
  })().compute(outputSampleCount, [256]));

  computeNodes.push(Fn(() => {
    atomicStore(histogram.element(instanceIndex), uint(0));
  })().compute(histogramBinCount, [256]));

  computeNodes.push(Fn(() => {
    const maxPower = uintBitsToFloat(atomicLoad(maxPowerBits.element(0))).max(1e-30);
    const normalizedPower = sensorPower.element(instanceIndex)
      .div(maxPower)
      .clamp(0, 1);
    const bin = normalizedPower.mul(histogramBinCount - 1)
      .floor()
      .toUint()
      .min(histogramBinCount - 1);
    atomicAdd(histogram.element(bin), uint(1));
  })().compute(outputSampleCount, [256]));

  computeNodes.push(Fn(() => {
    const cumulative = uint(0).toVar();
    const selectedBin = uint(histogramBinCount - 1).toVar();
    const found = uint(0).toVar();
    for (let bin = 0; bin < histogramBinCount; bin += 1) {
      cumulative.addAssign(atomicLoad(histogram.element(bin)));
      If(found.equal(0).and(cumulative.greaterThanEqual(percentileTarget)), () => {
        selectedBin.assign(bin);
        found.assign(1);
      });
    }
    whitePoint.element(0).assign(
      float(selectedBin).add(0.5).div(histogramBinCount).max(1 / histogramBinCount),
    );
  })().compute(1));

  const visualizeSensor = Fn(({ storageTexture }) => {
    const outputX = instanceIndex.mod(outputWidth);
    const outputY = instanceIndex.div(outputWidth);
    const maxPower = uintBitsToFloat(atomicLoad(maxPowerBits.element(0))).max(1e-30);
    const displayValue = sensorPower.element(instanceIndex)
      .div(maxPower)
      .mul(1.25)
      .div(whitePoint.element(0))
      .clamp(0, 1);
    textureStore(
      storageTexture,
      uvec2(outputX, outputY),
      vec4(colorUniform.mul(displayValue), 1),
    ).toWriteOnly();
  });
  computeNodes.push(visualizeSensor({ storageTexture: outputTexture })
    .compute(outputSampleCount, [256]));
  let workingResourcesReleased = false;
  let texturesDisposed = false;

  function releaseWorkingResources(renderer: THREE.WebGPURenderer) {
    if (workingResourcesReleased) return;
    workingResourcesReleased = true;
    computeNodes.forEach((node) => node.dispose());
    computeNodes.length = 0;
    releaseStorageBuffer(renderer, lensOutputField);
    releaseStorageBuffer(renderer, maxLensOutputAmplitudeBits);
    releaseStorageBuffer(renderer, forwardA);
    releaseStorageBuffer(renderer, forwardB);
    releaseStorageBuffer(renderer, inverseA);
    releaseStorageBuffer(renderer, inverseB);
    releaseStorageBuffer(renderer, sensorField);
    releaseStorageBuffer(renderer, sensorPower);
    releaseStorageBuffer(renderer, maxAmplitudeBits);
    releaseStorageBuffer(renderer, maxPowerBits);
    releaseStorageBuffer(renderer, histogram);
    releaseStorageBuffer(renderer, whitePoint);
  }

  return {
    texture: outputTexture,
    lensOutputTexture,

    async run(renderer) {
      await renderer.computeAsync(computeNodes);
    },

    releaseWorkingResources,

    dispose(renderer) {
      releaseWorkingResources(renderer);
      if (!texturesDisposed) {
        outputTexture.dispose();
        lensOutputTexture.dispose();
        texturesDisposed = true;
      }
    },
  };
}

export function resolvedSensorCenterForScene(scene: SceneConfig) {
  const sensor = propertiesFor(scene, 'Sensor');
  const baseCenter = vectorValue(sensor?.center, new THREE.Vector3(128, 128, -320));
  if (sensor?.autoFocus !== true) return baseCenter;

  const lens = propertiesFor(scene, 'Lens');
  const lensCenter = vectorValue(lens?.center, new THREE.Vector3(128, 128, -128));
  const lensNormal = lensNormalForScene(scene);
  const focalLengthMm = positiveNumber(lens?.focalLengthMm, 128);
  const sensorNormal = sensorNormalForScene(scene);
  const focusPoint = laserSpotOnWall(scene);
  const lensToFocus = focusPoint.sub(lensCenter);
  const signedObjectDistance = lensToFocus.dot(lensNormal);
  const objectDistance = Math.abs(signedObjectDistance);
  if (objectDistance <= 1e-6 || Math.abs(objectDistance - focalLengthMm) <= 1e-6) {
    return baseCenter;
  }

  const imageDistance = focalLengthMm * objectDistance / (objectDistance - focalLengthMm);
  const transverseOffset = lensToFocus.sub(lensNormal.clone().multiplyScalar(signedObjectDistance));
  const imagePoint = lensCenter.clone()
    .add(lensNormal.clone().multiplyScalar(imageDistance))
    .sub(transverseOffset.multiplyScalar(imageDistance / objectDistance));
  const shift = imagePoint.sub(baseCenter).dot(sensorNormal);
  return baseCenter.add(sensorNormal.multiplyScalar(shift));
}

function laserSpotOnWall(scene: SceneConfig) {
  const laser = propertiesFor(scene, 'Laser');
  const wall = propertiesFor(scene, 'DiffuseWall');
  const laserCenter = vectorValue(laser?.center, new THREE.Vector3(128, 128, 0));
  const laserDirection = laserDirectionForScene(scene);
  const wallCenter = vectorValue(wall?.center, new THREE.Vector3(128, 128, 256));
  const wallNormal = wallNormalForScene(scene);
  const denominator = wallNormal.dot(laserDirection);
  if (Math.abs(denominator) < 1e-6) return wallCenter;
  const distance = wallCenter.clone().sub(laserCenter).dot(wallNormal) / denominator;
  return distance > 0
    ? laserCenter.add(laserDirection.multiplyScalar(distance))
    : wallCenter;
}
