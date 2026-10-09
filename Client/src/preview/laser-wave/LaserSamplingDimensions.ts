import type { SceneConfig } from '../../model/SceneConfig';
import {
  positiveInteger,
  positiveNumber,
  propertiesFor,
} from './LaserSceneParameters';

interface LaserSamplingDimensions {
  baseWidth: number;
  baseHeight: number;
  wallWidth: number;
  wallHeight: number;
  wallWindowWidthMm: number;
  wallWindowHeightMm: number;
  wallPixelSizeXmm: number;
  wallPixelSizeYmm: number;
  lensFullWidth: number;
  lensFullHeight: number;
  lensPixelSizeXmm: number;
  lensPixelSizeYmm: number;
  sensorOutputWidth: number;
  sensorOutputHeight: number;
  sensorWidth: number;
  sensorHeight: number;
  sensorPhysicalWidthMm: number;
  sensorPhysicalHeightMm: number;
  sensorPixelSizeXmm: number;
  sensorPixelSizeYmm: number;
}

/**
 * Leitet Pixelraster, physische Abmessungen und Abtastweiten der optischen Ebenen ab.
 */
export function laserSamplingDimensions(scene: SceneConfig): LaserSamplingDimensions {
  const settings = propertiesFor(scene, 'LaserSimulationSettings');
  const lens = propertiesFor(scene, 'Lens');
  const sensor = propertiesFor(scene, 'Sensor');
  const baseWidth = positiveInteger(settings?.width, 216);
  const baseHeight = positiveInteger(settings?.height, 216);
  const wallFactor = positiveInteger(settings?.wallFactor, 2);
  const lensFactor = positiveInteger(settings?.lensFactor, 1);
  const lensSupersampleFactor = positiveInteger(settings?.lensSupersampleFactor, 2);
  const sensorFactor = positiveInteger(settings?.sensorFactor, 1);
  const sensorSupersampleFactor = positiveInteger(settings?.sensorSupersampleFactor, 2);

  const wallWidth = baseWidth * wallFactor;
  const wallHeight = baseHeight * wallFactor;
  const wallWindowWidthMm = positiveNumber(settings?.planeWidthMm, 5.12);
  const wallWindowHeightMm = positiveNumber(settings?.planeHeightMm, 5.12);

  const lensFullWidth = baseWidth * lensFactor * lensSupersampleFactor;
  const lensFullHeight = baseHeight * lensFactor * lensSupersampleFactor;
  const lensDiameterMm = positiveNumber(lens?.apertureRadiusMm, 2.56) * 2;

  const sensorOutputWidth = baseWidth * sensorFactor;
  const sensorOutputHeight = baseHeight * sensorFactor;
  const sensorWidth = sensorOutputWidth * sensorSupersampleFactor;
  const sensorHeight = sensorOutputHeight * sensorSupersampleFactor;
  const sensorPhysicalWidthMm = positiveNumber(sensor?.widthMm, 5.12);
  const sensorPhysicalHeightMm = positiveNumber(sensor?.heightMm, 5.12);

  return {
    baseWidth,
    baseHeight,
    wallWidth,
    wallHeight,
    wallWindowWidthMm,
    wallWindowHeightMm,
    wallPixelSizeXmm: wallWindowWidthMm / wallWidth,
    wallPixelSizeYmm: wallWindowHeightMm / wallHeight,
    lensFullWidth,
    lensFullHeight,
    lensPixelSizeXmm: lensDiameterMm / lensFullWidth,
    lensPixelSizeYmm: lensDiameterMm / lensFullHeight,
    sensorOutputWidth,
    sensorOutputHeight,
    sensorWidth,
    sensorHeight,
    sensorPhysicalWidthMm,
    sensorPhysicalHeightMm,
    sensorPixelSizeXmm: sensorPhysicalWidthMm / sensorWidth,
    sensorPixelSizeYmm: sensorPhysicalHeightMm / sensorHeight,
  };
}
