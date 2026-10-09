import * as THREE from 'three/webgpu';

interface StorageBufferHandle {
  readonly value: THREE.BufferAttribute;
  dispose(): void;
}

interface RendererWithAttributes extends THREE.WebGPURenderer {
  readonly _attributes?: {
    has(attribute: THREE.BufferAttribute): boolean;
    delete(attribute: THREE.BufferAttribute): unknown;
  };
}

/**
 * Gibt große Three.js- und WebGPU-Speicherressourcen des Laser-Renderers kontrolliert frei.
 */
export function releaseStorageBuffer(
  renderer: THREE.WebGPURenderer,
  buffer: StorageBufferHandle,
) {
  buffer.dispose();

  const attribute = buffer.value;
  const attributes = (renderer as RendererWithAttributes)._attributes;
  if (attributes?.has(attribute)) attributes.delete(attribute);

  attribute.array = attribute.array.slice(0, 0) as typeof attribute.array;
}
