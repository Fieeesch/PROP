import type { RendererCapabilities } from '../model/RendererCapabilities';
import { isRendererCapabilities } from '../model/RendererCapabilitiesValidation';
import { validateRendererDefaults } from '../model/RendererValidation';
import {
  ConfigurationObjectCategory,
  SceneConfig,
  createUuid,
  type ConfigurationObjectJson,
} from '../model/SceneConfig';
import { getRendererStrategy, hasRendererStrategy, type RendererStrategy } from '../preview/RendererStrategy';

export interface RendererBackend {
  id: string;
  name: string;
  baseUrl: string;
  strategy: RendererStrategy;
  capabilities: RendererCapabilities;
}

export let rendererBackends: RendererBackend[] = [];

export function createDefaultSceneForRenderer(renderer: RendererBackend): SceneConfig {
  const objects: ConfigurationObjectJson[] = [];

  for (const [objectType, capability] of Object.entries(renderer.capabilities.objects)) {
    const instanceCount = capability.minInstances ?? 0;
    for (let index = 0; index < instanceCount; index += 1) {
      objects.push({
        objectId: createUuid(),
        objectName: instanceCount === 1 ? capability.label : `${capability.label} ${index + 1}`,
        objectType,
        objectCategory: ConfigurationObjectCategory.Additional,
        previewSupported: capability.previewSupported ?? true,
        properties: structuredClone(capability.defaults),
      });
    }
  }

  return new SceneConfig(1, objects);
}

export async function loadRendererBackends(): Promise<void> {
  const configUrl = import.meta.env.VITE_RENDERER_BACKENDS_FILE;
  if (typeof configUrl !== 'string' || !configUrl.trim()) {
    throw new Error('VITE_RENDERER_BACKENDS_FILE ist nicht konfiguriert.');
  }

  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`Renderer-Konfiguration konnte nicht geladen werden (HTTP ${response.status}).`);
  }

  rendererBackends = parseRendererBackends(await response.json());
}

function parseRendererBackends(value: unknown): RendererBackend[] {
  if (!Array.isArray(value)) {
    throw new Error('Die Renderer-Konfiguration muss ein Array sein.');
  }

  const backends = value.flatMap((entry, index): RendererBackend[] => {
    if (!isRendererBackendConfig(entry)) {
      return [];
    }

    const name = entry.name.trim();
    const baseUrl = typeof entry.baseUrl === 'string'
      ? trimTrailingSlash(entry.baseUrl.trim())
      : '';
    const strategyId = entry.strategyId.trim();
    if (!name || !strategyId) {
      return [];
    }
    if (!hasRendererStrategy(strategyId)) {
      throw new Error(`Renderer "${name}" verwendet die unbekannte Renderer-Strategie "${strategyId}".`);
    }
    const strategy = getRendererStrategy(strategyId);
    if (strategy.backendCommunication && !baseUrl) {
      throw new Error(`Renderer "${name}" benoetigt eine baseUrl.`);
    }
    const defaultErrors = validateRendererDefaults(entry.capabilities);
    if (defaultErrors.length > 0) {
      throw new Error(`Renderer "${name}" enthält ungültige Defaults: ${defaultErrors.join(' - ')}`);
    }

    return [{
      id: `renderer-${index}`,
      name,
      baseUrl,
      strategy,
      capabilities: entry.capabilities,
    }];
  });

  if (backends.length === 0) {
    throw new Error('Die Renderer-Konfiguration enthält keinen gültigen Renderer.');
  }

  return backends;
}

function isRendererBackendConfig(
  value: unknown,
): value is {
  name: string;
  baseUrl?: string;
  strategyId: string;
  capabilities: RendererCapabilities;
} {
  return isRecord(value)
    && 'name' in value
    && typeof value.name === 'string'
    && (!('baseUrl' in value) || typeof value.baseUrl === 'string')
    && 'strategyId' in value
    && typeof value.strategyId === 'string'
    && 'capabilities' in value
    && isRendererCapabilities(value.capabilities);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
