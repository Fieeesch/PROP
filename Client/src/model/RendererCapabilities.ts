import type { ConfigurationObjectType } from './sceneObjectCatalog';

export interface RendererCapabilities {
  preview: {
    maxBounces: number;
  };
  objects: Record<ConfigurationObjectType, ObjectCapability>;
}

export interface ObjectCapability {
  label: string;
  required: string[];
  optional?: string[];
  hiddenProperties?: string[];
  defaults: Record<string, unknown>;
  addable?: boolean;
  deletable?: boolean;
  mustBeBehind?: {
    referenceObjectType: ConfigurationObjectType;
    normalObjectType: ConfigurationObjectType;
    minimumDistanceMm?: number;
  };
  maxInstances?: number;
  minInstances?: number;
  exclusiveWith?: ConfigurationObjectType[];
  previewSupported?: boolean;
  validation?: Record<string, FieldValidation>;
}

export interface FieldValidation {
  label?: string;
  description?: string;
  gpuMemorySensitive?: boolean;
  type?: 'number' | 'integer' | 'string' | 'boolean' | 'vector2' | 'vector3' | 'array' | 'object' | 'reference' | 'file';
  control?: 'angle';
  min?: number;
  max?: number;
  lessThan?: string;
  nonZero?: boolean;
  objectTypes?: string[];
  allowEmpty?: boolean;
  options?: string[];
  lockedComponents?: Array<'x' | 'y' | 'z'>;
  accept?: string[];
  maxSizeBytes?: number;
}

export type Vector2Value = [number, number] | { x: number; y: number };
export type Vector3Value = [number, number, number] | { x: number; y: number; z: number };

export interface ObjectValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}
