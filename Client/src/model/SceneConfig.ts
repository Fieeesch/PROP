import type { AreaLightJson } from '../preview/prism-ray/AreaLight';
import type { RectPlaneJson } from '../preview/prism-ray/RectPlane';
import {
  ConfigurationObjectCategory,
  cloneConfigurationObject,
  createUuid,
  type ConfigurationObjectJson,
} from './sceneObjectCatalog';

export {
  ConfigurationObjectCategory,
  createUuid,
  type ConfigurationObjectJson,
  type ConfigurationObjectType,
} from './sceneObjectCatalog';

export interface RenderSettingsJson {
  recursionDepth: number;
  lambdaMin: number;
  lambdaMax: number;
  spectrumBins: number;
  lightPower: number;
  lightSamples: number;
  imageExposure: number;
  imageWidth: number;
  imageHeight: number;
  rngSeedEnabled?: boolean;
  rngSeed?: number;
}

export interface RenderRequestJson {
  render: RenderSettingsJson;
  imagePlane: RectPlaneJson;
  light: AreaLightJson;
  prism: PrismJson;
}

export interface PrismJson {
  position: [number, number] | { x: number; y: number };
  prismAngleDeg: number;
  rotationDeg: number;
  radius: number;
  zDepth: number;
  material: string;
}

export interface SceneConfigJson {
  version: number;
  renderer?: string;
  objects: ConfigurationObjectJson[];
}

export class SceneConfig {
  constructor(
    public version = 1,
    public objects: ConfigurationObjectJson[] = [],
  ) {}

  static createDefault(): SceneConfig {
    return new SceneConfig(1, []);
  }

  static fromJson(value: unknown): SceneConfig {
    if (!isPropertiesObject(value)) {
      throw new Error('Die importierte JSON-Datei muss ein Objekt enthalten.');
    }

    if ('render' in value && 'imagePlane' in value && 'light' in value && 'prism' in value) {
      return SceneConfig.fromRenderRequest(value as unknown as RenderRequestJson);
    }

    if (!Array.isArray(value.objects)) {
      throw new Error('Die importierte Szene muss ein objects-Array enthalten.');
    }

    value.objects.forEach((object, index) => {
      if (!isPropertiesObject(object)) throw new Error(`Objekt ${index + 1} ist kein gültiges JSON-Objekt.`);
      if (typeof object.objectId !== 'string' || !object.objectId.trim()) throw new Error(`Objekt ${index + 1}: objectId fehlt oder ist ungültig.`);
      if (typeof object.objectName !== 'string' || !object.objectName.trim()) throw new Error(`Objekt ${index + 1}: objectName fehlt oder ist ungültig.`);
      if (typeof object.objectType !== 'string' || !object.objectType.trim()) throw new Error(`Objekt ${index + 1}: objectType fehlt oder ist ungültig.`);
      if (!isPropertiesObject(object.properties)) throw new Error(`Objekt ${index + 1}: properties muss ein Objekt sein.`);
    });

    return new SceneConfig(
      typeof value.version === 'number' ? value.version : 1,
      (value.objects as ConfigurationObjectJson[]).map((object) => (
        migrateConfigurationObject(cloneConfigurationObject(object))
      )),
    );
  }

  static fromRenderRequest(value: RenderRequestJson): SceneConfig {
    return new SceneConfig(1, [
      createObject('Render Settings', 'RenderSettings', {
        rngSeedEnabled: false,
        rngSeed: 1,
        ...value.render,
      }),
      createObject('Image Plane', 'ImagePlane', value.imagePlane),
      createObject('Prism', 'Prism', value.prism),
      createObject('Circle Light', 'CircleLight', value.light),
    ]);
  }

  clone(): SceneConfig {
    return new SceneConfig(
      this.version,
      this.objects.map(cloneConfigurationObject),
    );
  }

  toJson(): SceneConfigJson {
    return {
      version: this.version,
      objects: this.objects.map(cloneConfigurationObject),
    };
  }

}

function createObject(
  objectName: string,
  objectType: string,
  properties: object,
): ConfigurationObjectJson {
  return {
    objectId: createUuid(),
    objectName,
    objectType,
    objectCategory: ConfigurationObjectCategory.Additional,
    previewSupported: true,
    properties: structuredClone(properties) as Record<string, unknown>,
  };
}

function migrateConfigurationObject(object: ConfigurationObjectJson): ConfigurationObjectJson {
  if (object.objectType === 'RenderSettings') {
    const properties = isPropertiesObject(object.properties) ? object.properties : {};
    object.properties = {
      rngSeedEnabled: false,
      rngSeed: 1,
      ...properties,
    };
  }
  return object;
}

function isPropertiesObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
