import type { RendererCapabilities } from './RendererCapabilities';

export function isRendererCapabilities(value: unknown): value is RendererCapabilities {
  if (!isRecord(value)
    || !isRecord(value.preview)
    || typeof value.preview.maxBounces !== 'number'
    || !isRecord(value.objects)) {
    return false;
  }

  return Object.values(value.objects).every((capability) => (
    isRecord(capability)
    && typeof capability.label === 'string'
    && Array.isArray(capability.required)
    && capability.required.every((field) => typeof field === 'string')
    && (capability.hiddenProperties === undefined || (
      Array.isArray(capability.hiddenProperties)
      && capability.hiddenProperties.every((field) => typeof field === 'string')
    ))
    && isRecord(capability.defaults)
    && (capability.deletable === undefined || typeof capability.deletable === 'boolean')
    && (capability.mustBeBehind === undefined || (
      isRecord(capability.mustBeBehind)
      && typeof capability.mustBeBehind.referenceObjectType === 'string'
      && typeof capability.mustBeBehind.normalObjectType === 'string'
      && (capability.mustBeBehind.minimumDistanceMm === undefined || (
        typeof capability.mustBeBehind.minimumDistanceMm === 'number'
        && Number.isFinite(capability.mustBeBehind.minimumDistanceMm)
        && capability.mustBeBehind.minimumDistanceMm >= 0
      ))
    ))
    && (capability.minInstances === undefined || (typeof capability.minInstances === 'number' && Number.isInteger(capability.minInstances) && capability.minInstances >= 0))
    && (capability.maxInstances === undefined || (typeof capability.maxInstances === 'number' && Number.isInteger(capability.maxInstances) && capability.maxInstances >= 0))
    && (capability.exclusiveWith === undefined || (
      Array.isArray(capability.exclusiveWith)
      && capability.exclusiveWith.every((objectType) => typeof objectType === 'string')
    ))
    && (capability.validation === undefined || (
      isRecord(capability.validation)
      && Object.values(capability.validation).every(isFieldValidation)
    ))
  ));
}

function isFieldValidation(value: unknown) {
  const allowedTypes = ['number', 'integer', 'string', 'boolean', 'vector2', 'vector3', 'array', 'object', 'reference', 'file'];
  return isRecord(value)
    && (value.label === undefined || typeof value.label === 'string')
    && (value.description === undefined || typeof value.description === 'string')
    && (value.gpuMemorySensitive === undefined || typeof value.gpuMemorySensitive === 'boolean')
    && (value.type === undefined || (typeof value.type === 'string' && allowedTypes.includes(value.type)))
    && (value.control === undefined || value.control === 'angle')
    && (value.min === undefined || typeof value.min === 'number')
    && (value.max === undefined || typeof value.max === 'number')
    && (value.lessThan === undefined || typeof value.lessThan === 'string')
    && (value.nonZero === undefined || typeof value.nonZero === 'boolean')
    && (value.objectTypes === undefined || (
      Array.isArray(value.objectTypes)
      && value.objectTypes.every((objectType) => typeof objectType === 'string')
    ))
    && (value.allowEmpty === undefined || typeof value.allowEmpty === 'boolean')
    && (value.options === undefined || (
      Array.isArray(value.options)
      && value.options.every((option) => typeof option === 'string')
    ))
    && (value.lockedComponents === undefined || (
      Array.isArray(value.lockedComponents)
      && value.lockedComponents.every((component) => (
        component === 'x' || component === 'y' || component === 'z'
      ))
    ))
    && (value.accept === undefined || (
      Array.isArray(value.accept)
      && value.accept.every((option) => typeof option === 'string')
    ))
    && (value.maxSizeBytes === undefined || (
      typeof value.maxSizeBytes === 'number'
      && Number.isInteger(value.maxSizeBytes)
      && value.maxSizeBytes > 0
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
