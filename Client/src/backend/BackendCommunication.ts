import type { RendererBackend } from '../config/rendererBackends';
import type { SceneConfig } from '../model/SceneConfig';
import { validateSceneObjects } from '../model/RendererValidation';

export interface BackendCommunicationContext {
  readonly name: string;
  readonly baseUrl: string;
}

export interface BackendRenderResult {
  readonly image: Blob;
  readonly renderDurationMs?: number;
}

export interface BackendCommunication {
  renderScene(scene: SceneConfig, context: BackendCommunicationContext): Promise<BackendRenderResult>;
  receiveResult(
    result: BackendRenderResult,
    scene: SceneConfig,
    context: BackendCommunicationContext,
  ): Promise<SceneConfig>;
}

export interface SaveSceneResult {
  readonly scene: SceneConfig;
  readonly result?: BackendRenderResult;
}

/**
 * Persists the current scene through a renderer backend and returns the
 * backend-normalized scene that should become the new editor state.
 */
export async function saveScene(
    scene: SceneConfig,
    backend: RendererBackend,
): Promise<SaveSceneResult> {
  const errors = validateSceneObjects(
      scene.objects,
      backend.capabilities,
  ).filter((issue) => issue.severity === 'error');

  if (errors.length > 0) {
    throw new Error(
        `Ungültige Szene: ${errors
            .map((issue) => issue.message)
            .join(' - ')}`,
    );
  }

  const context = {
    name: backend.name,
    baseUrl: backend.baseUrl,
  };

  const communication = backend.strategy.backendCommunication;

  if (!communication) {
    return {
      scene: await scene.clone(),
    };
  }

  const result = await communication.renderScene(scene, context);
  const normalizedScene = await communication.receiveResult(
      result,
      scene,
      context,
  );

  return {
    scene: normalizedScene,
    result,
  };
}