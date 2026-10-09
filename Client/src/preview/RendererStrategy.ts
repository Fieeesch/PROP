import type * as THREE from 'three/webgpu';

import type { BackendCommunication } from '../backend/BackendCommunication';
import type { RendererCapabilities } from '../model/RendererCapabilities';
import type { SceneConfig } from '../model/SceneConfig';
import { laserWaveRendererStrategy } from './laser-wave/LaserWavePreviewStrategy';
import { prismRayRendererStrategy } from './prism-ray/PrismRayPreviewStrategy';
import { spectralPathtracerRendererStrategy } from './spectral-pathtracer/SpectralPathtracerPreviewStrategy';

export interface PreviewContext {
  readonly renderer: THREE.WebGPURenderer;
  requestRender(): void;
  reportRenderDuration(durationMs: number): void;
  reportRenderState(rendering: boolean): void;
  reportGpuError(error: unknown, fallbackTitle?: string): void;
  updateObjectProperty(objectType: string, key: string, value: unknown): void;
  updateObjectPropertyAndRerender(objectType: string, key: string, value: unknown): void;
}

export interface RendererStrategy {
  readonly id: string;
  readonly backendCommunication?: BackendCommunication;
  create(
    scene: SceneConfig,
    capabilities: RendererCapabilities,
    context: PreviewContext,
  ): PreviewInstance;
}

/** Owns the strategy-specific preview tree and updates it in place. */
export interface PreviewInstance {
  readonly object3d: THREE.Object3D;
  readonly insetFrameRevision?: number;
  readonly insetContentAspect?: number;
  update(scene: SceneConfig, capabilities: RendererCapabilities): void;
  configureInsetCamera?(
    camera: THREE.OrthographicCamera,
    aspect: number,
  ): boolean;
  dispose(): void;
}

const rendererStrategies = new Map<string, RendererStrategy>([
  [prismRayRendererStrategy.id, prismRayRendererStrategy],
  [spectralPathtracerRendererStrategy.id, spectralPathtracerRendererStrategy],
  [laserWaveRendererStrategy.id, laserWaveRendererStrategy],
]);

export function hasRendererStrategy(id: string): boolean {
  return rendererStrategies.has(id);
}

export function getRendererStrategy(id: string): RendererStrategy {
  const strategy = rendererStrategies.get(id);
  if (!strategy) {
    throw new Error(`Unbekannte Renderer-Strategie: ${id}`);
  }

  return strategy;
}
