export type ConfigurationObjectType = string;

export enum ConfigurationObjectCategory {
  Additional = 'additional',
}

export interface ConfigurationObjectJson {
  objectId: string;
  objectName: string;
  objectType: ConfigurationObjectType;
  objectCategory?: ConfigurationObjectCategory;
  previewSupported?: boolean;
  properties: unknown;
}

export function cloneConfigurationObject(object: ConfigurationObjectJson): ConfigurationObjectJson {
  return {
    ...object,
    objectId: object.objectId ?? createUuid(),
    objectCategory: ConfigurationObjectCategory.Additional,
    properties: cloneJsonValue(object.properties),
  };
}

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export function createUuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
