import type StorageBufferNode from 'three/src/nodes/accessors/StorageBufferNode.js';
import type ComputeNode from 'three/src/nodes/gpgpu/ComputeNode.js';
import type TSLNode from 'three/src/nodes/core/Node.js';
import { Fn, float, instanceIndex, uint, vec2 } from 'three/tsl';

type ComplexBuffer = StorageBufferNode<'vec2'>;

/**
 * Erzeugt die GPU-Rechenschritte für zweidimensionale komplexe FFTs.
 */
export function nextPowerOfTwo(value: number) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

export function appendFftPasses(
  nodes: ComputeNode[],
  initial: ComplexBuffer,
  initialScratch: ComplexBuffer,
  width: number,
  height: number,
  inverse: boolean,
) {
  assertPowerOfTwo(width, 'width');
  assertPowerOfTwo(height, 'height');

  let current = initial;
  let scratch = initialScratch;

  nodes.push(createBitReversePass(current, scratch, width, height, 'horizontal'));
  [current, scratch] = [scratch, current];
  for (let span = 2; span <= width; span *= 2) {
    nodes.push(createButterflyPass(current, scratch, width, height, span, 'horizontal', inverse));
    [current, scratch] = [scratch, current];
  }

  nodes.push(createBitReversePass(current, scratch, width, height, 'vertical'));
  [current, scratch] = [scratch, current];
  for (let span = 2; span <= height; span *= 2) {
    nodes.push(createButterflyPass(current, scratch, width, height, span, 'vertical', inverse));
    [current, scratch] = [scratch, current];
  }

  return { current, scratch };
}

export function complexMultiply(a: TSLNode<'vec2'>, b: TSLNode<'vec2'>) {
  return vec2(
    a.x.mul(b.x).sub(a.y.mul(b.y)),
    a.x.mul(b.y).add(a.y.mul(b.x)),
  );
}

export function finiteComplexOrZero(value: TSLNode<'vec2'>) {
  const isFinite = value.x.equal(value.x)
    .and(value.y.equal(value.y))
    .and(value.x.abs().lessThan(3e38))
    .and(value.y.abs().lessThan(3e38));
  return isFinite.select(value, vec2(0, 0));
}

function createBitReversePass(
  input: ComplexBuffer,
  output: ComplexBuffer,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
) {
  const size = axis === 'horizontal' ? width : height;
  const bitCount = Math.log2(size);
  return Fn(() => {
    const x = instanceIndex.mod(width);
    const y = instanceIndex.div(width);
    const coordinate = axis === 'horizontal' ? x : y;
    const reversed = reverseBits(coordinate, bitCount);
    const sourceIndex = axis === 'horizontal'
      ? y.mul(width).add(reversed)
      : reversed.mul(width).add(x);
    output.element(instanceIndex).assign(input.element(sourceIndex));
  })().compute(width * height, [256]);
}

function createButterflyPass(
  input: ComplexBuffer,
  output: ComplexBuffer,
  width: number,
  height: number,
  span: number,
  axis: 'horizontal' | 'vertical',
  inverse: boolean,
) {
  const halfSpan = span / 2;
  const sign = inverse ? 1 : -1;
  return Fn(() => {
    const x = instanceIndex.mod(width);
    const y = instanceIndex.div(width);
    const coordinate = axis === 'horizontal' ? x : y;
    const positionInSpan = coordinate.mod(span);
    const butterflyOffset = coordinate.mod(halfSpan);
    const groupStart = coordinate.div(span).mul(span);
    const evenCoordinate = groupStart.add(butterflyOffset);
    const oddCoordinate = evenCoordinate.add(halfSpan);
    const evenIndex = axis === 'horizontal'
      ? y.mul(width).add(evenCoordinate)
      : evenCoordinate.mul(width).add(x);
    const oddIndex = axis === 'horizontal'
      ? y.mul(width).add(oddCoordinate)
      : oddCoordinate.mul(width).add(x);
    const angle = float(butterflyOffset).mul(sign * Math.PI * 2 / span);
    const odd = complexMultiply(
      input.element(oddIndex),
      vec2(angle.cos(), angle.sin()),
    );
    const even = input.element(evenIndex);
    const combined = positionInSpan.lessThan(halfSpan)
      .select(even.add(odd), even.sub(odd));
    const result = inverse ? combined : combined.mul(0.5);
    output.element(instanceIndex).assign(result);
  })().compute(width * height, [256]);
}

function reverseBits(value: TSLNode<'uint'>, bitCount: number) {
  let result: TSLNode<'uint'> = uint(0);
  for (let bit = 0; bit < bitCount; bit += 1) {
    result = result.shiftLeft(1).bitOr(value.shiftRight(bit).bitAnd(1));
  }
  return result;
}

function assertPowerOfTwo(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || !Number.isInteger(Math.log2(value))) {
    throw new Error(`Complex FFT ${label} must be a positive power of two, got ${value}.`);
  }
}
