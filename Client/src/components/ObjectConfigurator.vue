<script setup lang="ts">
import { onBeforeUnmount, reactive, watch } from 'vue';
import { Trash2 } from '@lucide/vue';
import type { ConfigurationObjectJson } from '../model/SceneConfig';
import type { FieldValidation } from '../model/RendererCapabilities';
import { isVector2, isVector3, validateFieldValue, vector2Components, vectorComponents } from '../model/RendererValidation';
import ValidationTooltip from './ValidationTooltip.vue';

type JsonObject = Record<string, unknown>;
type ReferenceValue = { $ref?: string; objectId?: string };
type FileValue = { fileName?: string; content?: string; sizeBytes?: number };
type EditorType = 'number' | 'string' | 'select' | 'boolean' | 'vector2' | 'vector3' | 'reference' | 'file' | 'json' | 'unsupported';

const props = defineProps<{
  target: JsonObject;
  defaults?: JsonObject;
  objects: ConfigurationObjectJson[];
  instanceId: string;
  validation?: Record<string, FieldValidation>;
  hiddenProperties?: string[];
}>();

const emit = defineEmits<{
  'update-property': [update: { key: string; value: unknown }];
  'validation-state': [valid: boolean];
}>();

const fieldErrors = reactive<Record<string, string>>({});

watch(
  [() => props.target, () => props.validation, () => props.objects],
  validateAllFields,
  { deep: true, immediate: true },
);

watch(
  fieldErrors,
  () => emit('validation-state', Object.keys(fieldErrors).length === 0),
  { deep: true, immediate: true },
);

onBeforeUnmount(() => emit('validation-state', true));

function propertyEntries() {
  const hiddenProperties = new Set(props.hiddenProperties ?? []);
  return Object.entries(props.target).filter(([key]) => (
    key !== 'objectId' && !hiddenProperties.has(key)
  ));
}

function fieldLabelFor(key: string) {
  const configuredLabel = props.validation?.[key]?.label;
  if (configuredLabel) return configuredLabel;
  if (key === 'spectrumBins') return 'spectralResolution';
  return key;
}

function fieldDescriptionFor(key: string) {
  return props.validation?.[key]?.description ?? '';
}

function editorTypeFor(key: string, value: unknown): EditorType {
  const configuredType = props.validation?.[key]?.type;
  if (configuredType === 'string' && optionsFor(key).length > 0) return 'select';
  if (configuredType === 'number' || configuredType === 'integer') return 'number';
  if (configuredType === 'string' || configuredType === 'boolean' || configuredType === 'vector2' || configuredType === 'vector3') {
    return configuredType;
  }
  if (configuredType === 'reference') return 'reference';
  if (configuredType === 'file') return 'file';
  if (configuredType === 'array' || configuredType === 'object') return 'json';

  if (isReference(value)) return 'reference';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (isVector2(value)) return 'vector2';
  if (isVector3(value)) return 'vector3';
  if (Array.isArray(value) || isPlainObject(value)) return 'json';
  return 'unsupported';
}

function objectIdFor(object: ConfigurationObjectJson) {
  return object.objectId;
}

function optionLabel(object: ConfigurationObjectJson) {
  return `${object.objectType}: ${object.objectName}`;
}

function referenceCandidatesFor(key: string) {
  const objectTypes = props.validation?.[key]?.objectTypes;
  return objectTypes?.length
    ? props.objects.filter((object) => objectTypes.includes(object.objectType))
    : props.objects;
}

function referenceCanBeEmpty(key: string) {
  const rule = props.validation?.[key];
  return rule?.type !== 'reference' || rule.allowEmpty === true;
}

function isReference(value: unknown): value is ReferenceValue {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (typeof (value as ReferenceValue).$ref === 'string' || typeof (value as ReferenceValue).objectId === 'string'),
  );
}

function referenceValue(value: unknown) {
  return isReference(value) ? value.$ref ?? value.objectId ?? '' : '';
}

function setNumberProperty(key: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : input.value;
  commitIfValid(key, value);
}

function setStringProperty(key: string, event: Event) {
  commitIfValid(key, (event.target as HTMLInputElement).value);
}

function setSelectProperty(key: string, event: Event) {
  commitIfValid(key, (event.target as HTMLSelectElement).value);
}

function setBooleanProperty(key: string, event: Event) {
  commitIfValid(key, (event.target as HTMLInputElement).checked);
}

function setReferenceProperty(key: string, event: Event) {
  commitIfValid(key, { $ref: (event.target as HTMLSelectElement).value });
}

async function setFileProperty(key: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const maxSizeBytes = props.validation?.[key]?.maxSizeBytes;
  if (maxSizeBytes !== undefined && file.size > maxSizeBytes) {
    fieldErrors[key] = `${key} darf hoechstens ${maxSizeBytes} Bytes gross sein.`;
    input.value = '';
    return;
  }

  try {
    commitIfValid(key, {
      fileName: file.name,
      content: await file.text(),
      sizeBytes: file.size,
    });
  } catch (error) {
    fieldErrors[key] = error instanceof Error ? error.message : 'Datei konnte nicht gelesen werden.';
  } finally {
    input.value = '';
  }
}

function clearFileProperty(key: string) {
  commitIfValid(key, {
    fileName: '',
    content: '',
    sizeBytes: 0,
  });
}

function setJsonProperty(key: string, event: Event) {
  try {
    commitIfValid(key, JSON.parse((event.target as HTMLTextAreaElement).value));
  } catch (error) {
    fieldErrors[key] = error instanceof SyntaxError
      ? `Ungültiges JSON: ${error.message}`
      : 'JSON konnte nicht verarbeitet werden.';
  }
}

function setVectorValue(key: string, value: unknown, index: number, event: Event, dimensions = 3) {
  if (isVectorComponentLocked(key, index)) return;
  const input = event.target as HTMLInputElement;
  const nextComponent = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : input.value;
  const components = editableVectorComponents(value, dimensions);
  components[index] = nextComponent;
  const nextValue = Array.isArray(value)
    ? components
    : dimensions === 2
      ? { x: components[0], y: components[1] }
      : { x: components[0], y: components[1], z: components[2] };
  commitIfValid(key, nextValue);
}

function commitIfValid(key: string, value: unknown) {
  const error = validationErrorFor(key, value, { ...props.target, [key]: value });
  if (error) {
    fieldErrors[key] = error;
  } else {
    delete fieldErrors[key];
  }
  emit('update-property', { key, value });
}

function validateAllFields() {
  for (const key of Object.keys(fieldErrors)) delete fieldErrors[key];
  for (const [key, rule] of Object.entries(props.validation ?? {})) {
    const value = props.target[key];
    if (value === undefined || value === null) continue;
    const error = validateFieldValue(key, value, rule, props.target, props.objects);
    if (error) fieldErrors[key] = error;
  }
}

function validationErrorFor(key: string, value: unknown, properties: JsonObject) {
  const rule = props.validation?.[key];
  return rule ? validateFieldValue(key, value, rule, properties, props.objects) : null;
}

function minValueFor(key: string) {
  return props.validation?.[key]?.min;
}

function maxValueFor(key: string) {
  return props.validation?.[key]?.max;
}

function isFieldDisabled(key: string) {
  return key === 'rngSeed' && props.target.rngSeedEnabled !== true;
}

function stepValueFor(key: string) {
  const type = props.validation?.[key]?.type;
  if (type === 'integer') return 1;
  if (type === 'number' || type === 'vector2' || type === 'vector3') return 0.1;
  return 'any';
}
function optionsFor(key: string) {
  return props.validation?.[key]?.options ?? [];
}

function usesAngleControl(key: string) {
  return props.validation?.[key]?.control === 'angle';
}

function angleLabel(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}°`
    : '0.0°';
}

function adjustAngle(key: string, value: unknown, delta: number) {
  const current = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const wrapped = ((current + delta) % 360 + 360) % 360;
  commitIfValid(key, Math.round(wrapped * 10) / 10);
}
function acceptedFilesFor(key: string) {
  return props.validation?.[key]?.accept?.join(',') ?? undefined;
}

function vectorValue(value: unknown, index: number, dimensions = 3) {
  return editableVectorComponents(value, dimensions)[index];
}

function isVectorComponentLocked(key: string, index: number) {
  const component = (['x', 'y', 'z'] as const)[index];
  return component !== undefined
    && props.validation?.[key]?.lockedComponents?.includes(component) === true;
}

function editableVectorComponents(value: unknown, dimensions = 3) {
  if (dimensions === 2 && isVector2(value)) return vector2Components(value);
  if (isVector3(value)) return vectorComponents(value);
  if (Array.isArray(value)) return dimensions === 2
    ? [value[0] ?? '', value[1] ?? '']
    : [value[0] ?? '', value[1] ?? '', value[2] ?? ''];
  if (isPlainObject(value)) {
    const vector = value as Record<string, unknown>;
    return dimensions === 2
      ? [vector.x ?? '', vector.y ?? '']
      : [vector.x ?? '', vector.y ?? '', vector.z ?? ''];
  }
  return dimensions === 2 ? ['', ''] : ['', '', ''];
}

function isPlainObject(value: unknown) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && !isReference(value));
}

function fileLabel(value: unknown) {
  if (!hasUploadedFile(value)) return '';
  return value.fileName;
}

function fileSizeLabel(value: unknown) {
  if (!hasUploadedFile(value)) return '';
  const size = value.sizeBytes;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

function hasUploadedFile(value: unknown): value is Required<FileValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as FileValue;
  return Boolean(file.fileName && file.content && typeof file.sizeBytes === 'number');
}

function hasElevatedGpuMemorySetting() {
  return Object.entries(props.validation ?? {}).some(([key, rule]) => {
    if (rule.gpuMemorySensitive !== true) return false;
    const value = props.target[key];
    const defaultValue = props.defaults?.[key];
    return typeof value === 'number'
      && Number.isFinite(value)
      && typeof defaultValue === 'number'
      && Number.isFinite(defaultValue)
      && value > defaultValue;
  });
}

function errorIdFor(key: string) {
  return `field-error-${encodeURIComponent(props.instanceId)}-${encodeURIComponent(key)}`;
}
</script>

<template>
  <div class="editor-section object-configurator">
    <div
      v-if="hasElevatedGpuMemorySetting()"
      class="gpu-memory-warning"
      role="note"
    >
      Erhöhte Auflösungswerte können GPU-Out-of-Memory-Fehler verursachen.
      Verwendung auf eigene Gefahr.
    </div>
    <div class="property-list">
      <div v-for="[key, value] in propertyEntries()" :key="key" class="property-row">
        <div v-if="editorTypeFor(key, value) === 'vector3'" class="vector-row">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <label v-for="(axis, index) in ['X', 'Y', 'Z']" :key="axis">
            {{ axis }}
            <input
              :value="vectorValue(value, index)"
              type="number"
              :step="stepValueFor(key)"
              :disabled="isVectorComponentLocked(key, index)"
              :aria-invalid="Boolean(fieldErrors[key])"
              :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
              @input="setVectorValue(key, value, index, $event)"
            />
          </label>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </div>

        <label
          v-else-if="editorTypeFor(key, value) === 'number' && usesAngleControl(key)"
          class="angle-label"
        >
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <div class="angle-control">
            <button type="button" @click="adjustAngle(key, value, -1)">−1</button>
            <button type="button" @click="adjustAngle(key, value, -0.1)">−0.1</button>
            <output>{{ angleLabel(value) }}</output>
            <button type="button" @click="adjustAngle(key, value, 0.1)">+0.1</button>
            <button type="button" @click="adjustAngle(key, value, 1)">+1</button>
          </div>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <div v-else-if="editorTypeFor(key, value) === 'vector2'" class="vector-row">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <label v-for="(axis, index) in ['X', 'Y']" :key="axis">
            {{ axis }}
            <input
                :value="vectorValue(value, index, 2)"
                type="number"
                :step="stepValueFor(key)"
                :disabled="isVectorComponentLocked(key, index)"
                :aria-invalid="Boolean(fieldErrors[key])"
                :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
                @input="setVectorValue(key, value, index, $event, 2)"
            />
          </label>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </div>


        <label v-else-if="editorTypeFor(key, value) === 'number'">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <input
            :value="value"
            type="number"
            :min="minValueFor(key)"
            :max="maxValueFor(key)"
            :step="stepValueFor(key)"
            :disabled="isFieldDisabled(key)"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @input="setNumberProperty(key, $event)"
          />
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <label v-else-if="editorTypeFor(key, value) === 'string'">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <input
            :value="value"
            type="text"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @input="setStringProperty(key, $event)"
          />
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <label v-else-if="editorTypeFor(key, value) === 'select'">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <select
            :value="value"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @change="setSelectProperty(key, $event)"
          >
            <option v-for="option in optionsFor(key)" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <label v-else-if="editorTypeFor(key, value) === 'boolean'" class="checkbox-label">
          <input
            :checked="Boolean(value)"
            type="checkbox"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @change="setBooleanProperty(key, $event)"
          />
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <label v-else-if="editorTypeFor(key, value) === 'reference'">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <select
            :value="referenceValue(value)"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @change="setReferenceProperty(key, $event)"
          >
            <option v-if="referenceCanBeEmpty(key)" value="">Keine Referenz</option>
            <option
              v-for="candidate in referenceCandidatesFor(key)"
              :key="objectIdFor(candidate)"
              :value="objectIdFor(candidate)"
            >
              {{ optionLabel(candidate) }}
            </option>
          </select>
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <div v-else-if="editorTypeFor(key, value) === 'file'" class="file-field">
          <span class="file-field-label field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <span v-if="hasUploadedFile(value)" class="file-value">
            <span class="file-name">{{ fileLabel(value) }}</span>
            <small class="file-size">{{ fileSizeLabel(value) }}</small>
            <button
              class="icon-button file-clear-button"
              type="button"
              title="Datei entfernen"
              aria-label="Datei entfernen"
              @click="clearFileProperty(key)"
            >
              <Trash2 :size="15" />
            </button>
          </span>
          <input
            v-else
            type="file"
            :accept="acceptedFilesFor(key)"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @change="setFileProperty(key, $event)"
          />
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </div>

        <label v-else-if="editorTypeFor(key, value) === 'json'">
          <span class="field-name">
            {{ fieldLabelFor(key) }}
            <ValidationTooltip
              v-if="fieldDescriptionFor(key)"
              :text="fieldDescriptionFor(key)"
              variant="help"
            />
          </span>
          <textarea
            :value="JSON.stringify(value, null, 2)"
            :aria-invalid="Boolean(fieldErrors[key])"
            :aria-describedby="fieldErrors[key] ? errorIdFor(key) : undefined"
            @change="setJsonProperty(key, $event)"
          />
          <small v-if="fieldErrors[key]" :id="errorIdFor(key)" class="field-error">{{ fieldErrors[key] }}</small>
        </label>

        <small v-else class="field-error">{{ fieldLabelFor(key) }} kann nicht bearbeitet werden.</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.field-error {
  display: block;
  color: #ff8a8a;
  margin-top: 0.25rem;
}

.gpu-memory-warning {
  border: 1px solid #f59e0b;
  border-radius: 6px;
  padding: 8px 10px;
  color: #92400e;
  background: #fffbeb;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.checkbox-label {
  flex-wrap: wrap;
}

.checkbox-label .field-error {
  flex-basis: 100%;
}

.angle-label {
  align-items: stretch;
  flex-direction: column;
  gap: 0.35rem;
}

.angle-control {
  align-items: center;
  display: grid;
  gap: 0.35rem;
  grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(4.5rem, auto) repeat(2, minmax(0, 1fr));
}

.angle-control button {
  cursor: pointer;
  padding: 0.35rem 0.45rem;
}

.angle-control output {
  font-variant-numeric: tabular-nums;
  text-align: center;
}

[aria-invalid="true"] {
  border-color: #ff6b6b;
}

.vector-row input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.file-field {
  display: grid;
  gap: 5px;
  color: #526070;
  font-size: 12px;
  font-weight: 700;
}

.file-field-label {
  color: #526070;
}

.file-value {
  display: grid;
  grid-template-columns: minmax(0, auto) max-content minmax(28px, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid #c8d1da;
  border-radius: 6px;
  padding: 4px 5px 4px 9px;
  background: #ffffff;
  color: #cbd5e1;
}

.file-name {
  min-width: 0;
  overflow: hidden;
  color: #172033;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: #64748b;
  font-size: 0.85rem;
}

.file-clear-button {
  justify-self: end;
  min-width: 28px;
  min-height: 28px;
  color: #991b1b;
  border-color: #c8d1da;
  background: #ffffff;
}

.file-clear-button:hover {
  border-color: #fecaca;
  background: #fff7f7;
}
</style>
