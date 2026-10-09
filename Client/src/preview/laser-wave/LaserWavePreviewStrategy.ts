import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';

import type { SceneConfig } from '../../model/SceneConfig';
import { isVector3, vectorComponents } from '../../model/RendererValidation';
import type {
  PreviewContext,
  PreviewInstance,
  RendererStrategy,
} from '../RendererStrategy';
import {
  createWallFieldCompute,
  type WallFieldCompute,
} from './WallFieldCompute';
import {
  createWallToLensCompute,
  type WallToLensCompute,
} from './WallToLensCompute';
import {
  createLensToSensorCompute,
  resolvedSensorCenterForScene,
  type LensToSensorCompute,
} from './LensToSensorCompute';
import {
  laserDirectionForScene,
  lensNormalForScene,
  sensorNormalForScene,
  wallNormalForScene,
} from './OpticalAxis';
import { laserSamplingDimensions } from './LaserSamplingDimensions';
import {
  planeBasis,
  positiveNumber,
  propertiesFor,
} from './LaserSceneParameters';

type WebGpuQueue = {
  onSubmittedWorkDone: () => Promise<void>;
};

type RendererWithWebGpuQueue = THREE.WebGPURenderer & {
  backend?: {
    device?: {
      queue?: WebGpuQueue;
    } | null;
  };
};

interface LaserComputeResources {
  wallFieldCompute: WallFieldCompute | null;
  wallToLensCompute: WallToLensCompute | null;
  lensToSensorCompute: LensToSensorCompute | null;
}

interface LaserPreviewResources extends LaserComputeResources {
  object3d: THREE.Group;
}

/**
 * Koordiniert die Laserberechnung, ihre 3D-Vorschau und den Lebenszyklus der GPU-Ressourcen.
 */
export const laserWaveRendererStrategy: RendererStrategy = {
  id: 'laser-wave',

  create(scene, _capabilities, context) {
    return new LaserWavePreviewInstance(scene, context);
  },
};

class LaserWavePreviewInstance implements PreviewInstance {
  readonly object3d = new THREE.Group();
  private currentScene: SceneConfig;
  private wallLabel = 'Wand';
  private completedFrameRevision = 0;
  private wallFieldCompute: WallFieldCompute | null = null;
  private wallToLensCompute: WallToLensCompute | null = null;
  private lensToSensorCompute: LensToSensorCompute | null = null;
  private activeUpdate: Promise<void> | null = null;
  private disposed = false;
  private resourceReleaseStarted = false;

  constructor(
    scene: SceneConfig,
    private readonly context: PreviewContext,
  ) {
    this.currentScene = scene;
    this.startUpdate(scene);
  }

  update(scene: SceneConfig) {
    this.startUpdate(scene);
  }

  private startUpdate(scene: SceneConfig) {
    if (this.disposed || this.activeUpdate) return;
    const update = this.runUpdate(scene);
    this.activeUpdate = update;
    void update.then(
      () => {
        if (this.activeUpdate === update) this.activeUpdate = null;
      },
      (error: unknown) => {
        if (this.activeUpdate === update) this.activeUpdate = null;
        if (!this.disposed) {
          this.context.reportGpuError(error, 'Laser-Berechnung fehlgeschlagen');
        }
      },
    );
  }

  private async runUpdate(scene: SceneConfig) {
    this.context.reportRenderState(true);
    let resultReady = false;
    let renderStartedAt: number | null = null;

    try {
      const previousPreview = this.detachActivePreview();
      await waitForSubmittedGpuWork(this.context.renderer);
      if (previousPreview) {
        disposePreviewResources(previousPreview, this.context.renderer);
      }
      if (this.disposed) return;
      renderStartedAt = performance.now();
      this.prepareScene(scene);
      const wallFieldCompute = this.wallFieldCompute;
      const wallToLensCompute = this.wallToLensCompute;
      const lensToSensorCompute = this.lensToSensorCompute;
      if (!wallFieldCompute || !wallToLensCompute || !lensToSensorCompute) return;

      await wallFieldCompute.run(this.context.renderer);
      if (this.disposed) return;
      await wallToLensCompute.run(this.context.renderer);
      if (this.disposed) return;
      await lensToSensorCompute.run(this.context.renderer);
      resultReady = !this.disposed;
    } catch (error: unknown) {
      if (!this.disposed) {
        this.context.reportGpuError(error, 'Laser-Berechnung fehlgeschlagen');
      }
    } finally {
      let gpuIdle = false;
      try {
        await waitForSubmittedGpuWork(this.context.renderer);
        gpuIdle = true;
      } catch (error: unknown) {
        if (!this.disposed) {
          this.context.reportGpuError(error, 'GPU-Synchronisierung fehlgeschlagen');
        }
      }
      if (gpuIdle) this.releaseWorkingResources();
      if (!this.disposed && resultReady && gpuIdle) {
        if (renderStartedAt !== null) {
          this.context.reportRenderDuration(performance.now() - renderStartedAt);
        }
        this.completedFrameRevision += 1;
        this.context.requestRender();
      }
      this.context.reportRenderState(false);
    }
  }

  get insetFrameRevision() {
    return this.completedFrameRevision;
  }

  get insetContentAspect() {
    const { sensorWidth, sensorHeight } = opticalPreviewSizes(this.currentScene);
    return sensorWidth / sensorHeight;
  }

  private prepareScene(scene: SceneConfig) {
    this.currentScene = scene;
    this.wallFieldCompute = createWallFieldCompute(scene);
    this.wallToLensCompute = createWallToLensCompute(scene, this.wallFieldCompute);
    this.lensToSensorCompute = createLensToSensorCompute(scene, this.wallToLensCompute);
    const opticalSizes = opticalPreviewSizes(scene);

    const wallMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    wallMaterial.colorNode = texture(this.wallFieldCompute.texture);
    const lensInputMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    lensInputMaterial.colorNode = texture(this.wallToLensCompute.texture);
    const lensOutputMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    lensOutputMaterial.colorNode = texture(this.lensToSensorCompute.lensOutputTexture);
    const sensorMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    sensorMaterial.colorNode = texture(this.lensToSensorCompute.texture);
    this.object3d.add(makeCameraHousingPreview(
      scene,
      opticalSizes.lensDiameter,
      opticalSizes.sensorWidth,
      opticalSizes.sensorHeight,
    ));
    this.object3d.add(makePlanePreview(
      scene,
      'DiffuseWall',
      opticalSizes.wallWidth,
      0x64748b,
      'wall',
      wallMaterial,
      opticalSizes.wallHeight,
      this.wallLabel,
      () => {
        this.wallLabel = this.wallLabel === 'Wand'
          ? 'Raufasertapete'
          : 'Wand';
        this.context.requestRender();
        return this.wallLabel;
      },
      {
        width: opticalSizes.wallWindowWidth,
        height: opticalSizes.wallWindowHeight,
      },
    ));
    this.object3d.add(makeLensPreview(
      scene,
      opticalSizes.lensDiameter,
      lensInputMaterial,
      lensOutputMaterial,
    ));
    this.object3d.add(makePlanePreview(
      scene,
      'Sensor',
      opticalSizes.sensorWidth,
      0x22c55e,
      'sensor',
      sensorMaterial,
      opticalSizes.sensorHeight,
    ));
    this.object3d.add(makeLaserPreview(scene, this.context));
  }

  configureInsetCamera(camera: THREE.OrthographicCamera, aspect: number) {
    const sensorCenter = toPreviewPosition(resolvedSensorCenterForScene(this.currentScene));
    const sensorNormal = sensorNormalForScene(this.currentScene);
    const { sensorWidth, sensorHeight } = opticalPreviewSizes(this.currentScene);
    if (sensorWidth <= 0 || sensorHeight <= 0 || aspect <= 0) return false;

    let halfWidth = sensorWidth * 0.5;
    let halfHeight = sensorHeight * 0.5;
    const sensorAspect = sensorWidth / sensorHeight;
    if (aspect > sensorAspect) {
      halfWidth = halfHeight * aspect;
    } else {
      halfHeight = halfWidth / aspect;
    }

    const orientation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      sensorNormal,
    );
    const cameraDistance = Math.max(sensorWidth, sensorHeight) * 0.75 + 0.15;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.near = 0.01;
    camera.far = Math.max(10, cameraDistance * 4);
    camera.position.copy(sensorCenter).addScaledVector(sensorNormal, cameraDistance);
    camera.up.set(0, 1, 0).applyQuaternion(orientation);
    camera.lookAt(sensorCenter);
    camera.layers.set(sensorInsetLayer);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    void this.releasePreviewResourcesWhenGpuIsIdle();
  }

  private async releasePreviewResourcesWhenGpuIsIdle() {
    if (this.resourceReleaseStarted) return;
    this.resourceReleaseStarted = true;
    try {
      if (this.activeUpdate) await this.activeUpdate;
      const activePreview = this.detachActivePreview();
      await waitForSubmittedGpuWork(this.context.renderer);
      if (activePreview) {
        disposePreviewResources(activePreview, this.context.renderer);
      }
    } catch (error: unknown) {
      this.context.reportGpuError(error, 'GPU-Ressourcen konnten nicht freigegeben werden');
    }
  }

  private detachActivePreview(): LaserPreviewResources | null {
    const hasComputeResources = Boolean(
      this.wallFieldCompute
      || this.wallToLensCompute
      || this.lensToSensorCompute,
    );
    if (this.object3d.children.length === 0 && !hasComputeResources) return null;

    const object3d = new THREE.Group();
    for (const child of [...this.object3d.children]) object3d.add(child);
    const resources = {
      object3d,
      wallFieldCompute: this.wallFieldCompute,
      wallToLensCompute: this.wallToLensCompute,
      lensToSensorCompute: this.lensToSensorCompute,
    };
    this.wallFieldCompute = null;
    this.wallToLensCompute = null;
    this.lensToSensorCompute = null;
    return resources;
  }

  private releaseWorkingResources() {
    const renderer = this.context.renderer;
    this.lensToSensorCompute?.releaseWorkingResources(renderer);
    this.wallToLensCompute?.releaseWorkingResources(renderer);
    this.wallFieldCompute?.releaseWorkingResources(renderer);
  }
}

function disposePreviewResources(
  resources: LaserPreviewResources,
  renderer: THREE.WebGPURenderer,
) {
  disposeObjectTree(resources.object3d);
  resources.object3d.clear();
  disposeComputeResources(resources, renderer);
}

function disposeComputeResources(
  resources: LaserComputeResources,
  renderer: THREE.WebGPURenderer,
) {
  resources.lensToSensorCompute?.dispose(renderer);
  resources.wallToLensCompute?.dispose(renderer);
  resources.wallFieldCompute?.dispose(renderer);
}

async function waitForSubmittedGpuWork(renderer: THREE.WebGPURenderer) {
  const backend = (renderer as RendererWithWebGpuQueue).backend;
  const queue = backend?.device?.queue;
  if (queue) await queue.onSubmittedWorkDone();
}

const previewOriginMm = new THREE.Vector3(128, 128, 0);
const previewPositionScale = 0.005;
const sensorInsetLayer = 2;

function makePlanePreview(
  scene: SceneConfig,
  objectType: string,
  width: number,
  color: number,
  name: string,
  material?: THREE.Material,
  height = width,
  labelText = objectType === 'Sensor' ? 'Sensor' : 'Wand',
  renameOnDoubleClick?: () => string,
  contentSize?: { width: number; height: number },
) {
  const root = new THREE.Group();
  const properties = propertiesFor(scene, objectType);
  const center = objectType === 'Sensor'
    ? resolvedSensorCenterForScene(scene)
    : vectorFrom(properties?.center);
  const normal = objectType === 'Sensor'
    ? sensorNormalForScene(scene)
    : objectType === 'DiffuseWall'
      ? wallNormalForScene(scene)
      : vectorFrom(properties?.normal);
  if (!center || !normal || normal.lengthSq() === 0) return root;

  const geometry = new THREE.PlaneGeometry(width, height);
  const hasSeparateContent = Boolean(
    objectType === 'DiffuseWall' && material && contentSize,
  );
  const planeMaterial = objectType === 'DiffuseWall'
    ? new THREE.MeshBasicMaterial({
      color: 0x000000,
      toneMapped: false,
      side: THREE.FrontSide,
    })
    : material ?? new THREE.MeshBasicMaterial({
      color,
      opacity: 0.28,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  if (objectType === 'DiffuseWall' || objectType === 'Sensor') {
    planeMaterial.side = THREE.FrontSide;
    planeMaterial.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(
    geometry,
    planeMaterial,
  );
  mesh.name = name;
  mesh.position.copy(toPreviewPosition(center));
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal.normalize(),
  );
  mesh.quaternion.copy(orientation);

  if (objectType === 'DiffuseWall') {
    if (hasSeparateContent && material && contentSize) {
      material.side = THREE.FrontSide;
      material.needsUpdate = true;
      const content = new THREE.Mesh(
        new THREE.PlaneGeometry(contentSize.width, contentSize.height),
        material,
      );
      content.name = 'wall-simulation-window';
      content.position.z = 0.002;
      content.renderOrder = 2;
      mesh.add(content);

      const contentFrame = new THREE.LineSegments(
        new THREE.EdgesGeometry(content.geometry),
        new THREE.LineDashedMaterial({
          color: 0xa3a3a3,
          dashSize: 0.035,
          gapSize: 0.025,
          transparent: true,
          opacity: 0.75,
          depthTest: true,
        }),
      );
      contentFrame.name = 'wall-simulation-window-frame';
      contentFrame.position.z = 0.004;
      contentFrame.renderOrder = 3;
      contentFrame.computeLineDistances();
      mesh.add(contentFrame);

      const contentLabelWidth = Math.min(0.42, contentSize.width * 0.8);
      const contentLabel = makePlanarLabel('Simulationsfenster', contentLabelWidth);
      contentLabel.name = 'wall-simulation-window-label';
      contentLabel.position.set(0, contentSize.height * 0.5 + 0.075, 0.012);
      mesh.add(contentLabel);
    }

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.BackSide,
        toneMapped: false,
      }),
    );
    back.name = 'wall-black-back';
    mesh.add(back);
  }

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: objectType === 'Sensor' ? 0x94a3b8 : color,
      transparent: true,
      opacity: 0.9,
    }),
  );
  edges.name = `${name}-outline`;
  mesh.add(edges);
  root.add(mesh);

  if (objectType === 'Sensor') {
    const exteriorMaterial = planeMaterial.clone();
    exteriorMaterial.side = THREE.FrontSide;
    exteriorMaterial.needsUpdate = true;
    const exteriorGeometry = new THREE.PlaneGeometry(width, height);
    const exteriorUv = exteriorGeometry.getAttribute('uv');
    for (let index = 0; index < exteriorUv.count; index += 1) {
      exteriorUv.setY(index, 1 - exteriorUv.getY(index));
    }
    exteriorUv.needsUpdate = true;
    const exteriorDisplay = new THREE.Mesh(exteriorGeometry, exteriorMaterial);
    exteriorDisplay.name = 'sensor-exterior-display';
    exteriorDisplay.position.z = -0.008;
    exteriorDisplay.rotation.y = Math.PI;
    exteriorDisplay.renderOrder = 3;
    mesh.add(exteriorDisplay);

    const insetBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.1, height * 1.1),
      new THREE.MeshBasicMaterial({ color: 0x020617 }),
    );
    insetBackground.position.z = -0.004;
    insetBackground.name = 'sensor-inset-background';
    insetBackground.layers.set(sensorInsetLayer);
    mesh.add(insetBackground);
    root.traverse((object) => {
      if (object !== insetBackground) object.layers.enable(sensorInsetLayer);
    });
    edges.layers.disable(sensorInsetLayer);
  }

  const label = makeFloatingLabel(labelText);
  label.position.copy(mesh.position).add(
    new THREE.Vector3(0, 1, 0)
      .applyQuaternion(orientation)
      .multiplyScalar(height * 0.5 + (objectType === 'Sensor' ? 0.64 : 0.16)),
  );
  root.add(label);
  if (renameOnDoubleClick) {
    mesh.userData.previewDoubleClickAction = () => {
      setFloatingLabelText(label, renameOnDoubleClick());
    };
  }

  return root;
}

function makeCameraHousingPreview(
  scene: SceneConfig,
  lensDiameter: number,
  sensorWidth: number,
  sensorHeight: number,
) {
  const root = new THREE.Group();
  const lens = propertiesFor(scene, 'Lens');
  const lensCenter = vectorFrom(lens?.center);
  if (!lensCenter) return root;

  const front = toPreviewPosition(lensCenter);
  const back = toPreviewPosition(resolvedSensorCenterForScene(scene));
  const axis = back.clone().sub(front);
  const depth = axis.length();
  if (depth <= 1e-6) return root;

  const bodyWidth = Math.max(lensDiameter * 1.52, sensorWidth * 1.48);
  const bodyHeight = Math.max(lensDiameter * 1.42, sensorHeight * 1.4);
  const frontZ = -depth * 0.5;
  const backZ = depth * 0.5;
  const bodyDepth = depth * 0.46;
  const bodyFrontZ = backZ - bodyDepth;
  const bodyCenterZ = backZ - bodyDepth * 0.5;
  const barrelLength = bodyFrontZ - frontZ + depth * 0.035;
  const barrelCenterZ = frontZ + barrelLength * 0.5;
  const barrelRadius = lensDiameter * 0.55;
  const camera = new THREE.Group();
  camera.name = 'camera-model';
  camera.position.copy(front).add(back).multiplyScalar(0.5);
  camera.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    axis.normalize(),
  );
  root.add(camera);

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x3b4a60,
    roughness: 0.2,
    metalness: 0.08,
    transmission: 0.48,
    transparent: true,
    opacity: 0.26,
    thickness: 0.04,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const barrelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x64748b,
    roughness: 0.12,
    metalness: 0.12,
    transmission: 0.58,
    transparent: true,
    opacity: 0.22,
    thickness: 0.025,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const frameMaterial = new THREE.MeshBasicMaterial({
    color: 0x364152,
    transparent: true,
    opacity: 0.82,
  });
  const accentMaterial = new THREE.MeshBasicMaterial({ color: 0x172033 });
  const metalMaterial = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });

  const bodyGeometry = makeRoundedBoxGeometry(
    bodyWidth,
    bodyHeight,
    bodyDepth,
    Math.min(bodyWidth, bodyHeight) * 0.075,
  );
  const body = new THREE.Mesh(bodyGeometry, shellMaterial);
  body.name = 'camera-transparent-body';
  body.position.z = bodyCenterZ;
  body.renderOrder = 0;
  camera.add(body);

  const barrelGeometry = new THREE.CylinderGeometry(
    barrelRadius * 0.92,
    barrelRadius,
    barrelLength,
    48,
    1,
    false,
  );
  barrelGeometry.rotateX(Math.PI * 0.5);
  const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrel.name = 'camera-transparent-lens-barrel';
  barrel.position.z = barrelCenterZ;
  barrel.renderOrder = 0;
  camera.add(barrel);

  for (const offset of [0.3, 0.68]) {
    const ringRadius = THREE.MathUtils.lerp(
      barrelRadius,
      barrelRadius * 0.92,
      offset,
    );
    const focusBand = new THREE.Mesh(
      new THREE.TorusGeometry(ringRadius + 0.008, 0.011, 8, 48),
      frameMaterial,
    );
    focusBand.name = 'camera-focus-ring';
    focusBand.position.z = frontZ + barrelLength * offset;
    camera.add(focusBand);
  }

  const frameDepth = Math.max(0.018, depth * 0.024);
  const displayBacking = new THREE.Mesh(
    makeRoundedFrameGeometry(
      sensorWidth * 1.075,
      sensorHeight * 1.075,
      frameDepth,
      Math.min(sensorWidth, sensorHeight) * 0.035,
      Math.max(0.022, Math.min(sensorWidth, sensorHeight) * 0.026),
    ),
    accentMaterial,
  );
  displayBacking.name = 'camera-rear-display-frame';
  displayBacking.position.z = backZ - frameDepth * 0.5 + 0.002;
  camera.add(displayBacking);

  const lensMount = new THREE.Mesh(
    new THREE.TorusGeometry(
      lensDiameter * 0.5 + Math.max(0.018, lensDiameter * 0.025),
      Math.max(0.014, lensDiameter * 0.018),
      10,
      48,
    ),
    accentMaterial,
  );
  lensMount.name = 'camera-lens-mount';
  lensMount.position.z = frontZ - frameDepth * 0.6;
  camera.add(lensMount);

  const bodyMount = new THREE.Mesh(
    new THREE.TorusGeometry(
      barrelRadius * 0.94,
      Math.max(0.016, lensDiameter * 0.022),
      10,
      48,
    ),
    accentMaterial,
  );
  bodyMount.name = 'camera-body-lens-mount';
  bodyMount.position.z = bodyFrontZ - frameDepth * 0.62;
  camera.add(bodyMount);

  const gripWidth = bodyWidth * 0.18;
  const grip = new THREE.Mesh(
    makeRoundedBoxGeometry(
      gripWidth,
      bodyHeight * 0.72,
      bodyDepth * 0.7,
      gripWidth * 0.22,
    ),
    new THREE.MeshBasicMaterial({
      color: 0x273449,
      transparent: true,
      opacity: 0.76,
    }),
  );
  grip.name = 'camera-hand-grip';
  grip.position.set(
    bodyWidth * 0.5 + gripWidth * 0.28,
    -bodyHeight * 0.08,
    bodyCenterZ + bodyDepth * 0.04,
  );
  camera.add(grip);

  for (const y of [-0.18, -0.05, 0.08]) {
    const gripLine = new THREE.Mesh(
      new THREE.BoxGeometry(gripWidth + 0.008, 0.012, bodyDepth * 0.46),
      accentMaterial,
    );
    gripLine.name = 'camera-grip-line';
    gripLine.position.set(
      bodyWidth * 0.5 + gripWidth * 0.28,
      y * bodyHeight,
      bodyCenterZ + bodyDepth * 0.1,
    );
    camera.add(gripLine);
  }

  const viewfinderWidth = bodyWidth * 0.3;
  const viewfinderHeight = bodyHeight * 0.18;
  const viewfinderDepth = bodyDepth * 0.46;
  const viewfinder = new THREE.Mesh(
    makeRoundedBoxGeometry(
      viewfinderWidth,
      viewfinderHeight,
      viewfinderDepth,
      viewfinderHeight * 0.22,
    ),
    frameMaterial,
  );
  viewfinder.name = 'camera-viewfinder';
  viewfinder.position.set(
    -bodyWidth * 0.08,
    bodyHeight * 0.5 + viewfinderHeight * 0.5,
    backZ - viewfinderDepth * 0.5,
  );
  camera.add(viewfinder);

  const viewfinderGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(viewfinderWidth * 0.42, viewfinderHeight * 0.38),
    new THREE.MeshBasicMaterial({
      color: 0x93c5d8,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    }),
  );
  viewfinderGlass.name = 'camera-viewfinder-glass';
  viewfinderGlass.position.set(
    -bodyWidth * 0.08,
    bodyHeight * 0.5 + viewfinderHeight * 0.5,
    backZ + 0.012,
  );
  camera.add(viewfinderGlass);

  const shutter = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.max(0.018, gripWidth * 0.18),
      Math.max(0.02, gripWidth * 0.2),
      Math.max(0.018, bodyHeight * 0.035),
      16,
    ),
    new THREE.MeshBasicMaterial({ color: 0x64748b }),
  );
  shutter.name = 'camera-shutter-button';
  const gripCenterY = -bodyHeight * 0.08;
  const gripTopY = gripCenterY + bodyHeight * 0.72 * 0.5;
  const shutterHeight = Math.max(0.018, bodyHeight * 0.035);
  shutter.position.set(
    bodyWidth * 0.5 + gripWidth * 0.28,
    gripTopY + shutterHeight * 0.5,
    bodyCenterZ - bodyDepth * 0.22,
  );
  camera.add(shutter);

  const modeDial = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.max(0.038, bodyWidth * 0.045),
      Math.max(0.038, bodyWidth * 0.045),
      Math.max(0.02, bodyHeight * 0.03),
      24,
    ),
    accentMaterial,
  );
  modeDial.name = 'camera-mode-dial';
  modeDial.position.set(
    -bodyWidth * 0.31,
    bodyHeight * 0.5 + Math.max(0.01, bodyHeight * 0.015),
    bodyCenterZ - bodyDepth * 0.16,
  );
  camera.add(modeDial);

  for (const y of [-0.18, -0.04, 0.1]) {
    const rearButton = makeCylinderAlongZ(0.018, 0.018, 0.012, metalMaterial);
    rearButton.name = 'camera-rear-button';
    rearButton.position.set(
      -bodyWidth * 0.42,
      y * bodyHeight,
      backZ + frameDepth,
    );
    camera.add(rearButton);
  }

  const rearDial = new THREE.Mesh(
    new THREE.TorusGeometry(0.052, 0.009, 8, 28),
    metalMaterial,
  );
  rearDial.name = 'camera-rear-dial';
  rearDial.position.set(bodyWidth * 0.4, bodyHeight * 0.36, backZ + frameDepth);
  camera.add(rearDial);

  const basePlate = new THREE.Mesh(
    new THREE.BoxGeometry(bodyWidth * 0.62, 0.025, bodyDepth * 0.72),
    accentMaterial,
  );
  basePlate.name = 'camera-base-plate';
  basePlate.position.set(0, -bodyHeight * 0.5 - 0.013, bodyCenterZ);
  camera.add(basePlate);

  const tripodSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.006, 20),
    metalMaterial,
  );
  tripodSocket.name = 'camera-tripod-socket';
  tripodSocket.position.set(0, -bodyHeight * 0.5 - 0.029, bodyCenterZ);
  camera.add(tripodSocket);

  return root;
}

function makeRoundedFrameGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
  barSize: number,
) {
  const outer = roundedRectangleShape(width, height, radius);
  const innerWidth = Math.max(barSize, width - barSize * 2);
  const innerHeight = Math.max(barSize, height - barSize * 2);
  const hole = roundedRectanglePath(
    innerWidth,
    innerHeight,
    Math.max(0, radius - barSize),
    true,
  );
  outer.holes.push(hole);
  return extrudeCenteredShape(outer, depth, Math.min(radius * 0.1, depth * 0.06));
}

function makeRoundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
) {
  const shape = roundedRectangleShape(width, height, radius);
  const bevel = Math.min(radius * 0.16, depth * 0.08);
  return extrudeCenteredShape(shape, depth, bevel);
}

function roundedRectangleShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  addRoundedRectangle(shape, width, height, radius, false);
  return shape;
}

function roundedRectanglePath(
  width: number,
  height: number,
  radius: number,
  clockwise: boolean,
) {
  const path = new THREE.Path();
  addRoundedRectangle(path, width, height, radius, clockwise);
  return path;
}

function addRoundedRectangle(
  path: THREE.Path,
  width: number,
  height: number,
  radius: number,
  clockwise: boolean,
) {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const cornerRadius = Math.min(radius, halfWidth, halfHeight);
  if (clockwise) {
    path.moveTo(-halfWidth + cornerRadius, -halfHeight);
    path.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth, -halfHeight + cornerRadius);
    path.lineTo(-halfWidth, halfHeight - cornerRadius);
    path.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth + cornerRadius, halfHeight);
    path.lineTo(halfWidth - cornerRadius, halfHeight);
    path.quadraticCurveTo(halfWidth, halfHeight, halfWidth, halfHeight - cornerRadius);
    path.lineTo(halfWidth, -halfHeight + cornerRadius);
    path.quadraticCurveTo(halfWidth, -halfHeight, halfWidth - cornerRadius, -halfHeight);
    path.lineTo(-halfWidth + cornerRadius, -halfHeight);
    return;
  }

  path.moveTo(-halfWidth + cornerRadius, -halfHeight);
  path.lineTo(halfWidth - cornerRadius, -halfHeight);
  path.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + cornerRadius);
  path.lineTo(halfWidth, halfHeight - cornerRadius);
  path.quadraticCurveTo(halfWidth, halfHeight, halfWidth - cornerRadius, halfHeight);
  path.lineTo(-halfWidth + cornerRadius, halfHeight);
  path.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - cornerRadius);
  path.lineTo(-halfWidth, -halfHeight + cornerRadius);
  path.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + cornerRadius, -halfHeight);
}

function extrudeCenteredShape(shape: THREE.Shape, depth: number, bevel: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    steps: 1,
    curveSegments: 12,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
  });
  geometry.translate(0, 0, -depth * 0.5 + bevel);
  return geometry;
}

function makeLensPreview(
  scene: SceneConfig,
  diameter: number,
  inputMaterial: THREE.Material,
  outputMaterial: THREE.Material,
) {
  const root = new THREE.Group();
  const lens = propertiesFor(scene, 'Lens');
  const center = vectorFrom(lens?.center);
  const normal = lensNormalForScene(scene);
  if (!center || !normal || normal.lengthSq() === 0) return root;

  root.name = 'lens';
  root.position.copy(toPreviewPosition(center));
  root.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal.normalize(),
  );

  const radius = diameter * 0.5;
  const thickness = Math.max(0.045, Math.min(0.12, diameter * 0.12));
  const halfThickness = thickness * 0.5;
  const glassGeometry = new THREE.CylinderGeometry(radius, radius, thickness, 64);
  glassGeometry.rotateX(Math.PI * 0.5);
  const glass = new THREE.Mesh(
    glassGeometry,
    new THREE.MeshPhysicalMaterial({
      color: 0xb9e6ff,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.72,
      transparent: true,
      opacity: 0.3,
      thickness,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.name = 'lens-glass';
  root.add(glass);

  inputMaterial.side = THREE.BackSide;
  inputMaterial.needsUpdate = true;
  const inputField = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    inputMaterial,
  );
  inputField.name = 'lens-input-field';
  inputField.position.z = -halfThickness - 0.002;
  inputField.renderOrder = 2;
  root.add(inputField);

  outputMaterial.side = THREE.FrontSide;
  outputMaterial.needsUpdate = true;
  const outputField = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    outputMaterial,
  );
  outputField.name = 'lens-output-field';
  outputField.position.z = halfThickness + 0.002;
  outputField.renderOrder = 2;
  root.add(outputField);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, Math.max(0.006, diameter * 0.009), 10, 64),
    new THREE.MeshBasicMaterial({
      color: 0xd7f3ff,
      transparent: true,
      opacity: 0.78,
    }),
  );
  rim.name = 'lens-rim';
  rim.renderOrder = 3;
  root.add(rim);

  const label = makeFloatingLabel('Linse');
  label.position.set(0, radius + 0.7, 0);
  root.add(label);

  return root;
}

function makeFloatingLabel(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  drawFloatingLabel(canvas, text);

  const labelTexture = new THREE.CanvasTexture(canvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.minFilter = THREE.LinearFilter;
  const labelMaterial = new THREE.SpriteMaterial({
    map: labelTexture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const label = new THREE.Sprite(labelMaterial);
  label.name = `${text.toLowerCase()}-label`;
  label.scale.set(0.64, 0.16, 1);
  label.renderOrder = 20;
  label.userData.setPreviewLabelText = (nextText: string) => {
    drawFloatingLabel(canvas, nextText);
    labelTexture.needsUpdate = true;
    label.name = `${nextText.toLowerCase()}-label`;
  };
  return label;
}

function makePlanarLabel(text: string, width: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  drawFloatingLabel(canvas, text);

  const labelTexture = new THREE.CanvasTexture(canvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.minFilter = THREE.LinearFilter;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.25),
    new THREE.MeshBasicMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
    }),
  );
  label.renderOrder = 4;
  return label;
}

function setFloatingLabelText(label: THREE.Sprite, text: string) {
  const setter = label.userData.setPreviewLabelText;
  if (typeof setter === 'function') setter(text);
}

function drawFloatingLabel(canvas: HTMLCanvasElement, text: string) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '700 64px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.shadowColor = 'rgba(0, 0, 0, 0.85)';
  context.shadowBlur = 10;
  context.fillText(
    text,
    canvas.width * 0.5,
    canvas.height * 0.5,
    canvas.width - 24,
  );
}

const opticalPreviewScale = 0.2;

function opticalPreviewSizes(scene: SceneConfig) {
  const lens = propertiesFor(scene, 'Lens');
  const wall = propertiesFor(scene, 'DiffuseWall');
  const dimensions = laserSamplingDimensions(scene);
  const apertureRadiusMm = positiveNumber(lens?.apertureRadiusMm, 2.56);
  const wallWidthMm = positiveNumber(wall?.widthMm, 11);
  const wallHeightMm = positiveNumber(wall?.heightMm, 11);

  return {
    lensDiameter: apertureRadiusMm * 2 * opticalPreviewScale,
    sensorWidth: dimensions.sensorPhysicalWidthMm * opticalPreviewScale,
    sensorHeight: dimensions.sensorPhysicalHeightMm * opticalPreviewScale,
    wallWidth: wallWidthMm * opticalPreviewScale,
    wallHeight: wallHeightMm * opticalPreviewScale,
    wallWindowWidth: dimensions.wallWindowWidthMm * opticalPreviewScale,
    wallWindowHeight: dimensions.wallWindowHeightMm * opticalPreviewScale,
  };
}

function makeLaserPreview(scene: SceneConfig, context: PreviewContext) {
  const root = new THREE.Group();
  const laser = propertiesFor(scene, 'Laser');
  const center = vectorFrom(laser?.center);
  if (!center) return root;
  const direction = laserDirectionForScene(scene);
  const isOn = laser?.on !== false;

  const start = toLaserPreviewPosition(scene, center);
  const normalizedDirection = direction.normalize();
  const end = laserIntersectionWithWall(scene, center, normalizedDirection)
    ?? start.clone().add(normalizedDirection.clone().multiplyScalar(1.25));

  if (isOn) {
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineBasicMaterial({ color: 0xef4444 }),
    );
    beam.name = 'laser-beam';
    root.add(beam);
  }

  const source = makeLaserPointerModel(isOn, () => {
    context.updateObjectPropertyAndRerender('Laser', 'on', !isOn);
  });
  source.position.copy(start);
  source.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normalizedDirection,
  );
  source.name = 'laser-source';
  root.add(source);
  return root;
}

function makeLaserPointerModel(isOn: boolean, toggle: () => void) {
  const pointer = new THREE.Group();
  const bodyLength = 0.3;
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
  const darkMetalMaterial = new THREE.MeshBasicMaterial({ color: 0x292524 });

  const body = makeCylinderAlongZ(0.052, 0.058, bodyLength, bodyMaterial);
  body.position.z = -bodyLength * 0.5;
  body.name = 'laser-pointer-body';
  pointer.add(body);

  const frontBezel = makeCylinderAlongZ(0.06, 0.052, 0.045, darkMetalMaterial);
  frontBezel.position.z = -0.0225;
  frontBezel.name = 'laser-pointer-front-bezel';
  pointer.add(frontBezel);

  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.042, 24),
    new THREE.MeshBasicMaterial({ color: isOn ? 0xff2d2d : 0x3f3f46 }),
  );
  lens.position.z = 0.001;
  lens.name = 'laser-pointer-lens';
  pointer.add(lens);

  const rearCap = makeCylinderAlongZ(0.05, 0.055, 0.035, darkMetalMaterial);
  rearCap.position.z = -bodyLength - 0.0175;
  rearCap.name = 'laser-pointer-rear-cap';
  pointer.add(rearCap);

  for (const z of [-0.095, -0.13, -0.165]) {
    const gripRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.006, 8, 24),
      darkMetalMaterial,
    );
    gripRing.position.z = z;
    gripRing.name = 'laser-pointer-grip-ring';
    pointer.add(gripRing);
  }

  const button = new THREE.Mesh(
    new THREE.BoxGeometry(0.042, 0.022, 0.065),
    new THREE.MeshBasicMaterial({ color: isOn ? 0xd6d3d1 : 0x57534e }),
  );
  button.position.set(0, isOn ? 0.06 : 0.054, -0.105);
  button.name = 'laser-pointer-button';
  button.userData.previewClickAction = toggle;
  pointer.add(button);

  const buttonHitArea = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.06, 0.11),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  buttonHitArea.position.set(0, 0.075, -0.105);
  buttonHitArea.name = 'laser-pointer-button-hit-area';
  buttonHitArea.userData.previewClickAction = toggle;
  pointer.add(buttonHitArea);

  return pointer;
}

function makeCylinderAlongZ(
  radiusFront: number,
  radiusRear: number,
  length: number,
  material: THREE.Material,
) {
  const geometry = new THREE.CylinderGeometry(
    radiusFront,
    radiusRear,
    length,
    24,
  );
  geometry.rotateX(Math.PI * 0.5);
  return new THREE.Mesh(geometry, material);
}

function laserIntersectionWithWall(
  scene: SceneConfig,
  laserCenterMm: THREE.Vector3,
  laserDirection: THREE.Vector3,
) {
  const wall = propertiesFor(scene, 'DiffuseWall');
  const wallCenter = vectorFrom(wall?.center);
  const wallNormal = wallNormalForScene(scene);
  if (!wallCenter) return null;

  const denominator = wallNormal.dot(laserDirection);
  if (Math.abs(denominator) < 1e-6) return null;

  const distanceMm = wallCenter.clone().sub(laserCenterMm).dot(wallNormal) / denominator;
  if (distanceMm <= 0) return null;

  return toLaserPreviewPosition(
    scene,
    laserCenterMm.clone().add(laserDirection.clone().multiplyScalar(distanceMm)),
  );
}

function vectorFrom(value: unknown) {
  if (!isVector3(value)) return null;
  return new THREE.Vector3(...vectorComponents(value));
}

function toPreviewPosition(positionMm: THREE.Vector3) {
  return positionMm.clone().sub(previewOriginMm).multiplyScalar(previewPositionScale);
}

function toLaserPreviewPosition(scene: SceneConfig, positionMm: THREE.Vector3) {
  const wall = propertiesFor(scene, 'DiffuseWall');
  const wallCenter = vectorFrom(wall?.center);
  if (!wallCenter) return toPreviewPosition(positionMm);

  const dimensions = laserSamplingDimensions(scene);
  const previewSizes = opticalPreviewSizes(scene);

  const wallNormal = wallNormalForScene(scene);
  const { right: fieldRight, up: fieldUp } = planeBasis(wallNormal);
  const wallOrientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    wallNormal,
  );
  const previewRight = new THREE.Vector3(1, 0, 0).applyQuaternion(wallOrientation);
  const previewUp = new THREE.Vector3(0, 1, 0).applyQuaternion(wallOrientation);
  const relative = positionMm.clone().sub(wallCenter);

  return toPreviewPosition(wallCenter)
    .addScaledVector(wallNormal, relative.dot(wallNormal) * previewPositionScale)
    .addScaledVector(
      previewRight,
      relative.dot(fieldRight) * previewSizes.wallWindowWidth
        / dimensions.wallWindowWidthMm,
    )
    .addScaledVector(
      previewUp,
      relative.dot(fieldUp) * previewSizes.wallWindowHeight
        / dimensions.wallWindowHeightMm,
    );
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Line | THREE.LineSegments | THREE.Sprite;
    if (!(renderable as THREE.Sprite).isSprite) renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

function disposeMaterial(material: THREE.Material) {
  const map = (material as THREE.Material & { map?: THREE.Texture | null }).map;
  map?.dispose();
  material.dispose();
}
