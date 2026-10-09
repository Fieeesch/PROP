<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlertTriangle, RefreshCw } from '@lucide/vue';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import GpuErrorDialog from './GpuErrorDialog.vue';
import type { GpuInformationEntry } from '../model/GpuInformation';
import type { SceneConfig } from '../model/SceneConfig';
import type { RendererCapabilities } from '../model/RendererCapabilities';
import {
  getRendererStrategy,
  type PreviewContext,
  type PreviewInstance,
} from '../preview/RendererStrategy';

type WebGPUViewHelper = Omit<ViewHelper, 'render'> & {
  render(renderer: THREE.WebGPURenderer): void;
};

type GpuDeviceLike = {
  addEventListener(type: 'uncapturederror', listener: EventListener): void;
  removeEventListener(type: 'uncapturederror', listener: EventListener): void;
  limits?: object;
  lost?: Promise<{
    message?: string;
    reason?: string;
  }>;
};

type RendererWithGpuDevice = THREE.WebGPURenderer & {
  backend?: {
    device?: GpuDeviceLike | null;
  };
};

type WebGpuAdapterLike = {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  limits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
  };
};

type NavigatorWithWebGpu = Navigator & {
  gpu?: {
    requestAdapter(options?: {
      featureLevel?: 'compatibility';
    }): Promise<WebGpuAdapterLike | null>;
  };
};

interface GpuErrorState {
  title: string;
  message: string;
}

const props = defineProps<{
  scene: SceneConfig;
  capabilities: RendererCapabilities;
  strategyId: string;
  validationErrors: string[];
}>();
const emit = defineEmits<{
  'update-object-property': [update: {
    objectType: string;
    key: string;
    value: unknown;
  }];
  'sensor-frame': [frame: Blob];
  'render-duration': [durationMs: number | null];
  'gpu-information': [entries: GpuInformationEntry[]];
  'render-requested': [];
}>();

const host = ref<HTMLDivElement | null>(null);
const gizmoHost = ref<HTMLDivElement | null>(null);
const sensorInsetHost = ref<HTMLDivElement | null>(null);
const sensorViewExpanded = ref(false);
const laserRenderInProgress = ref(false);
const gpuError = ref<GpuErrorState | null>(null);
let renderer: THREE.WebGPURenderer | null = null;
let gizmoRenderer: THREE.WebGPURenderer | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let sensorCamera: THREE.OrthographicCamera | null = null;
let scene3d: THREE.Scene | null = null;
let group: THREE.Group | null = null;
let previewInstance: PreviewInstance | null = null;
let controls: OrbitControls | null = null;
let viewHelper: WebGPUViewHelper | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let lastFrameTime = 0;
let previewUpdatePending = false;
let previewWidth = 0;
let previewHeight = 0;
let previewPointerDown: THREE.Vector2 | null = null;
let lastCapturedSensorRevision = -1;
let previewGeneration = 0;
let componentMounted = false;
const pendingSensorCaptures = new Set<string>();
const observedGpuDevices = new Map<GpuDeviceLike, EventListener>();
const previewPointer = new THREE.Vector2();
const previewRaycaster = new THREE.Raycaster();

onMounted(() => {
  componentMounted = true;
  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  void initializePreview().catch((error: unknown) => {
    reportGpuError(error, 'WebGPU-Initialisierung fehlgeschlagen');
  });
});

async function initializePreview() {
  if (!host.value || !gizmoHost.value) {
    return;
  }

  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x111827);

  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  camera.position.set(0, 1.2, props.strategyId === 'laser-wave' ? -4.2 : 4.2);
  camera.lookAt(0, -0.35, 0);
  sensorCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);

  const webGpuAdapter = await maximumWebGpuBufferLimits();
  renderer = new THREE.WebGPURenderer({
    antialias: true,
    requiredLimits: webGpuAdapter.requiredLimits,
  });
  await renderer.init();
  observeGpuDevice(renderer);
  emitGpuInformation(renderer, webGpuAdapter.adapterInformation);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'preview-canvas';
  host.value.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('pointerdown', handlePreviewPointerDown);
  renderer.domElement.addEventListener('pointerup', handlePreviewPointerUp);
  renderer.domElement.addEventListener('dblclick', handlePreviewDoubleClick);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, -0.35, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 12;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.update();
  controls.addEventListener('change', requestRender);

  gizmoRenderer = new THREE.WebGPURenderer({ alpha: true, antialias: true });
  await gizmoRenderer.init();
  observeGpuDevice(gizmoRenderer);
  gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gizmoRenderer.setSize(128, 128, false);
  gizmoRenderer.domElement.className = 'preview-gizmo-canvas';
  gizmoHost.value.appendChild(gizmoRenderer.domElement);

  // ViewHelper supports WebGPURenderer at runtime, but its DefinitelyTyped
  // declaration currently still restricts render() to WebGLRenderer.
  viewHelper = new ViewHelper(camera, gizmoHost.value) as unknown as WebGPUViewHelper;
  viewHelper.center.copy(controls.target);
  viewHelper.setLabels('X', 'Y', 'Z');
  viewHelper.setLabelStyle('700 18px Inter, system-ui, sans-serif', '#ffffff', 0.32);
  gizmoHost.value.addEventListener('click', handleGizmoClick);

  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene3d.add(ambient);

  group = new THREE.Group();
  scene3d.add(group);

  createPreviewInstance();
  resize();

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host.value);
  window.addEventListener('resize', resize);
}

async function maximumWebGpuBufferLimits() {
  const gpu = (navigator as NavigatorWithWebGpu).gpu;
  if (!gpu) {
    return {
      requiredLimits: undefined,
      adapterInformation: [] as GpuInformationEntry[],
    };
  }

  const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' });
  const adapterInformation = gpuAdapterInformation(adapter?.info);
  const maxBufferSize = positiveGpuLimit(adapter?.limits?.maxBufferSize);
  const maxStorageBufferBindingSize = positiveGpuLimit(
    adapter?.limits?.maxStorageBufferBindingSize,
  );
  if (maxBufferSize === null || maxStorageBufferBindingSize === null) {
    return {
      requiredLimits: undefined,
      adapterInformation,
    };
  }

  return {
    requiredLimits: {
      maxBufferSize,
      maxStorageBufferBindingSize,
    },
    adapterInformation,
  };
}

function positiveGpuLimit(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function gpuAdapterInformation(
  info: WebGpuAdapterLike['info'] | undefined,
): GpuInformationEntry[] {
  if (!info) return [];

  return [
    gpuTextEntry(
      'adapter-description',
      'GPU',
      info.description,
      'Vom Browser bereitgestellte Beschreibung des ausgewählten Grafikadapters.',
    ),
    gpuTextEntry(
      'adapter-vendor',
      'Hersteller',
      info.vendor,
      'Vom Browser gemeldeter Hersteller des Grafikadapters.',
    ),
    gpuTextEntry(
      'adapter-architecture',
      'Architektur',
      info.architecture,
      'Vom Browser gemeldete GPU-Architektur. Dieser Wert kann aus Datenschutzgründen leer sein.',
    ),
    gpuTextEntry(
      'adapter-device',
      'Gerät',
      info.device,
      'Vom Browser gemeldete Gerätekennung. Dieser Wert kann aus Datenschutzgründen leer sein.',
    ),
  ].filter((entry): entry is GpuInformationEntry => entry !== null);
}

function gpuTextEntry(
  key: string,
  label: string,
  value: unknown,
  description: string,
) {
  return typeof value === 'string' && value.trim()
    ? { key, label, value: value.trim(), description }
    : null;
}

const gpuLimitDefinitions = [
  {
    key: 'maxBufferSize',
    label: 'Maximale Buffergröße',
    description: 'Größter einzelner GPU-Buffer, den das WebGPU-Gerät anlegen darf.',
    format: 'bytes',
  },
  {
    key: 'maxStorageBufferBindingSize',
    label: 'Maximale Storage-Buffer-Bindung',
    description: 'Größter Bufferbereich, der einem Shader als Storage-Buffer bereitgestellt werden darf.',
    format: 'bytes',
  },
  {
    key: 'maxUniformBufferBindingSize',
    label: 'Maximale Uniform-Buffer-Bindung',
    description: 'Größter Bufferbereich für Uniform-Daten eines Shaders.',
    format: 'bytes',
  },
  {
    key: 'maxTextureDimension2D',
    label: 'Maximale 2D-Texturkante',
    description: 'Maximal zulässige Breite oder Höhe einer zweidimensionalen GPU-Textur.',
    format: 'number',
  },
  {
    key: 'maxStorageBuffersPerShaderStage',
    label: 'Storage-Buffer pro Shader-Stufe',
    description: 'Maximale Anzahl gleichzeitig gebundener Storage-Buffer je Shader-Stufe.',
    format: 'number',
  },
  {
    key: 'maxComputeWorkgroupStorageSize',
    label: 'Workgroup-Speicher',
    description: 'Maximaler gemeinsam genutzter Speicher einer Compute-Workgroup.',
    format: 'bytes',
  },
  {
    key: 'maxComputeInvocationsPerWorkgroup',
    label: 'Aufrufe pro Workgroup',
    description: 'Maximale Anzahl paralleler Shader-Aufrufe innerhalb einer Compute-Workgroup.',
    format: 'number',
  },
  {
    key: 'maxComputeWorkgroupSizeX',
    label: 'Workgroup-Größe X',
    description: 'Maximale Anzahl Compute-Aufrufe einer Workgroup in X-Richtung.',
    format: 'number',
  },
  {
    key: 'maxComputeWorkgroupSizeY',
    label: 'Workgroup-Größe Y',
    description: 'Maximale Anzahl Compute-Aufrufe einer Workgroup in Y-Richtung.',
    format: 'number',
  },
  {
    key: 'maxComputeWorkgroupSizeZ',
    label: 'Workgroup-Größe Z',
    description: 'Maximale Anzahl Compute-Aufrufe einer Workgroup in Z-Richtung.',
    format: 'number',
  },
  {
    key: 'maxComputeWorkgroupsPerDimension',
    label: 'Workgroups pro Dimension',
    description: 'Maximale Anzahl gestarteter Compute-Workgroups je Dimension eines Dispatch-Aufrufs.',
    format: 'number',
  },
] as const;

function emitGpuInformation(
  activeRenderer: THREE.WebGPURenderer,
  adapterInformation: GpuInformationEntry[],
) {
  const device = (activeRenderer as RendererWithGpuDevice).backend?.device;
  const limits = device?.limits as Record<string, unknown> | undefined;
  const limitInformation = gpuLimitDefinitions.flatMap((definition) => {
    const value = positiveGpuLimit(limits?.[definition.key]);
    if (value === null) return [];
    return [{
      key: definition.key,
      label: definition.label,
      value: definition.format === 'bytes'
        ? formatGpuBytes(value)
        : value.toLocaleString('de-DE'),
      description: definition.description,
    }];
  });
  emit('gpu-information', [...adapterInformation, ...limitInformation]);
}

function formatGpuBytes(bytes: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || Number.isInteger(value) ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

onBeforeUnmount(() => {
  componentMounted = false;
  window.removeEventListener('resize', resize);
  window.removeEventListener('error', handleWindowError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  for (const [device, listener] of observedGpuDevices) {
    device.removeEventListener('uncapturederror', listener);
  }
  observedGpuDevices.clear();
  resizeObserver?.disconnect();
  resizeObserver = null;
  gizmoHost.value?.removeEventListener('click', handleGizmoClick);
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  controls?.removeEventListener('change', requestRender);
  renderer?.domElement.removeEventListener('pointerdown', handlePreviewPointerDown);
  renderer?.domElement.removeEventListener('pointerup', handlePreviewPointerUp);
  renderer?.domElement.removeEventListener('dblclick', handlePreviewDoubleClick);
  controls?.dispose();
  viewHelper?.dispose();
  previewInstance?.dispose();
  gizmoRenderer?.dispose();
  renderer?.dispose();
  sensorCamera = null;
});

function observeGpuDevice(activeRenderer: THREE.WebGPURenderer) {
  const device = (activeRenderer as RendererWithGpuDevice).backend?.device;
  if (!device || observedGpuDevices.has(device)) return;

  const uncapturedErrorListener: EventListener = (event) => {
    event.preventDefault();
    const gpuEvent = event as Event & { error?: unknown };
    reportGpuError(gpuEvent.error ?? event, 'Nicht behandelter GPU-Fehler');
  };
  observedGpuDevices.set(device, uncapturedErrorListener);
  device.addEventListener('uncapturederror', uncapturedErrorListener);

  void device.lost?.then(
    (info) => {
      if (!componentMounted || info.reason === 'destroyed') return;
      reportGpuError(info, 'GPU-Verbindung verloren');
    },
    (error: unknown) => {
      if (componentMounted) reportGpuError(error, 'GPU-Verbindung verloren');
    },
  );
}

function handleWindowError(event: ErrorEvent) {
  const error = event.error ?? event.message;
  if (!isGpuError(error)) return;
  event.preventDefault();
  reportGpuError(error);
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  if (!isGpuError(event.reason)) return;
  event.preventDefault();
  reportGpuError(event.reason);
}

function isGpuError(error: unknown) {
  const descriptor = `${errorTitle(error, '')} ${errorMessage(error)}`;
  return /(?:WebGPU|GPU)/i.test(descriptor);
}

function reportGpuError(error: unknown, fallbackTitle = 'GPU-Fehler') {
  if (!componentMounted || gpuError.value) return;

  console.error(fallbackTitle, error);
  gpuError.value = {
    title: errorTitle(error, fallbackTitle),
    message: errorMessage(error),
  };
  if (controls) controls.enabled = false;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function errorTitle(error: unknown, fallback: string) {
  const explicitTitle = stringProperty(error, 'title');
  if (explicitTitle) return explicitTitle;

  const name = stringProperty(error, 'name');
  if (name && name !== 'Error') return name;

  if (error && typeof error === 'object') {
    const constructorName = (error as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof constructorName === 'string' && constructorName !== 'Object') {
      return constructorName;
    }
  }
  return fallback;
}

function errorMessage(error: unknown) {
  const message = stringProperty(error, 'message');
  if (message) return message;
  const reason = stringProperty(error, 'reason');
  if (reason) return reason;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Es wurden keine weiteren Fehlerdetails bereitgestellt.';
}

function stringProperty(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === 'string' && property.trim() ? property : null;
}

function reloadPage() {
  window.location.reload();
}

watch(() => props.strategyId, () => {
  sensorViewExpanded.value = false;
  if (controls) controls.enabled = true;
  resetCameraForStrategy();
  createPreviewInstance();
});
watch(() => [props.scene, props.capabilities], () => {
  // Laser calculations are intentionally explicit because every update
  // rebuilds the GPU resources. The current editor values are applied only
  // when the user clicks the rerender button.
  if (props.strategyId === 'laser-wave') {
    return;
  }
  previewUpdatePending = true;
  requestRender();
}, { deep: true, flush: 'post' });

function renderPreview() {
  if (gpuError.value) return;

  try {
    if (renderer && scene3d && camera) {
      renderer.setScissorTest(false);
      if (previewWidth > 0 && previewHeight > 0) {
        renderer.setViewport(0, 0, previewWidth, previewHeight);
      }

      const sensorIsMainView = sensorViewExpanded.value
        && configureSensorCamera(previewWidth / Math.max(previewHeight, 1));
      if (sensorIsMainView && sensorCamera) {
        renderer.render(scene3d, sensorCamera);
        captureSensorFrame(renderer, sensorContentViewport({
          x: 0,
          y: 0,
          width: previewWidth,
          height: previewHeight,
        }));
        renderSceneInset(renderer, scene3d, camera);
      } else {
        renderer.render(scene3d, camera);
        const sensorViewport = renderSensorInset(renderer, scene3d);
        if (sensorViewport) captureSensorFrame(renderer, sensorContentViewport(sensorViewport));
      }
    }

    if (gizmoRenderer && viewHelper) {
      viewHelper.render(gizmoRenderer);
    }
  } catch (error: unknown) {
    reportGpuError(error, 'GPU-Rendering fehlgeschlagen');
  }
}

function configureSensorCamera(aspect: number) {
  return Boolean(
    sensorCamera
    && previewInstance?.configureInsetCamera?.(sensorCamera, aspect),
  );
}

function renderSensorInset(activeRenderer: THREE.WebGPURenderer, activeScene: THREE.Scene) {
  if (!sensorCamera) return null;
  const viewport = sensorInsetViewport(activeRenderer);
  if (!viewport || !configureSensorCamera(viewport.width / viewport.height)) return null;
  renderInsetCamera(activeRenderer, activeScene, sensorCamera, viewport);
  return viewport;
}

function renderSceneInset(
  activeRenderer: THREE.WebGPURenderer,
  activeScene: THREE.Scene,
  sceneCamera: THREE.PerspectiveCamera,
) {
  const viewport = sensorInsetViewport(activeRenderer);
  if (!viewport) return;

  const previousAspect = sceneCamera.aspect;
  sceneCamera.aspect = viewport.width / viewport.height;
  sceneCamera.updateProjectionMatrix();
  try {
    renderInsetCamera(activeRenderer, activeScene, sceneCamera, viewport);
  } finally {
    sceneCamera.aspect = previousAspect;
    sceneCamera.updateProjectionMatrix();
  }
}

interface InsetViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

function sensorContentViewport(viewport: InsetViewport): InsetViewport {
  const contentAspect = previewInstance?.insetContentAspect;
  if (!contentAspect || !Number.isFinite(contentAspect) || contentAspect <= 0) {
    return viewport;
  }

  const viewportAspect = viewport.width / viewport.height;
  if (viewportAspect > contentAspect) {
    const width = Math.max(1, Math.round(viewport.height * contentAspect));
    return {
      x: viewport.x + Math.round((viewport.width - width) * 0.5),
      y: viewport.y,
      width,
      height: viewport.height,
    };
  }

  const height = Math.max(1, Math.round(viewport.width / contentAspect));
  return {
    x: viewport.x,
    y: viewport.y + Math.round((viewport.height - height) * 0.5),
    width: viewport.width,
    height,
  };
}

function captureSensorFrame(
  activeRenderer: THREE.WebGPURenderer,
  viewport: InsetViewport,
) {
  const revision = previewInstance?.insetFrameRevision;
  const captureKey = `${previewGeneration}:${revision ?? 'none'}`;
  if (
    revision === undefined
    || revision <= 0
    || revision === lastCapturedSensorRevision
    || pendingSensorCaptures.has(captureKey)
  ) {
    return;
  }

  const sourceCanvas = activeRenderer.domElement;
  const canvasRect = sourceCanvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return;
  const scaleX = sourceCanvas.width / canvasRect.width;
  const scaleY = sourceCanvas.height / canvasRect.height;
  const sourceX = Math.max(0, Math.round(viewport.x * scaleX));
  const sourceY = Math.max(0, Math.round(viewport.y * scaleY));
  const sourceWidth = Math.min(
    sourceCanvas.width - sourceX,
    Math.max(1, Math.round(viewport.width * scaleX)),
  );
  const sourceHeight = Math.min(
    sourceCanvas.height - sourceY,
    Math.max(1, Math.round(viewport.height * scaleY)),
  );
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const outputScale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
  outputCanvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) return;
  outputContext.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );

  pendingSensorCaptures.add(captureKey);
  const captureGeneration = previewGeneration;
  outputCanvas.toBlob((blob) => {
    pendingSensorCaptures.delete(captureKey);
    if (
      !blob
      || previewGeneration !== captureGeneration
      || previewInstance?.insetFrameRevision !== revision
    ) return;
    lastCapturedSensorRevision = revision;
    emit('sensor-frame', blob);
  }, 'image/png');
}

function sensorInsetViewport(activeRenderer: THREE.WebGPURenderer): InsetViewport | null {
  if (!sensorInsetHost.value) return null;
  const canvasRect = activeRenderer.domElement.getBoundingClientRect();
  const insetRect = sensorInsetHost.value.getBoundingClientRect();
  const borderWidth = 2;
  const x = Math.max(0, Math.round(insetRect.left - canvasRect.left + borderWidth));
  const y = Math.max(0, Math.round(insetRect.top - canvasRect.top + borderWidth));
  const width = Math.min(
    Math.max(0, Math.round(insetRect.width - borderWidth * 2)),
    Math.max(0, previewWidth - x),
  );
  const height = Math.min(
    Math.max(0, Math.round(insetRect.height - borderWidth * 2)),
    Math.max(0, previewHeight - y),
  );
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function renderInsetCamera(
  activeRenderer: THREE.WebGPURenderer,
  activeScene: THREE.Scene,
  insetCamera: THREE.Camera,
  viewport: InsetViewport,
) {
  const { x, y, width, height } = viewport;

  const previousAutoClear = activeRenderer.autoClear;
  try {
    activeRenderer.setViewport(x, y, width, height);
    activeRenderer.setScissor(x, y, width, height);
    activeRenderer.setScissorTest(true);
    activeRenderer.autoClear = false;
    activeRenderer.clearDepth();
    activeRenderer.render(activeScene, insetCamera);
  } finally {
    activeRenderer.autoClear = previousAutoClear;
    activeRenderer.setScissorTest(false);
    activeRenderer.setViewport(0, 0, previewWidth, previewHeight);
  }
}

function toggleSensorViewport() {
  if (props.strategyId !== 'laser-wave') return;
  sensorViewExpanded.value = !sensorViewExpanded.value;
  if (controls) controls.enabled = !sensorViewExpanded.value;
  requestRender();
}

function rerenderLaserPreview() {
  if (
    props.strategyId !== 'laser-wave'
    || props.validationErrors.length > 0
    || laserRenderInProgress.value
    || !previewInstance
  ) return;
  emit('render-requested');
  laserRenderInProgress.value = true;
  previewInstance.update(props.scene.clone(), props.capabilities);
}

function laserValidationMessage() {
  return props.validationErrors.join(' · ');
}

function laserRerenderButtonTitle() {
  if (laserRenderInProgress.value) return 'Laser-Berechnung läuft';
  return laserValidationMessage() || 'Laser-Vorschau neu rendern';
}

function requestRender() {
  if (gpuError.value || animationFrame !== 0) {
    return;
  }

  lastFrameTime = performance.now();
  animationFrame = requestAnimationFrame(animate);
}

function animate(timestamp: number) {
  animationFrame = 0;
  const delta = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
  lastFrameTime = timestamp;

  if (previewUpdatePending) {
    previewInstance?.update(props.scene, props.capabilities);
    previewUpdatePending = false;
  }

  let controlsChanged = false;

  if (viewHelper?.animating) {
    viewHelper.update(delta);
    if (!viewHelper.animating && controls) {
      controls.enabled = !sensorViewExpanded.value;
    }
  } else {
    controlsChanged = controls?.update(delta) ?? false;
  }

  renderPreview();

  if (controlsChanged || viewHelper?.animating || previewUpdatePending) {
    requestRender();
  }
}

function resize() {
  if (!host.value || !renderer || !camera) {
    return;
  }

  const rect = host.value.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (width === previewWidth && height === previewHeight) {
    return;
  }

  previewWidth = width;
  previewHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  controls?.update();
  renderPreview();
}

function createPreviewInstance() {
  if (!group || !renderer) {
    return;
  }

  previewInstance?.dispose();
  previewGeneration += 1;
  emit('render-duration', null);
  laserRenderInProgress.value = false;
  lastCapturedSensorRevision = -1;
  pendingSensorCaptures.clear();
  group.clear();
  const strategy = getRendererStrategy(props.strategyId);
  const contextGeneration = previewGeneration;
  const context: PreviewContext = {
    renderer,
    requestRender,
    reportRenderDuration(durationMs) {
      if (contextGeneration !== previewGeneration) return;
      emit('render-duration', durationMs);
    },
    reportRenderState(rendering) {
      if (contextGeneration !== previewGeneration) return;
      laserRenderInProgress.value = rendering;
      requestRender();
    },
    reportGpuError,
    updateObjectProperty(objectType, key, value) {
      emit('update-object-property', { objectType, key, value });
    },
    updateObjectPropertyAndRerender(objectType, key, value) {
      emit('update-object-property', { objectType, key, value });
      if (
        props.strategyId !== 'laser-wave'
        || laserRenderInProgress.value
        || !previewInstance
      ) return;

      const updatedScene = props.scene.clone();
      const object = updatedScene.objects.find((item) => item.objectType === objectType);
      if (!object) return;
      object.properties[key] = structuredClone(value);
      laserRenderInProgress.value = true;
      previewInstance.update(updatedScene, props.capabilities);
    },
  };
  previewInstance = strategy.create(props.scene, props.capabilities, context);
  group.add(previewInstance.object3d);
  previewUpdatePending = false;
  renderPreview();
}

function resetCameraForStrategy() {
  if (!camera) return;
  camera.position.set(0, 1.2, props.strategyId === 'laser-wave' ? -4.2 : 4.2);
  camera.lookAt(0, -0.35, 0);
  if (controls) {
    controls.target.set(0, -0.35, 0);
    controls.update();
  }
  if (viewHelper) viewHelper.center.set(0, -0.35, 0);
  requestRender();
}

function handlePreviewPointerDown(event: PointerEvent) {
  previewPointerDown = event.button === 0
    ? new THREE.Vector2(event.clientX, event.clientY)
    : null;
}

function handlePreviewPointerUp(event: PointerEvent) {
  const pointerDown = previewPointerDown;
  previewPointerDown = null;
  if (!pointerDown || event.button !== 0 || !renderer || !camera || !previewInstance) {
    return;
  }

  const movement = pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
  if (movement > 4) return;

  queuePreviewActionAt(event, 'previewClickAction');
}

function handlePreviewDoubleClick(event: MouseEvent) {
  if (event.button !== 0) return;
  if (queuePreviewActionAt(event, 'previewDoubleClickAction')) {
    event.preventDefault();
  }
}

function queuePreviewActionAt(
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  actionName: 'previewClickAction' | 'previewDoubleClickAction',
) {
  if (!renderer || !camera || !previewInstance) return false;

  const rect = renderer.domElement.getBoundingClientRect();
  previewPointer.set(
    ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  );
  previewRaycaster.setFromCamera(previewPointer, camera);

  const intersections = previewRaycaster.intersectObject(previewInstance.object3d, true);
  for (const intersection of intersections) {
    const action = intersection.object.userData[actionName];
    if (typeof action === 'function') {
      // Let OrbitControls finish its pointer handling before an action changes
      // or rebuilds the preview tree.
      queueMicrotask(action);
      return true;
    }
  }
  return false;
}

function handleGizmoClick(event: MouseEvent) {
  if (!viewHelper) {
    return;
  }

  if (controls) {
    viewHelper.center.copy(controls.target);
  }

  if (viewHelper.handleClick(event)) {
    event.preventDefault();
    event.stopPropagation();
    if (controls) {
      controls.enabled = false;
    }
    requestRender();
  }
}

</script>

<template>
  <div ref="host" class="preview-host">
    <div
      v-show="strategyId === 'laser-wave'"
      ref="sensorInsetHost"
      class="sensor-inset"
      :title="sensorViewExpanded ? '3D-Szene vergrößern' : 'Sensoransicht vergrößern'"
      @click="toggleSensorViewport"
    >
      <span>{{ sensorViewExpanded ? 'Szene' : 'Sensor' }}</span>
    </div>
    <div ref="gizmoHost" class="preview-gizmo" title="Ansichtsgizmo"></div>
    <div
      v-if="strategyId === 'laser-wave'"
      class="laser-render-control"
    >
      <button
        class="laser-rerender-button"
        :class="{ 'laser-rerender-button--invalid': validationErrors.length > 0 }"
        type="button"
        :disabled="validationErrors.length > 0 || laserRenderInProgress"
        :title="laserRerenderButtonTitle()"
        :aria-busy="laserRenderInProgress"
        @click="rerenderLaserPreview"
      >
        <AlertTriangle
          v-if="validationErrors.length > 0"
          :size="16"
          aria-hidden="true"
        />
        <RefreshCw
          v-else
          :size="16"
          :class="{ 'laser-rerender-icon--spinning': laserRenderInProgress }"
          aria-hidden="true"
        />
        <span>
          {{
            validationErrors.length > 0
              ? 'Ungültige Szene'
              : laserRenderInProgress
                ? 'Wird gerendert …'
                : 'Neu rendern'
          }}
        </span>
      </button>
    </div>
  </div>
  <GpuErrorDialog
    v-if="gpuError"
    :title="gpuError.title"
    :message="gpuError.message"
    @reload="reloadPage"
  />
</template>
