<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronRight, Copy, Download, FileUp, Play, Plus, RotateCcw, Trash2 } from '@lucide/vue';

import ObjectConfigurator from './components/ObjectConfigurator.vue';
import RendererChangeDialog from './components/RendererChangeDialog.vue';
import ScenePreview from './components/ScenePreview.vue';
import ValidationTooltip from './components/ValidationTooltip.vue';
import { createDefaultSceneForRenderer, rendererBackends } from './config/rendererBackends';
import { saveScene } from './backend/BackendCommunication';
import {
  useSceneObjects,
  type StatusChangeGroup,
  type StatusValueChange,
} from './composables/useSceneObjects';
import type { GpuInformationEntry } from './model/GpuInformation';
import { SceneConfig } from './model/SceneConfig';
import { validateSceneObjects } from './model/RendererValidation';

const initialRenderer = rendererBackends[0];
const scene = ref(initialRenderer
  ? createDefaultSceneForRenderer(initialRenderer)
  : SceneConfig.createDefault());
interface StatusEntry {
  id: number;
  message: string;
  changeGroup?: StatusChangeGroup;
}

let nextStatusEntryId = 1;
let lastRenderStatusSignature: string | null = null;
const statusHistory = ref<StatusEntry[]>([
  { id: 0, message: 'Bereit' },
]);
const isBusy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const invalidEditorObjectIds = ref<Set<string>>(new Set());
const selectedRendererId = ref(initialRenderer?.id ?? '');
const pendingRendererId = ref<string | null>(null);
const renderedImageUrl = ref<string | null>(null);
const renderedImageBlob = ref<Blob | null>(null);
let renderedImageObjectUrl: string | null = null;
const renderDurationMs = ref<number | null>(null);
const isRenderResultOpen = ref(true);
const gpuInformation = ref<GpuInformationEntry[]>([]);
const isGpuInformationOpen = ref(false);

const selectedRenderer = computed(() => (
  rendererBackends.find((backend) => backend.id === selectedRendererId.value) ?? rendererBackends[0]
));
const selectedRendererCapabilities = computed(() => selectedRenderer.value.capabilities);
const pendingRenderer = computed(() => (
  rendererBackends.find((backend) => backend.id === pendingRendererId.value) ?? null
));
const sceneValidationIssues = computed(() => validateSceneObjects(
  scene.value.objects,
  selectedRendererCapabilities.value,
));
const sceneValidationErrors = computed(() => sceneValidationIssues.value.filter((issue) => issue.severity === 'error'));
const sceneValidationMessages = computed(() => sceneValidationErrors.value.map((issue) => issue.message));
const hasEditorValidationErrors = computed(() => scene.value.objects
  .some((object) => invalidEditorObjectIds.value.has(object.objectId)));
const canStartRenderer = computed(() => (
  !isBusy.value && !hasEditorValidationErrors.value && sceneValidationErrors.value.length === 0
));
const renderButtonTitle = computed(() => {
  if (isBusy.value) return 'Renderer läuft';
  if (hasEditorValidationErrors.value) return 'Ungültige Eingabe im Objektkonfigurator';
  return sceneValidationErrors.value.length === 0
    ? 'Renderer mit aktueller Konfiguration starten'
    : validationSummary(sceneValidationErrors.value.map((issue) => issue.message));
});
const renderDurationLabel = computed(() => (
  renderDurationMs.value === null ? '' : formatDuration(renderDurationMs.value)
));
const gpuInformationSummary = computed(() => (
  gpuInformation.value.find((entry) => entry.key === 'maxStorageBufferBindingSize')?.value
  ?? ''
));
const spdPlotUrl = computed(() => {
  if (selectedRenderer.value.strategy.id !== 'prism-ray') {
    return '';
  }

  const light = scene.value.objects.find((object) => (
    object.objectType === 'CircleLight' || object.objectType === 'AreaLight'
  ));
  const properties = light?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return '';
  }

  const preset = spdPresetFromProperties(properties as Record<string, unknown>);
  return preset ? `${selectedRenderer.value.baseUrl}/spd-plot/${encodeURIComponent(preset)}` : '';
});

function setStatus(message: string, changeGroup?: StatusChangeGroup) {
  const current = statusHistory.value[0];
  if (
    changeGroup
    && current?.changeGroup?.mergeKey === changeGroup.mergeKey
  ) {
    const mergedGroup = {
      mergeKey: changeGroup.mergeKey,
      changes: mergeStatusChanges(current.changeGroup.changes, changeGroup.changes),
    };
    statusHistory.value = [
      {
        ...current,
        message: formatStatusChanges(mergedGroup.changes),
        changeGroup: mergedGroup,
      },
      ...statusHistory.value.slice(1),
    ];
    return;
  }

  statusHistory.value = [
    {
      id: nextStatusEntryId,
      message: changeGroup ? formatStatusChanges(changeGroup.changes) : message,
      changeGroup,
    },
    ...statusHistory.value.slice(0, 9),
  ];
  nextStatusEntryId += 1;
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

function recordRenderStatus() {
  const signature = `${selectedRendererId.value}:${JSON.stringify(scene.value.toJson())}`;
  if (signature === lastRenderStatusSignature) return;
  lastRenderStatusSignature = signature;
  setStatus('Render');
}

function setObjectEditorValidity(objectId: string, valid: boolean) {
  const invalidIds = new Set(invalidEditorObjectIds.value);
  if (valid) invalidIds.delete(objectId);
  else invalidIds.add(objectId);
  invalidEditorObjectIds.value = invalidIds;
}

function changeRenderer(event: Event) {
  const select = event.target as HTMLSelectElement;
  const nextRenderer = rendererBackends.find((backend) => backend.id === select.value);
  if (!nextRenderer || nextRenderer.id === selectedRendererId.value) {
    return;
  }

  if (scene.value.objects.length === 0) {
    selectedRendererId.value = nextRenderer.id;
    scene.value = createDefaultSceneForRenderer(nextRenderer);
    setStatus(`Renderer zu ${nextRenderer.name} gewechselt`);
    return;
  }

  select.value = selectedRendererId.value;
  pendingRendererId.value = nextRenderer.id;
}

function cancelRendererChange() {
  pendingRendererId.value = null;
}

function confirmRendererChange() {
  const nextRenderer = pendingRenderer.value;
  if (!nextRenderer) {
    return;
  }

  scene.value = createDefaultSceneForRenderer(nextRenderer);
  selectedRendererId.value = nextRenderer.id;
  pendingRendererId.value = null;
  clearRenderedImage();
  setStatus(`Renderer zu ${nextRenderer.name} gewechselt; Szene wurde geleert`);
}

const {
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
} = useSceneObjects(scene, selectedRendererCapabilities, setStatus);

onMounted(() => {
  document.addEventListener('pointerdown', commitRenameOnOutsidePointerDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', commitRenameOnOutsidePointerDown, true);
  clearRenderedImage();
});

function commitRenameOnOutsidePointerDown(event: PointerEvent) {
  if (!editingObjectId.value) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.inline-name-input')) {
    return;
  }

  const object = scene.value.objects.find((item) => objectIdFor(item) === editingObjectId.value);
  if (object) {
    commitRenameObject(object);
  } else {
    cancelRenameObject();
  }
}

async function startRenderer() {
  if (!selectedRenderer.value) {
    setStatus('Kein Renderer-Backend konfiguriert');
    return;
  }

  if (hasEditorValidationErrors.value) {
    setStatus('Rendern nicht möglich: Ungültige Eingabe im Objektkonfigurator');
    return;
  }

  if (sceneValidationErrors.value.length > 0) {
    setStatus(`Rendern nicht möglich: ${validationSummary(sceneValidationErrors.value.map((issue) => issue.message))}`);
    return;
  }

  isBusy.value = true;
  setStatus(`Starte ${selectedRenderer.value.name}...`);
  try {
    const saved = await saveScene(scene.value, selectedRenderer.value);
    scene.value = saved.scene;
    await setRenderedImage(saved.result.image, saved.result.renderDurationMs);
    isRenderResultOpen.value = true;
    setStatus(`${selectedRenderer.value.name} hat das Bild gerendert`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Renderer konnte nicht gestartet werden');
  } finally {
    isBusy.value = false;
  }
}

function resetScene() {
  scene.value = createDefaultSceneForRenderer(selectedRenderer.value);
  clearRenderedImage();
  setStatus('Standardszene erstellt');
}

function updatePreviewObjectProperty(update: {
  objectType: string;
  key: string;
  value: unknown;
}) {
  const object = scene.value.objects.find((item) => item.objectType === update.objectType);
  if (!object) return;
  updateObjectProperty(object, { key: update.key, value: update.value });
}

function triggerFileImport() {
  fileInput.value?.click();
}

async function handleFileImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsedJson = JSON.parse(text);
    const importRenderer = rendererForSceneConfig(parsedJson) ?? selectedRenderer.value;
    const importedScene = SceneConfig.fromJson(parsedJson);
    const errors = validateSceneObjects(importedScene.objects, importRenderer.capabilities)
      .filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new Error(`Import abgelehnt: ${validationSummary(errors.map((issue) => issue.message))}`);
    }
    selectedRendererId.value = importRenderer.id;
    scene.value = importedScene;
    clearRenderedImage();
    setStatus(`${file.name} geladen (${importRenderer.name})`);
  } catch (error) {
    const message = error instanceof SyntaxError
      ? `JSON-Syntaxfehler: ${error.message}`
      : error instanceof Error ? error.message : 'JSON konnte nicht geladen werden';
    setStatus(`Import fehlgeschlagen: ${message}`);
  } finally {
    input.value = '';
  }
}

function rendererForSceneConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('renderer' in value)) {
    return null;
  }

  const rendererName = (value as { renderer?: unknown }).renderer;
  if (rendererName === undefined || rendererName === null || rendererName === '') {
    return null;
  }
  if (typeof rendererName !== 'string') {
    throw new Error('renderer muss ein String sein.');
  }

  const normalizedName = rendererName.trim().toLowerCase();
  const renderer = rendererBackends.find((candidate) => candidate.name.trim().toLowerCase() === normalizedName);
  if (!renderer) {
    throw new Error(`Unbekannter Renderer "${rendererName}".`);
  }
  return renderer;
}


function validationSummary(messages: string[]) {
  const visible = messages.slice(0, 3).join(' - ');
  const remaining = messages.length - 3;
  return remaining > 0 ? `${visible} - und ${remaining} weitere Fehler` : visible;
}

function downloadJson() {
  const json = JSON.stringify(sceneJsonForDownload(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scene_config.json';
  link.click();
  URL.revokeObjectURL(url);
}

function sceneJsonForDownload() {
  const json = scene.value.toJson();
  json.renderer = selectedRenderer.value.name;
  return json;
}

function spdPresetFromProperties(properties: Record<string, unknown>) {
  const nestedSpd = properties.spd;
  if (typeof properties.spdPreset === 'string') {
    return properties.spdPreset;
  }
  if (nestedSpd && typeof nestedSpd === 'object' && !Array.isArray(nestedSpd)) {
    const spd = nestedSpd as Record<string, unknown>;
    if (typeof spd.preset === 'string') return spd.preset;
    if (typeof spd.name === 'string') return spd.name;
  }
  return 'd65';
}

async function setRenderedImage(blob: Blob, durationMs?: number) {
  const imageUrl = await ppmBlobToDataUrl(blob);
  clearRenderedImage();
  renderedImageBlob.value = blob;
  renderedImageUrl.value = imageUrl;
  renderDurationMs.value = durationMs ?? null;
}

function setLiveSensorFrame(blob: Blob) {
  if (selectedRenderer.value.strategy.id !== 'laser-wave') return;
  const durationMs = renderDurationMs.value;
  clearRenderedImage();
  renderedImageObjectUrl = URL.createObjectURL(blob);
  renderedImageBlob.value = blob;
  renderedImageUrl.value = renderedImageObjectUrl;
  renderDurationMs.value = durationMs;
  isRenderResultOpen.value = true;
}

function setPreviewRenderDuration(durationMs: number | null) {
  if (selectedRenderer.value.strategy.id !== 'laser-wave') return;
  renderDurationMs.value = durationMs;
}

function setGpuInformation(entries: GpuInformationEntry[]) {
  gpuInformation.value = entries;
}

function clearRenderedImage() {
  if (renderedImageObjectUrl) {
    URL.revokeObjectURL(renderedImageObjectUrl);
    renderedImageObjectUrl = null;
  }
  renderedImageBlob.value = null;
  renderedImageUrl.value = null;
  renderDurationMs.value = null;
}

function downloadRenderedImage() {
  if (!renderedImageBlob.value) {
    return;
  }

  const url = URL.createObjectURL(renderedImageBlob.value);
  const link = document.createElement('a');
  link.href = url;
  link.download = renderedImageBlob.value.type === 'image/png'
    ? 'recentRendering.png'
    : 'recentRendering.ppm';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function ppmBlobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = readPpmHeader(bytes);
  const pixelValues = header.magic === 'P3'
    ? readAsciiPpmPixels(bytes, header.dataOffset, header.width * header.height * 3)
    : readBinaryPpmPixels(bytes, header.dataOffset, header.width * header.height * 3, header.maxValue);

  const canvas = document.createElement('canvas');
  canvas.width = header.width;
  canvas.height = header.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Renderergebnis konnte nicht angezeigt werden.');
  }

  const image = context.createImageData(header.width, header.height);
  const scale = header.maxValue === 255 ? 1 : 255 / header.maxValue;
  for (let source = 0, target = 0; source < pixelValues.length; source += 3, target += 4) {
    image.data[target] = clampByte(pixelValues[source] * scale);
    image.data[target + 1] = clampByte(pixelValues[source + 1] * scale);
    image.data[target + 2] = clampByte(pixelValues[source + 2] * scale);
    image.data[target + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function readPpmHeader(bytes: Uint8Array) {
  let index = 0;
  const nextToken = () => {
    index = skipPpmWhitespaceAndComments(bytes, index);
    const start = index;
    while (index < bytes.length && !isPpmWhitespace(bytes[index]) && bytes[index] !== 35) {
      index += 1;
    }
    if (start === index) {
      throw new Error('Renderergebnis ist kein gueltiges PPM-Bild.');
    }
    return new TextDecoder().decode(bytes.slice(start, index));
  };

  const magic = nextToken();
  if (magic !== 'P3' && magic !== 'P6') {
    throw new Error(`Renderergebnis hat ein nicht unterstuetztes PPM-Format: ${magic}`);
  }

  const width = Number(nextToken());
  const height = Number(nextToken());
  const maxValue = Number(nextToken());
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1
    || !Number.isInteger(maxValue) || maxValue < 1 || maxValue > 65535) {
    throw new Error('Renderergebnis enthaelt ungueltige PPM-Bilddaten.');
  }

  return {
    magic,
    width,
    height,
    maxValue,
    dataOffset: skipSinglePpmWhitespace(bytes, index),
  };
}

function readAsciiPpmPixels(bytes: Uint8Array, offset: number, expectedValues: number) {
  const text = new TextDecoder().decode(bytes.slice(offset));
  const values = text
    .replace(/#[^\n\r]*/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  if (values.length < expectedValues || values.slice(0, expectedValues).some((value) => !Number.isFinite(value))) {
    throw new Error('Renderergebnis enthaelt unvollstaendige PPM-Pixeldaten.');
  }
  return values.slice(0, expectedValues);
}

function readBinaryPpmPixels(bytes: Uint8Array, offset: number, expectedValues: number, maxValue: number) {
  const bytesPerValue = maxValue > 255 ? 2 : 1;
  const expectedBytes = expectedValues * bytesPerValue;
  if (bytes.length - offset < expectedBytes) {
    throw new Error('Renderergebnis enthaelt unvollstaendige PPM-Pixeldaten.');
  }
  if (bytesPerValue === 1) {
    return Array.from(bytes.slice(offset, offset + expectedValues));
  }

  const values: number[] = [];
  for (let index = offset; index < offset + expectedBytes; index += 2) {
    values.push((bytes[index] << 8) + bytes[index + 1]);
  }
  return values;
}

function skipPpmWhitespaceAndComments(bytes: Uint8Array, index: number) {
  let cursor = index;
  while (cursor < bytes.length) {
    while (cursor < bytes.length && isPpmWhitespace(bytes[cursor])) cursor += 1;
    if (bytes[cursor] !== 35) break;
    while (cursor < bytes.length && bytes[cursor] !== 10 && bytes[cursor] !== 13) cursor += 1;
  }
  return cursor;
}

function skipSinglePpmWhitespace(bytes: Uint8Array, index: number) {
  return index < bytes.length && isPpmWhitespace(bytes[index]) ? index + 1 : index;
}

function isPpmWhitespace(value: number) {
  return value === 9 || value === 10 || value === 13 || value === 32;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 2 : 1)} s`;
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <h1>Szenenkonfiguration</h1>
      </div>
      <div class="toolbar" aria-label="Scene actions">
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept="application/json,.json"
          @change="handleFileImport"
        />
        <div class="menu-dropdown">
          <div class="menu-trigger" tabindex="0">Objekt</div>
          <div class="menu-panel">
            <button
              v-for="objectType in addableObjectTypes"
              :key="objectType.type"
              class="menu-row"
              :title="`${objectType.label} hinzufuegen`"
              @click="addObject(objectType.type)"
            >
              <Plus :size="18" />
              <span>{{ objectType.label }}</span>
            </button>
          </div>
        </div>
        
        <div class="menu-dropdown">
          <div class="menu-trigger" tabindex="0">Konfigurator</div>
          <div class="menu-panel">
            <button class="menu-row" title="JSON-Datei importieren" @click="triggerFileImport">
              <FileUp :size="18" />
              <span>Importieren</span>
            </button>
            <button class="menu-row" title="JSON herunterladen" @click="downloadJson">
              <Download :size="18" />
              <span>Speichern</span>
            </button>
            <button class="menu-row" title="Defaultwerte wiederherstellen" @click="resetScene">
              <RotateCcw :size="18" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <div class="menu-dropdown menu-dropdown--wide">
          <div class="menu-trigger" tabindex="0">Renderer</div>
          <div class="menu-panel menu-panel--wide">
            <label class="backend-select">
              Renderer
              <select :value="selectedRendererId" @change="changeRenderer">
                <option
                  v-for="backend in rendererBackends"
                  :key="backend.id"
                  :value="backend.id"
                >
                  {{ backend.name }} ({{ backend.baseUrl || 'Client' }})
                </option>
              </select>
            </label>
            <div v-if="selectedRenderer.strategy.backendCommunication" class="backend-meta">
              Max. Preview-Bounces: {{ selectedRendererCapabilities.preview.maxBounces }}
            </div>
            <div v-else class="backend-meta">
              Live im Client · kein Backend
            </div>
            <button
              v-if="selectedRenderer.strategy.backendCommunication"
              class="menu-row"
              :disabled="!canStartRenderer"
              :title="renderButtonTitle"
              @click="startRenderer"
            >
              <Play :size="18" />
              <span>Starten</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <section class="workspace">
      <aside class="panel editor-panel">
        <div class="accordion-list">
          <details class="editor-accordion render-result" :open="isRenderResultOpen" @toggle="isRenderResultOpen = ($event.target as HTMLDetailsElement).open">
            <summary>
              <ChevronRight :size="18" class="accordion-chevron" />
              <span class="object-heading">
                <span class="object-type">Rendering</span>
                <span v-if="renderDurationLabel" class="object-name">
                  {{ renderDurationLabel }}
                </span>
              </span>
              <span class="object-actions">
                <button
                  class="icon-button download-button"
                  :disabled="!renderedImageBlob"
                  title="Render-Ergebnis herunterladen"
                  @click.stop.prevent="downloadRenderedImage"
                >
                  <Download :size="15" />
                </button>
              </span>
            </summary>
            <div class="render-result-body">
              <div class="render-result-preview">
                <img
                  v-if="renderedImageUrl"
                  class="render-result-image"
                  :src="renderedImageUrl"
                  alt="Gerendertes Ergebnis"
                />
                <div v-else class="render-result-empty">
                  Noch kein Render-Ergebnis
                </div>
              </div>
            </div>
          </details>

          <details
            v-for="object in sceneObjects"
            :key="objectIdFor(object)"
            class="editor-accordion"
            :class="{
              'editor-accordion--unsupported': !isObjectSupported(object),
              'editor-accordion--invalid': hasObjectErrors(object),
              'editor-accordion--warning': hasObjectWarnings(object),
            }"
          >
            <summary>
              <ChevronRight :size="18" class="accordion-chevron" />
              <span class="object-heading">
                <input
                  v-if="editingObjectId === objectIdFor(object)"
                  v-model="draftObjectName"
                  class="inline-name-input"
                  type="text"
                  @click.stop
                  @keydown.enter.prevent.stop="commitRenameObject(object)"
                  @keydown.esc.prevent.stop="cancelRenameObject"
                />
                <span
                  v-else
                  class="object-type"
                  title="Doppelklick zum Umbenennen"
                  @dblclick.stop.prevent="startRenameObject(object)"
                >
                  {{ objectTitle(object) }}
                </span>
                <span
                  v-if="objectTypeLabel(object)"
                  class="object-name"
                >
                  {{ objectTypeLabel(object) }}
                </span>
              </span>
              <span class="object-actions">
                <ValidationTooltip
                  v-if="objectIssueSummary(object)"
                  :text="objectIssueSummary(object)"
                />
                <button
                  v-if="canDeleteObject(object)"
                  class="icon-button duplicate-button"
                  title="Objekt duplizieren"
                  @click.stop.prevent="duplicateObject(object)"
                >
                  <Copy :size="15" />
                </button>
                <button
                  v-if="canDeleteObject(object)"
                  class="icon-button delete-button"
                  title="Objekt loeschen"
                  @click.stop.prevent="deleteObject(object)"
                >
                  <Trash2 :size="15" />
                </button>
              </span>
            </summary>
            <ObjectConfigurator
              :target="configurationTargetFor(object)"
              :defaults="selectedRendererCapabilities.objects[object.objectType]?.defaults"
              :objects="scene.objects"
              :instance-id="object.objectId"
              :validation="selectedRendererCapabilities.objects[object.objectType]?.validation"
              :hidden-properties="selectedRendererCapabilities.objects[object.objectType]?.hiddenProperties"
              @update-property="updateObjectProperty(object, $event)"
              @validation-state="setObjectEditorValidity(object.objectId, $event)"
            />
          </details>

          <details
            class="editor-accordion gpu-information"
            :open="isGpuInformationOpen"
            @toggle="isGpuInformationOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary>
              <ChevronRight :size="18" class="accordion-chevron" />
              <span class="object-heading">
                <span class="object-type">GPU</span>
                <span v-if="gpuInformationSummary" class="object-name">
                  {{ gpuInformationSummary }} Storage
                </span>
              </span>
            </summary>
            <div class="gpu-information-body">
              <dl v-if="gpuInformation.length" class="gpu-information-list">
                <div
                  v-for="entry in gpuInformation"
                  :key="entry.key"
                  class="gpu-information-row"
                >
                  <dt>
                    <span>{{ entry.label }}</span>
                    <ValidationTooltip
                      :text="entry.description"
                      variant="help"
                    />
                  </dt>
                  <dd>{{ entry.value }}</dd>
                </div>
              </dl>
              <p v-else class="gpu-information-empty">
                Keine WebGPU-Informationen verfügbar
              </p>
            </div>
          </details>
        </div>
      </aside>

      <section class="preview-panel">
        <img
          v-if="spdPlotUrl"
          class="spd-plot-overlay"
          :src="spdPlotUrl"
          alt="Spectral Power Distribution"
        />
        <ScenePreview
          :scene="scene"
          :capabilities="selectedRendererCapabilities"
          :strategy-id="selectedRenderer.strategy.id"
          :validation-errors="sceneValidationMessages"
          @update-object-property="updatePreviewObjectProperty"
          @sensor-frame="setLiveSensorFrame"
          @render-duration="setPreviewRenderDuration"
          @gpu-information="setGpuInformation"
          @render-requested="recordRenderStatus"
        />
        <div class="bottom-strip">
          <div
            class="status-history"
            role="log"
            aria-live="polite"
            aria-label="Letzte Änderungen"
          >
            <output
              v-for="(entry, index) in statusHistory"
              :key="entry.id"
              class="status-history-entry"
              :class="{ 'status-history-entry--current': index === 0 }"
              :title="entry.message"
            >
              {{ entry.message }}
            </output>
          </div>
        </div>
      </section>
    </section>

    <RendererChangeDialog
      v-if="pendingRenderer"
      :current-renderer="selectedRenderer"
      :next-renderer="pendingRenderer"
      :object-count="scene.objects.length"
      @cancel="cancelRendererChange"
      @confirm="confirmRendererChange"
    />
  </main>
</template>
