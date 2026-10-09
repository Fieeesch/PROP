import * as THREE from 'three/webgpu';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import {
  Fn,
  If,
  attributeArray,
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
  planeBasis,
  positiveInteger,
  positiveNumber,
  propertiesFor,
  vectorValue,
} from './LaserSceneParameters';
import type { WallFieldCompute } from './WallFieldCompute';
import {
  laserDirectionForScene,
  lensNormalForScene,
  wallNormalForScene,
} from './OpticalAxis';

export interface WallToLensCompute {
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
 * Propagiert das komplexe Feld von der Wand zur Linse und wendet deren Apertur an.
 */
export function createWallToLensCompute(
  scene: SceneConfig,
  source: WallFieldCompute,
): WallToLensCompute {
  const settings = propertiesFor(scene, 'LaserSimulationSettings');
  const laser = propertiesFor(scene, 'Laser');
  const wall = propertiesFor(scene, 'DiffuseWall');
  const lens = propertiesFor(scene, 'Lens');
  const dimensions = laserSamplingDimensions(scene);
  const paddingFactor = positiveInteger(settings?.fftZeroPaddingFactor, 4);
  const lensPixelSizeXmm = dimensions.lensPixelSizeXmm;
  const lensPixelSizeYmm = dimensions.lensPixelSizeYmm;
  const apertureRadiusMm = positiveNumber(lens?.apertureRadiusMm, 2.56);
  const lensWidth = apertureCroppedDimension(
    dimensions.lensFullWidth,
    apertureRadiusMm,
    lensPixelSizeXmm,
  );
  const lensHeight = apertureCroppedDimension(
    dimensions.lensFullHeight,
    apertureRadiusMm,
    lensPixelSizeYmm,
  );
  const lensSampleCount = lensWidth * lensHeight;
  const fftWidth = nextPowerOfTwo(source.width * paddingFactor);
  const fftHeight = nextPowerOfTwo(source.height * paddingFactor);
  const fftSampleCount = fftWidth * fftHeight;
  const wavelengthNm = positiveNumber(laser?.wavelengthNm, 650);
  const wavelengthMm = wavelengthNm * 1e-6;
  const waveNumber = Math.PI * 2 / wavelengthMm;
  const laserDirection = laserDirectionForScene(scene);
  const wallCenter = vectorValue(wall?.center, new THREE.Vector3(128, 128, 256));
  const wallNormal = wallNormalForScene(scene);
  const lensCenter = vectorValue(lens?.center, new THREE.Vector3(128, 128, -128));
  const lensNormal = lensNormalForScene(scene);
  const { right: wallRight, up: wallUp } = planeBasis(wallNormal);
  const { right: lensRight, up: lensUp } = planeBasis(lensNormal);
  const lensReferenceDirection = lensCenter.clone().sub(wallCenter).normalize();
  const propagationDistanceMm = lensCenter.clone().sub(wallCenter).dot(wallNormal);
  const samplingTransform = createPlaneSamplingTransform({
    sourceCenter: wallCenter,
    sourceNormal: wallNormal,
    sourceRight: wallRight,
    sourceUp: wallUp,
    sourcePixelSizeXmm: source.pixelSizeXmm,
    sourcePixelSizeYmm: source.pixelSizeYmm,
    propagationDistanceMm,
    fftWidth,
    fftHeight,
    destinationCenter: lensCenter,
    destinationRight: lensRight,
    destinationUp: lensUp,
    destinationWidth: lensWidth,
    destinationHeight: lensHeight,
    destinationPixelSizeXmm: lensPixelSizeXmm,
    destinationPixelSizeYmm: lensPixelSizeYmm,
    destinationReferenceDirection: lensReferenceDirection,
    destinationReferenceOrigin: lensCenter,
  });
  const sourceReferencePathOrigin = laserDirection.dot(wallRight)
    * -(source.width - 1) * 0.5 * source.pixelSizeXmm
    + laserDirection.dot(wallUp)
    * -(source.height - 1) * 0.5 * source.pixelSizeYmm;
  const sourceReferencePathStepX = laserDirection.dot(wallRight) * source.pixelSizeXmm;
  const sourceReferencePathStepY = laserDirection.dot(wallUp) * source.pixelSizeYmm;

  const fftA = attributeArray(fftSampleCount, 'vec2');
  fftA.setName('wallToLensFftA');
  const fftB = attributeArray(fftSampleCount, 'vec2');
  fftB.setName('wallToLensFftB');
  const lensField = attributeArray(lensSampleCount, 'vec2');
  lensField.setName('lensInputField');
  const maxLensAmplitudeBits = attributeArray(1, 'uint').toAtomic();
  maxLensAmplitudeBits.setName('lensInputMaxAmplitudeBits');

  const outputTexture = new THREE.StorageTexture(lensWidth, lensHeight);
  outputTexture.name = 'laser-lens-input-intensity';
  outputTexture.colorSpace = THREE.LinearSRGBColorSpace;
  outputTexture.generateMipmaps = false;
  outputTexture.mipmapsAutoUpdate = false;

  const colorUniform = uniform(laserColorForWavelengthNm(wavelengthNm));

  const computeNodes: ComputeNode[] = [];
  const sourceColumnOffset = Math.floor((fftWidth - source.width) * 0.5);
  const sourceRowOffset = Math.floor((fftHeight - source.height) * 0.5);

  computeNodes.push(Fn(() => {
    const fftX = instanceIndex.mod(fftWidth);
    const fftY = instanceIndex.div(fftWidth);
    const target = fftA.element(instanceIndex);
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
        source.field.element(sourceIndex),
        vec2(phase.cos(), phase.sin()),
      ));
    });
  })().compute(fftSampleCount, [256]));

  let current = fftA;
  let scratch = fftB;
  ({ current, scratch } = appendFftPasses(
    computeNodes,
    current,
    scratch,
    fftWidth,
    fftHeight,
    false,
  ));

  const spectrum = current;
  computeNodes.push(Fn(() => {
    const x = instanceIndex.mod(fftWidth);
    const y = instanceIndex.div(fftWidth);
    const signedX = x.lessThanEqual(fftWidth / 2)
      .select(float(x), float(x).sub(fftWidth));
    const signedY = y.lessThanEqual(fftHeight / 2)
      .select(float(y), float(y).sub(fftHeight));
    const kx = signedX.mul(Math.PI * 2 / (fftWidth * source.pixelSizeXmm));
    const ky = signedY.mul(Math.PI * 2 / (fftHeight * source.pixelSizeYmm));
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
  })().compute(fftSampleCount, [256]));

  ({ current, scratch } = appendFftPasses(
    computeNodes,
    current,
    scratch,
    fftWidth,
    fftHeight,
    true,
  ));

  const inverseResult = current;
  computeNodes.push(Fn(() => {
    const lensX = instanceIndex.mod(lensWidth);
    const lensY = instanceIndex.div(lensWidth);
    const target = lensField.element(instanceIndex);
    target.assign(vec2(0, 0));
    const offsetX = float(lensX).sub((lensWidth - 1) * 0.5).mul(lensPixelSizeXmm);
    const offsetY = float(lensY).sub((lensHeight - 1) * 0.5).mul(lensPixelSizeYmm);
    const insideAperture = offsetX.mul(offsetX).add(offsetY.mul(offsetY))
      .lessThanEqual(apertureRadiusMm * apertureRadiusMm);

    If(insideAperture, () => {
      const sampleColumn = affinePlaneValue(
        lensX,
        lensY,
        samplingTransform.sampleColumnOrigin,
        samplingTransform.sampleColumnStepX,
        samplingTransform.sampleColumnStepY,
      );
      const sampleRow = affinePlaneValue(
        lensX,
        lensY,
        samplingTransform.sampleRowOrigin,
        samplingTransform.sampleRowStepX,
        samplingTransform.sampleRowStepY,
      );
      const sample = sampleComplexBilinear(
        inverseResult,
        fftWidth,
        fftHeight,
        sampleColumn,
        sampleRow,
      );
      const destinationPath = affinePlaneValue(
        lensX,
        lensY,
        samplingTransform.destinationPathOrigin,
        samplingTransform.destinationPathStepX,
        samplingTransform.destinationPathStepY,
      );
      const destinationPhase = destinationPath.mul(waveNumber).negate();
      target.assign(finiteComplexOrZero(complexMultiply(
        sample,
        vec2(destinationPhase.cos(), destinationPhase.sin()),
      )));
    });
  })().compute(lensSampleCount, [256]));

  computeNodes.push(Fn(() => {
    atomicStore(maxLensAmplitudeBits.element(0), uint(0));
  })().compute(1));

  computeNodes.push(Fn(() => {
    const field = lensField.element(instanceIndex);
    const absoluteReal = field.x.abs();
    const absoluteImaginary = field.y.abs();
    const scale = absoluteReal.max(absoluteImaginary);
    const ratio = absoluteReal.min(absoluteImaginary).div(scale.max(1e-30));
    const amplitude = scale.mul(float(1).add(ratio.mul(ratio)).sqrt());
    const validAmplitude = amplitude.equal(amplitude)
      .and(amplitude.greaterThanEqual(0))
      .and(amplitude.lessThan(3e38));
    If(validAmplitude, () => {
      atomicMax(maxLensAmplitudeBits.element(0), floatBitsToUint(amplitude));
    });
  })().compute(lensSampleCount, [256]));

  const visualizeLensField = Fn(({ storageTexture }) => {
    const pixelX = instanceIndex.mod(lensWidth);
    const pixelY = instanceIndex.div(lensWidth);
    const field = lensField.element(instanceIndex);
    const absoluteReal = field.x.abs();
    const absoluteImaginary = field.y.abs();
    const scale = absoluteReal.max(absoluteImaginary);
    const ratio = absoluteReal.min(absoluteImaginary).div(scale.max(1e-30));
    const amplitude = scale.mul(float(1).add(ratio.mul(ratio)).sqrt());
    const maxAmplitude = uintBitsToFloat(
      atomicLoad(maxLensAmplitudeBits.element(0)),
    ).max(1e-30);
    const displayValue = amplitude.div(maxAmplitude).clamp(0, 1).sqrt();
    textureStore(
      storageTexture,
      uvec2(pixelX, pixelY),
      vec4(colorUniform.mul(displayValue), 1),
    ).toWriteOnly();
  });
  computeNodes.push(
    visualizeLensField({ storageTexture: outputTexture }).compute(lensSampleCount, [256]),
  );
  let workingResourcesReleased = false;
  let textureDisposed = false;

  function releaseWorkingResources(renderer: THREE.WebGPURenderer) {
    if (workingResourcesReleased) return;
    workingResourcesReleased = true;
    computeNodes.forEach((node) => node.dispose());
    computeNodes.length = 0;
    releaseStorageBuffer(renderer, fftA);
    releaseStorageBuffer(renderer, fftB);
    releaseStorageBuffer(renderer, lensField);
    releaseStorageBuffer(renderer, maxLensAmplitudeBits);
  }

  return {
    field: lensField,
    texture: outputTexture,
    width: lensWidth,
    height: lensHeight,
    pixelSizeXmm: lensPixelSizeXmm,
    pixelSizeYmm: lensPixelSizeYmm,

    async run(renderer) {
      await renderer.computeAsync(computeNodes);
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

function apertureCroppedDimension(
  fullDimension: number,
  apertureRadiusMm: number,
  pixelSizeMm: number,
) {
  const apertureSamples = Math.floor((2 * apertureRadiusMm) / pixelSizeMm) + 1;
  let cropped = Math.min(fullDimension, Math.max(1, apertureSamples));
  if (cropped > 1 && cropped % 2 !== fullDimension % 2) cropped -= 1;
  return cropped;
}
