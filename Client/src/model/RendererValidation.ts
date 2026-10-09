import type {
  FieldValidation,
  ObjectValidationIssue,
  RendererCapabilities,
  Vector2Value,
  Vector3Value,
} from './RendererCapabilities';
import type { ConfigurationObjectType } from './sceneObjectCatalog';

type ReferenceTarget = {
  objectId?: unknown;
  objectType?: unknown;
  properties?: unknown;
};

type UploadedFileValue = { fileName?: unknown; content?: unknown; sizeBytes?: unknown };

export function validateFieldValue(
  field: string,
  value: unknown,
  rule: FieldValidation,
  properties: Record<string, unknown>,
  referenceTargets?: ReferenceTarget[],
): string | null {
  const typeValid = rule.type === undefined
    || (rule.type === 'number' && typeof value === 'number' && Number.isFinite(value))
    || (rule.type === 'integer' && typeof value === 'number' && Number.isInteger(value))
    || (rule.type === 'string' && typeof value === 'string')
    || (rule.type === 'boolean' && typeof value === 'boolean')
    || (rule.type === 'vector2' && isVector2(value))
    || (rule.type === 'vector3' && isVector3(value))
    || (rule.type === 'array' && Array.isArray(value))
    || (rule.type === 'object' && isRecord(value))
    || (rule.type === 'reference' && isReference(value))
    || (rule.type === 'file' && isUploadedFile(value));
  if (!typeValid) return `${field} hat nicht den erwarteten Typ ${rule.type}.`;

  if (rule.options && typeof value === 'string' && !rule.options.includes(value)) {
    return `${field} muss einer der folgenden Werte sein: ${rule.options.join(', ')}.`;
  }
  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) return `${field} muss mindestens ${rule.min} sein.`;
    if (rule.max !== undefined && value > rule.max) return `${field} darf höchstens ${rule.max} sein.`;
    if (rule.lessThan) {
      const other = valueAtPath(properties, rule.lessThan);
      if (typeof other !== 'number' || value >= other) return `${field} muss kleiner als ${rule.lessThan} sein.`;
    }
  }
  if (rule.nonZero && ((isVector2(value) && vector2Components(value).every((component) => component === 0))
    || (isVector3(value) && vectorComponents(value).every((component) => component === 0)))) {
    return `${field} darf kein Nullvektor sein.`;
  }
  if (rule.type === 'reference' && isReference(value)) {
    const referenceId = referenceIdOf(value);
    if (!referenceId) {
      return rule.allowEmpty ? null : `${field} darf nicht leer sein.`;
    }
    if (referenceTargets) {
      const target = referenceTargets.find((candidate) => candidate.objectId === referenceId);
      if (!target) return `${field} verweist auf ein nicht vorhandenes Objekt.`;
      if (rule.objectTypes?.length && (
        typeof target.objectType !== 'string' || !rule.objectTypes.includes(target.objectType)
      )) {
        return `${field} muss auf einen der Objekttypen ${rule.objectTypes.join(', ')} verweisen.`;
      }
    }
  }
  if (rule.type === 'file' && isUploadedFile(value)) {
    if (!value.content.trim()) {
      return `${field} darf nicht leer sein.`;
    }
    if (rule.maxSizeBytes !== undefined && value.sizeBytes > rule.maxSizeBytes) {
      return `${field} darf hoechstens ${rule.maxSizeBytes} Bytes gross sein.`;
    }
    if (rule.accept?.length) {
      const fileName = value.fileName.toLowerCase();
      const accepted = rule.accept.some((pattern) => (
        pattern.startsWith('.')
          ? fileName.endsWith(pattern.toLowerCase())
          : pattern.toLowerCase() === 'text/plain'
      ));
      if (!accepted) {
        return `${field} muss eine der folgenden Dateiendungen haben: ${rule.accept.join(', ')}.`;
      }
    }
  }
  return null;
}

export function validateConfigurationObject(
  objectType: ConfigurationObjectType,
  properties: unknown,
  capabilities: RendererCapabilities,
  referenceTargets?: ReferenceTarget[],
): ObjectValidationIssue[] {
  const capability = capabilities.objects[objectType];
  if (!capability) {
    return [{
      severity: 'error',
      message: `Objekttyp ${objectType} wird vom ausgewählten Renderer nicht unterstützt.`,
    }];
  }

  const issues: ObjectValidationIssue[] = [];
  const propertyObject = isRecord(properties) ? properties : {};
  if (!isRecord(properties)) {
    issues.push({ severity: 'error', message: `${capability.label}: Eigenschaften müssen ein Objekt sein.` });
  }

  for (const field of capability.required) {
    if (!hasPath(propertyObject, field)) {
      issues.push({ severity: 'error', message: `${capability.label}: Pflichtfeld ${field} fehlt.` });
    }
  }
  for (const [field, rule] of Object.entries(capability.validation ?? {})) {
    const value = valueAtPath(propertyObject, field);
    if (value === undefined || value === null) continue;
    const error = validateFieldValue(field, value, rule, propertyObject, referenceTargets);
    if (error) issues.push({ severity: 'error', message: `${capability.label}: ${error}` });
  }
  const behindError = validateBehindConstraint(
    propertyObject,
    capability.mustBeBehind,
    capabilities,
    referenceTargets,
  );
  if (behindError) {
    issues.push({ severity: 'error', message: `${capability.label}: ${behindError}` });
  }
  if (capability.previewSupported === false) {
    issues.push({
      severity: 'warning',
      message: `${capability.label} wird gespeichert, aber nicht in der Preview dargestellt.`,
    });
  }
  return issues;
}

export function validateSceneObjects(
  objects: Array<{ objectId?: unknown; objectName?: unknown; objectType?: unknown; properties?: unknown }>,
  capabilities: RendererCapabilities,
): ObjectValidationIssue[] {
  const issues: ObjectValidationIssue[] = [];
  const ids = new Set<string>();
  for (const [index, object] of objects.entries()) {
    const prefix = `Objekt ${index + 1}`;
    if (typeof object.objectId !== 'string' || !object.objectId.trim()) {
      issues.push({ severity: 'error', message: `${prefix}: objectId fehlt oder ist ungültig.` });
    } else if (ids.has(object.objectId)) {
      issues.push({ severity: 'error', message: `${prefix}: objectId ${object.objectId} ist doppelt vergeben.` });
    } else {
      ids.add(object.objectId);
    }
    if (typeof object.objectName !== 'string' || !object.objectName.trim()) {
      issues.push({ severity: 'error', message: `${prefix}: objectName fehlt oder ist ungültig.` });
    }
    if (typeof object.objectType !== 'string' || !object.objectType.trim()) {
      issues.push({ severity: 'error', message: `${prefix}: objectType fehlt oder ist ungültig.` });
      continue;
    }
    issues.push(...validateConfigurationObject(object.objectType, object.properties, capabilities, objects));
  }

  for (const [type, capability] of Object.entries(capabilities.objects)) {
    const count = objects.filter((object) => object.objectType === type).length;
    if (capability.minInstances !== undefined && count < capability.minInstances) {
      issues.push({ severity: 'error', message: `${capability.label}: mindestens ${capability.minInstances} Instanz(en) erforderlich.` });
    }
    if (capability.maxInstances !== undefined && count > capability.maxInstances) {
      issues.push({ severity: 'error', message: `${capability.label}: höchstens ${capability.maxInstances} Instanz(en) erlaubt.` });
    }
    for (const exclusiveType of capability.exclusiveWith ?? []) {
      if (type > exclusiveType) continue;
      if (count > 0 && objects.some((object) => object.objectType === exclusiveType)) {
        const exclusiveLabel = capabilities.objects[exclusiveType]?.label ?? exclusiveType;
        issues.push({ severity: 'error', message: `${capability.label}: kann nicht zusammen mit ${exclusiveLabel} verwendet werden.` });
      }
    }
  }
  return issues;
}

export function validateRendererDefaults(capabilities: RendererCapabilities): string[] {
  const errors: string[] = [];
  for (const [objectType, capability] of Object.entries(capabilities.objects)) {
    for (const requiredField of capability.required) {
      if (!hasPath(capability.defaults, requiredField)) {
        errors.push(`${objectType}: Default für Pflichtfeld ${requiredField} fehlt.`);
      }
    }
    for (const [field, rule] of Object.entries(capability.validation ?? {})) {
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        errors.push(`${objectType}.${field}: min darf nicht größer als max sein.`);
      }
      if (rule.type !== 'reference' && (rule.objectTypes !== undefined || rule.allowEmpty !== undefined)) {
        errors.push(`${objectType}.${field}: objectTypes und allowEmpty sind nur für Referenzen erlaubt.`);
      }
      if (rule.type === 'reference') {
        for (const targetType of rule.objectTypes ?? []) {
          if (!capabilities.objects[targetType]) {
            errors.push(`${objectType}.${field}: unbekannter Referenz-Zieltyp ${targetType}.`);
          }
        }
      }
      const value = valueAtPath(capability.defaults, field);
      if (value === undefined) continue;
      if (rule.type === 'file' && isUploadedFile(value) && !value.content.trim()) continue;
      const error = validateFieldValue(field, value, rule, capability.defaults);
      if (error) errors.push(`${objectType}: ${error}`);
    }
    for (const exclusiveType of capability.exclusiveWith ?? []) {
      if (!capabilities.objects[exclusiveType]) {
        errors.push(`${objectType}: unbekannter exklusiver Objekttyp ${exclusiveType}.`);
      }
    }
    if (capability.mustBeBehind) {
      const { referenceObjectType, normalObjectType } = capability.mustBeBehind;
      if (!capabilities.objects[referenceObjectType]) {
        errors.push(`${objectType}: unbekannter Referenz-Objekttyp ${referenceObjectType}.`);
      }
      if (!capabilities.objects[normalObjectType]) {
        errors.push(`${objectType}: unbekannter Normalen-Objekttyp ${normalObjectType}.`);
      }
    }
  }
  return errors;
}

function validateBehindConstraint(
  properties: Record<string, unknown>,
  constraint: RendererCapabilities['objects'][string]['mustBeBehind'],
  capabilities: RendererCapabilities,
  objects?: ReferenceTarget[],
) {
  if (!constraint || !objects) return null;
  const reference = objects.find((object) => object.objectType === constraint.referenceObjectType);
  const normalSource = objects.find((object) => object.objectType === constraint.normalObjectType);
  if (!reference || !normalSource || !isRecord(reference.properties) || !isRecord(normalSource.properties)) {
    return null;
  }

  const center = properties.center;
  const referenceCenter = reference.properties.center;
  const normal = normalSource.properties.normal;
  if (!isVector3(center) || !isVector3(referenceCenter) || !isVector3(normal)) return null;

  const [x, y, z] = vectorComponents(center);
  const [referenceX, referenceY, referenceZ] = vectorComponents(referenceCenter);
  const [normalX, normalY, normalZ] = vectorComponents(normal);
  const normalLength = Math.hypot(normalX, normalY, normalZ);
  if (normalLength <= 1e-12) return null;
  const signedDistance = ((x - referenceX) * normalX
    + (y - referenceY) * normalY
    + (z - referenceZ) * normalZ) / normalLength;
  const minimumDistanceMm = constraint.minimumDistanceMm ?? 0;
  if (signedDistance + 1e-6 >= minimumDistanceMm) return null;

  const referenceLabel = capabilities.objects[constraint.referenceObjectType]?.label
    ?? constraint.referenceObjectType;
  return `center muss entlang der optischen Achse mindestens ${minimumDistanceMm} mm hinter ${referenceLabel} liegen.`;
}

function hasPath(source: Record<string, unknown>, path: string) {
  const value = valueAtPath(source, path);
  return value !== undefined && value !== null;
}

function valueAtPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function isVector2(value: unknown): value is Vector2Value {
  return (Array.isArray(value)
    && value.length === 2
    && value.every((component) => typeof component === 'number' && Number.isFinite(component)))
    || (isRecord(value)
      && typeof value.x === 'number' && Number.isFinite(value.x)
      && typeof value.y === 'number' && Number.isFinite(value.y));
}

export function isVector3(value: unknown): value is Vector3Value {
  return (Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component)))
    || (isRecord(value)
      && typeof value.x === 'number' && Number.isFinite(value.x)
      && typeof value.y === 'number' && Number.isFinite(value.y)
      && typeof value.z === 'number' && Number.isFinite(value.z));
}

function isReference(value: unknown): value is { $ref?: string; objectId?: string } {
  return isRecord(value)
    && (typeof value.$ref === 'string' || typeof value.objectId === 'string');
}

function isUploadedFile(value: unknown): value is { fileName: string; content: string; sizeBytes: number } {
  if (!isRecord(value)) return false;
  const file = value as UploadedFileValue;
  return typeof file.fileName === 'string'
    && typeof file.content === 'string'
    && typeof file.sizeBytes === 'number'
    && Number.isFinite(file.sizeBytes)
    && file.sizeBytes >= 0;
}

function referenceIdOf(value: { $ref?: string; objectId?: string }) {
  return value.$ref ?? value.objectId ?? '';
}

export function vector2Components(value: Vector2Value): [number, number] {
  return Array.isArray(value) ? [...value] : [value.x, value.y];
}

export function vectorComponents(value: Vector3Value): [number, number, number] {
  return Array.isArray(value) ? [...value] : [value.x, value.y, value.z];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
