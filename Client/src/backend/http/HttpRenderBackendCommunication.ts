import type { BackendCommunication } from '../BackendCommunication';
import type { ConfigurationObjectJson, SceneConfig } from '../../model/SceneConfig';

export const httpRenderBackendCommunication: BackendCommunication = {
  async renderScene(scene, context) {
    const response = await fetch(apiUrl(context.baseUrl, '/render'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toBackendPayload(scene)),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    return {
      renderDurationMs: renderDurationFromHeaders(response.headers),
      image: await response.blob(),
    };
  },

  async receiveResult(_result, scene) {
    return scene.clone();
  },
};

function apiUrl(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return (await response.text()) || response.statusText;
  }
}

function renderDurationFromHeaders(headers: Headers) {
  const value = headers.get('X-Render-Duration-Ms');
  if (!value) {
    return undefined;
  }

  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function toBackendPayload(scene: SceneConfig) {
  if (!hasObject(scene, 'RenderSettings') || !hasObject(scene, 'ImagePlane') || !hasObject(scene, 'Prism')) {
    return scene.toJson();
  }


  return {
    render: requiredProperties(scene, 'RenderSettings'),
    imagePlane: requiredProperties(scene, 'ImagePlane'),
    light: optionalProperties(scene, 'CircleLight')
      ?? optionalProperties(scene, 'AreaLight')
      ?? missingObject('CircleLight or AreaLight'),
    prism: requiredProperties(scene, 'Prism'),
  };
}

function hasObject(scene: SceneConfig, objectType: string) {
  return scene.objects.some((item: ConfigurationObjectJson) => item.objectType === objectType);
}

function optionalProperties(scene: SceneConfig, objectType: string) {
  const object = scene.objects.find((item: ConfigurationObjectJson) => item.objectType === objectType);
  return object?.properties ?? null;
}

function requiredProperties(scene: SceneConfig, objectType: string) {
  return optionalProperties(scene, objectType) ?? missingObject(objectType);
}

function missingObject(objectType: string): never {
  throw new Error(`${objectType} fehlt in der Szene.`);
}
