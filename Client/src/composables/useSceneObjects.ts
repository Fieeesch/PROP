import { computed, ref, toRaw, type ComputedRef, type Ref } from 'vue';
import {
  type ObjectCapability,
  type ObjectValidationIssue,
  type RendererCapabilities,
} from '../model/RendererCapabilities';
import { validateConfigurationObject } from '../model/RendererValidation';
import { resolvedSensorCenterForScene } from '../preview/laser-wave/LensToSensorCompute';
import {
  ConfigurationObjectCategory,
  SceneConfig,
  createUuid,
  type ConfigurationObjectJson,
} from '../model/SceneConfig';

export interface StatusValueChange {
  key: string;
  label: string;
  from: string;
  to: string;
  note?: string;
}

export interface StatusChangeGroup {
  mergeKey: string;
  changes: StatusValueChange[];
}

type StatusReporter = (message: string, changeGroup?: StatusChangeGroup) => void;

/**
 * Centralizes object-list actions for the scene editor.
 *
 * Object types, defaults and limits are supplied by the selected renderer's
 * capabilities. The scene itself only owns the configured object instances.
 */
export function useSceneObjects(
  scene: Ref<SceneConfig>,
  capabilities: ComputedRef<RendererCapabilities>,
  setStatus: StatusReporter,
) {
  const editingObjectId = ref<string | null>(null);
  const draftObjectName = ref('');
  const pendingClearedValues = new Map<string, {
    from: unknown;
    automaticChanges: StatusValueChange[];
  }>();
  const sceneObjects = computed(() => scene.value.objects);
  const addableObjectTypes = computed(() => Object.entries(capabilities.value.objects)
    .filter(([, capability]) => capability.addable !== false)
    .filter(([type, capability]) => canAddObjectType(type, capability))
    .map(([type, capability]) => ({
      type,
      label: capability.label,
    })));

  function objectTitle(object: ConfigurationObjectJson) {
    return object.objectName;
  }

  function objectTypeLabel(object: ConfigurationObjectJson) {
    return object.objectType;
  }

  function objectIdFor(object: ConfigurationObjectJson) {
    return object.objectId ?? object.objectName;
  }

  function canDeleteObject(object: ConfigurationObjectJson) {
    return scene.value.objects.includes(object)
      && capabilities.value.objects[object.objectType]?.deletable !== false;
  }

  function isObjectSupported(object: ConfigurationObjectJson) {
    return Boolean(capabilities.value.objects[object.objectType]);
  }

  function objectValidationIssues(object: ConfigurationObjectJson): ObjectValidationIssue[] {
    return validateConfigurationObject(
      object.objectType,
      propertiesForValidation(object),
      capabilities.value,
      scene.value.objects,
    );
  }

  function objectIssueSummary(object: ConfigurationObjectJson) {
    return objectValidationIssues(object).map((issue) => issue.message).join('\n');
  }

  function hasObjectErrors(object: ConfigurationObjectJson) {
    return objectValidationIssues(object).some((issue) => issue.severity === 'error');
  }

  function hasObjectWarnings(object: ConfigurationObjectJson) {
    return objectValidationIssues(object).some((issue) => issue.severity === 'warning');
  }

  function addObject(type: string) {
    const capability = capabilities.value.objects[type];
    if (!capability) {
      setStatus(`${type} wird vom ausgewaehlten Renderer nicht unterstuetzt`);
      return;
    }
    if (!canAddObjectType(type, capability)) {
      setStatus(objectTypeLimitMessage(type, capability));
      return;
    }

    const object: ConfigurationObjectJson = {
      objectId: createUuid(),
      objectName: uniqueObjectName(capability.label),
      objectType: type,
      objectCategory: ConfigurationObjectCategory.Additional,
      previewSupported: capability.previewSupported ?? true,
      properties: structuredCloneValue(capability.defaults),
    };

    scene.value.objects.push(object);
    setStatus(`${object.objectName} hinzugefuegt`);
  }

  function duplicateObject(object: ConfigurationObjectJson) {
    const capability = capabilities.value.objects[object.objectType];
    if (!capability) {
      return;
    }
    if (!canAddObjectType(object.objectType, capability)) {
      setStatus(objectTypeLimitMessage(object.objectType, capability));
      return;
    }

    const duplicate = structuredCloneObject(toRaw(object));
    const baseName = object.objectName.replace(/Copy\d+$/, '');
    let copyIndex = 1;
    let nextName = `${baseName}Copy${copyIndex}`;
    const existingNames = new Set(scene.value.objects.map((item) => item.objectName));

    while (existingNames.has(nextName)) {
      copyIndex += 1;
      nextName = `${baseName}Copy${copyIndex}`;
    }

    duplicate.objectId = createUuid();
    duplicate.objectName = nextName;
    duplicate.objectCategory = ConfigurationObjectCategory.Additional;
    scene.value.objects.push(duplicate);
    setStatus(`${duplicate.objectName} hinzugefuegt`);
  }

  function deleteObject(object: ConfigurationObjectJson) {
    if (!canDeleteObject(object)) {
      setStatus(`${object.objectName} kann nicht gelöscht werden`);
      return;
    }
    scene.value.objects = scene.value.objects.filter((item) => item !== object);
    setStatus(`${object.objectName} geloescht`);
  }

  function startRenameObject(object: ConfigurationObjectJson) {
    editingObjectId.value = objectIdFor(object);
    draftObjectName.value = object.objectName;
  }

  function commitRenameObject(object: ConfigurationObjectJson) {
    if (editingObjectId.value !== objectIdFor(object)) {
      return;
    }

    const nextName = draftObjectName.value.trim();
    if (nextName && nextName !== object.objectName) {
      const previousName = object.objectName;
      object.objectName = nextName;
      setStatus(`${previousName} in ${nextName} umbenannt`);
    }

    editingObjectId.value = null;
  }

  function cancelRenameObject() {
    editingObjectId.value = null;
  }

  function configurationTargetFor(object: ConfigurationObjectJson) {
    if (!object.properties || typeof object.properties !== 'object' || Array.isArray(object.properties)) {
      object.properties = {};
    }
    return object.properties as Record<string, unknown>;
  }

  function propertiesForValidation(object: ConfigurationObjectJson) {
    return object.properties;
  }

  function updateObjectProperty(
    object: ConfigurationObjectJson,
    update: { key: string; value: unknown },
  ) {
    const properties = configurationTargetFor(object);
    const previousValue = properties[update.key];
    const mergeKey = `${objectIdFor(object)}:${update.key}`;
    const automaticChanges: StatusValueChange[] = [];
    properties[update.key] = update.value;
    if (object.objectType === 'Sensor' && update.key === 'center') {
      const autoFocusWasEnabled = properties.autoFocus === true;
      properties.autoFocus = false;
      if (autoFocusWasEnabled) {
        automaticChanges.push({
          key: `${objectIdFor(object)}:autoFocus`,
          label: `${object.objectName}: Autofokus`,
          from: 'An',
          to: 'Aus',
          note: 'automatisch',
        });
      }
    } else if (
      object.objectType === 'Sensor'
      && update.key === 'autoFocus'
      && update.value === true
    ) {
      const automaticChange = updateAutoFocusedSensorCenter();
      if (automaticChange) automaticChanges.push(automaticChange);
    } else if (object.objectType === 'Lens' && update.key === 'center') {
      const automaticChange = updateAutoFocusedSensorCenter();
      if (automaticChange) automaticChanges.push(automaticChange);
    }

    const pendingChange = pendingClearedValues.get(mergeKey);
    if (isClearedEditorValue(update.value)) {
      pendingClearedValues.set(mergeKey, {
        from: pendingChange?.from ?? previousValue,
        automaticChanges: mergeStatusChanges(
          pendingChange?.automaticChanges ?? [],
          automaticChanges,
        ),
      });
      return;
    }

    pendingClearedValues.delete(mergeKey);
    const changes = [
      {
        key: mergeKey,
        label: `${object.objectName}: ${propertyLabel(object, update.key)}`,
        from: formatStatusValue(pendingChange?.from ?? previousValue),
        to: formatStatusValue(update.value),
      },
      ...mergeStatusChanges(
        pendingChange?.automaticChanges ?? [],
        automaticChanges,
      ),
    ];
    setStatus(formatStatusChanges(changes), { mergeKey, changes });
  }

  function updateAutoFocusedSensorCenter(): StatusValueChange | null {
    const sensor = scene.value.objects.find((object) => object.objectType === 'Sensor');
    if (!sensor) return null;
    const properties = configurationTargetFor(sensor);
    if (properties.autoFocus !== true) return null;

    const previousZ = vectorZ(properties.center);
    const focusedCenter = resolvedSensorCenterForScene(scene.value);
    properties.center = vectorWithZ(properties.center, focusedCenter.z);
    return {
      key: `${objectIdFor(sensor)}:center:z`,
      label: `${sensor.objectName}: Z`,
      from: formatStatusValue(previousZ),
      to: formatStatusValue(focusedCenter.z),
      note: 'automatisch',
    };
  }

  function propertyLabel(object: ConfigurationObjectJson, key: string) {
    return capabilities.value.objects[object.objectType]?.validation?.[key]?.label ?? key;
  }

  function uniqueObjectName(baseName: string) {
    const existingNames = new Set(scene.value.objects.map((item) => item.objectName));
    let nextName = baseName;
    let index = 1;

    while (existingNames.has(nextName)) {
      index += 1;
      nextName = `${baseName} ${index}`;
    }

    return nextName;
  }

  function canAddObjectType(type: string, capability: ObjectCapability) {
    if (capability.maxInstances !== undefined
      && scene.value.objects.filter((object) => object.objectType === type).length >= capability.maxInstances) {
      return false;
    }
    return !scene.value.objects.some((object) => capability.exclusiveWith?.includes(object.objectType));
  }

  function objectTypeLimitMessage(type: string, capability: ObjectCapability) {
    if (capability.exclusiveWith?.some((exclusiveType) => scene.value.objects.some((object) => object.objectType === exclusiveType))) {
      return `${capability.label} kann nicht zusammen mit ${capability.exclusiveWith.join(', ')} angelegt werden`;
    }
    if (capability.maxInstances !== undefined) {
      return `${capability.label} kann fuer diesen Renderer nur ${capability.maxInstances}x angelegt werden`;
    }
    return `${type} kann fuer die aktuelle Szene nicht hinzugefuegt werden`;
  }

  return {
    addObject,
    addableObjectTypes,
    canDeleteObject,
    draftObjectName,
    editingObjectId,
    sceneObjects,
    cancelRenameObject,
    commitRenameObject,
    configurationTargetFor,
    deleteObject,
    duplicateObject,
    hasObjectErrors,
    hasObjectWarnings,
    isObjectSupported,
    objectIssueSummary,
    objectIdFor,
    objectTitle,
    objectTypeLabel,
    startRenameObject,
    updateObjectProperty,
  };
}

function structuredCloneObject(object: ConfigurationObjectJson): ConfigurationObjectJson {
  return structuredCloneValue(object) as ConfigurationObjectJson;
}

function structuredCloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeStatusChanges(
  existing: StatusValueChange[],
  incoming: StatusValueChange[],
) {
  const merged = existing.map((change) => ({ ...change }));
  for (const change of incoming) {
    const previous = merged.find((candidate) => candidate.key === change.key);
    if (previous) {
      previous.label = change.label;
      previous.to = change.to;
      previous.note = change.note;
    } else {
      merged.push({ ...change });
    }
  }
  return merged;
}

function formatStatusChanges(changes: StatusValueChange[]) {
  return changes.map((change) => (
    `${change.label} ${change.from} → ${change.to}`
      + (change.note ? ` (${change.note})` : '')
  )).join(' · ');
}

function isClearedEditorValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.some(isClearedEditorValue);
  if (value && typeof value === 'object') {
    const vector = value as Record<string, unknown>;
    return ['x', 'y', 'z']
      .filter((component) => component in vector)
      .some((component) => isClearedEditorValue(vector[component]));
  }
  return false;
}

function formatStatusValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'An' : 'Aus';
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString('de-DE', { maximumFractionDigits: 6 })
      : String(value);
  }
  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 45)}…` : value;
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatStatusValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const vector = value as Record<string, unknown>;
    if ('x' in vector && 'y' in vector) {
      const components = [vector.x, vector.y];
      if ('z' in vector) components.push(vector.z);
      return `(${components.map(formatStatusValue).join(', ')})`;
    }
    try {
      const serialized = JSON.stringify(value);
      if (!serialized) return 'Objekt';
      return serialized.length > 48 ? `${serialized.slice(0, 45)}…` : serialized;
    } catch {
      return 'Objekt';
    }
  }
  return value === null ? 'Null' : 'Nicht gesetzt';
}

function vectorZ(value: unknown) {
  if (Array.isArray(value)) return value[2];
  if (value && typeof value === 'object' && 'z' in value) {
    return (value as { z?: unknown }).z;
  }
  return undefined;
}

function vectorWithZ(value: unknown, z: number) {
  if (Array.isArray(value)) return [value[0] ?? 0, value[1] ?? 0, z];
  if (value && typeof value === 'object') {
    return { ...(value as Record<string, unknown>), z };
  }
  return [0, 0, z];
}
