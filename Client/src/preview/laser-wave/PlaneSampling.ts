import * as THREE from 'three/webgpu';
import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type TSLNode from 'three/src/nodes/core/Node.js';
import { If, float, vec2 } from 'three/tsl';

interface PlaneSamplingTransform {
  readonly sampleColumnOrigin: number;
  readonly sampleColumnStepX: number;
  readonly sampleColumnStepY: number;
  readonly sampleRowOrigin: number;
  readonly sampleRowStepX: number;
  readonly sampleRowStepY: number;
  readonly destinationPathOrigin: number;
  readonly destinationPathStepX: number;
  readonly destinationPathStepY: number;
}

interface PlaneSamplingParameters {
  sourceCenter: THREE.Vector3;
  sourceNormal: THREE.Vector3;
  sourceRight: THREE.Vector3;
  sourceUp: THREE.Vector3;
  sourcePixelSizeXmm: number;
  sourcePixelSizeYmm: number;
  propagationDistanceMm: number;
  fftWidth: number;
  fftHeight: number;
  destinationCenter: THREE.Vector3;
  destinationRight: THREE.Vector3;
  destinationUp: THREE.Vector3;
  destinationWidth: number;
  destinationHeight: number;
  destinationPixelSizeXmm: number;
  destinationPixelSizeYmm: number;
  destinationReferenceDirection: THREE.Vector3;
  destinationReferenceOrigin: THREE.Vector3;
}

/**
 * Berechnet affine Abbildungen und bilineare Abtastung zwischen optischen Ebenen.
 */
export function createPlaneSamplingTransform({
  sourceCenter,
  sourceNormal,
  sourceRight,
  sourceUp,
  sourcePixelSizeXmm,
  sourcePixelSizeYmm,
  propagationDistanceMm,
  fftWidth,
  fftHeight,
  destinationCenter,
  destinationRight,
  destinationUp,
  destinationWidth,
  destinationHeight,
  destinationPixelSizeXmm,
  destinationPixelSizeYmm,
  destinationReferenceDirection,
  destinationReferenceOrigin,
}: PlaneSamplingParameters): PlaneSamplingTransform {
  const outputCenter = sourceCenter.clone().add(
    sourceNormal.clone().multiplyScalar(propagationDistanceMm),
  );
  const firstDestinationPosition = destinationCenter.clone()
    .add(destinationRight.clone().multiplyScalar(
      -(destinationWidth - 1) * 0.5 * destinationPixelSizeXmm,
    ))
    .add(destinationUp.clone().multiplyScalar(
      -(destinationHeight - 1) * 0.5 * destinationPixelSizeYmm,
    ));
  const firstRelative = firstDestinationPosition.clone().sub(outputCenter);

  return {
    sampleColumnOrigin: firstRelative.dot(sourceRight) / sourcePixelSizeXmm
      + (fftWidth - 1) * 0.5,
    sampleColumnStepX: destinationRight.dot(sourceRight)
      * destinationPixelSizeXmm / sourcePixelSizeXmm,
    sampleColumnStepY: destinationUp.dot(sourceRight)
      * destinationPixelSizeYmm / sourcePixelSizeXmm,
    sampleRowOrigin: firstRelative.dot(sourceUp) / sourcePixelSizeYmm
      + (fftHeight - 1) * 0.5,
    sampleRowStepX: destinationRight.dot(sourceUp)
      * destinationPixelSizeXmm / sourcePixelSizeYmm,
    sampleRowStepY: destinationUp.dot(sourceUp)
      * destinationPixelSizeYmm / sourcePixelSizeYmm,
    destinationPathOrigin: destinationReferenceDirection.dot(
      firstDestinationPosition.clone().sub(destinationReferenceOrigin),
    ),
    destinationPathStepX: destinationReferenceDirection.dot(destinationRight)
      * destinationPixelSizeXmm,
    destinationPathStepY: destinationReferenceDirection.dot(destinationUp)
      * destinationPixelSizeYmm,
  };
}

export function affinePlaneValue(
  x: TSLNode<'uint'>,
  y: TSLNode<'uint'>,
  origin: number,
  stepX: number,
  stepY: number,
) {
  return float(x).mul(stepX).add(float(y).mul(stepY)).add(origin);
}

export function sampleComplexBilinear(
  input: StorageBufferNode<'vec2'>,
  width: number,
  height: number,
  sampleColumn: TSLNode<'float'>,
  sampleRow: TSLNode<'float'>,
) {
  const sample = vec2(0, 0).toVar();
  const inside = sampleColumn.greaterThanEqual(0)
    .and(sampleColumn.lessThanEqual(width - 1))
    .and(sampleRow.greaterThanEqual(0))
    .and(sampleRow.lessThanEqual(height - 1));

  If(inside, () => {
    const x0 = sampleColumn.floor().toUint();
    const y0 = sampleRow.floor().toUint();
    const x1 = x0.add(1).min(width - 1);
    const y1 = y0.add(1).min(height - 1);
    const tx = sampleColumn.fract();
    const ty = sampleRow.fract();
    const a = input.element(y0.mul(width).add(x0));
    const b = input.element(y0.mul(width).add(x1));
    const c = input.element(y1.mul(width).add(x0));
    const d = input.element(y1.mul(width).add(x1));
    const top = a.mul(tx.oneMinus()).add(b.mul(tx));
    const bottom = c.mul(tx.oneMinus()).add(d.mul(tx));
    sample.assign(top.mul(ty.oneMinus()).add(bottom.mul(ty)));
  });

  return sample;
}
