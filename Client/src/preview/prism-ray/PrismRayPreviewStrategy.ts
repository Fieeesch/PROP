import * as THREE from 'three';
import { AreaLight, type AreaLightJson } from './AreaLight';
import { RectPlane, type RectPlaneJson } from './RectPlane';
import { httpRenderBackendCommunication } from '../../backend/http/HttpRenderBackendCommunication';
import type { RendererCapabilities } from '../../model/RendererCapabilities';
import type { PrismJson, SceneConfig } from '../../model/SceneConfig';
import type { Vector3 } from '../../model/Vector3';
import type { PreviewInstance, RendererStrategy } from '../RendererStrategy';

interface PreviewPlane {
  point: Vector3;
  normal: Vector3;
  right: Vector3;
  up: Vector3;
  width: number;
  height: number;
}
interface PreviewLight {
  center: Vector3;
  direction: Vector3;
  right: Vector3;
  up: Vector3;
  shape: 'circle' | 'area';
  radius: number;
  width: number;
  height: number;
}
interface PreviewPrism {
  planes: RectPlane[];
  material: string;
}
export function buildPrismRayPreview(scene: SceneConfig, maxBounces: number) {
  const group = new THREE.Group();
  const imagePlane = firstPlaneObject(scene, 'ImagePlane');
  const prism = firstPrismObject(scene);
  const prismPlanes = prism?.planes ?? [];
  const light = firstLightObject(scene);

  group.add(makeGrid());
  if (imagePlane) {
    group.add(makePlaneMesh(imagePlane, 0x5eead4, 0.32, 'image'));
  }
  prismPlanes.forEach((plane, index) => {
    const colors = [0x60a5fa, 0xa78bfa, 0xf472b6];
    group.add(makePlaneMesh(plane, colors[index] ?? 0xa78bfa, 0.36, `prism-${index + 1}`));
  });
  if (light) {
    group.add(makeLightMesh(light));
  }
  group.add(makePrismEdges(prismPlanes));
  if (imagePlane && light) {
    group.add(makeDispersionRay(imagePlane, prismPlanes, prism?.material ?? 'bk7', light, maxBounces));
  }

  return group;
}

export const prismRayRendererStrategy: RendererStrategy = {
  id: 'prism-ray',
  backendCommunication: httpRenderBackendCommunication,

  create(scene, capabilities) {
    return new PrismRayPreviewInstance(scene, capabilities.preview.maxBounces);
  },
};

class PrismRayPreviewInstance implements PreviewInstance {
  readonly object3d = new THREE.Group();

  constructor(scene: SceneConfig, maxBounces: number) {
    this.updatePreview(scene, maxBounces);
  }

  update(scene: SceneConfig, capabilities: RendererCapabilities) {
    this.updatePreview(scene, capabilities.preview.maxBounces);
  }

  dispose() {
    disposeObjectTree(this.object3d);
    this.object3d.clear();
  }

  private updatePreview(scene: SceneConfig, maxBounces: number) {
    // The stable root remains attached to Three.js. Only this strategy owns and
    // refreshes its renderer-specific visual objects.
    disposeObjectTree(this.object3d);
    this.object3d.clear();
    this.object3d.add(buildPrismRayPreview(scene, maxBounces));
  }
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Line | THREE.LineSegments;
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function planeObjects(scene: SceneConfig, objectType: string) {
  return scene.objects
    .filter((object) => object.objectType === objectType)
    .map((object) => rectPlaneFromProperties(object.properties))
    .filter((plane): plane is RectPlane => Boolean(plane));
}

function firstPlaneObject(scene: SceneConfig, objectType: string) {
  return planeObjects(scene, objectType)[0] ?? null;
}

function firstPrismObject(scene: SceneConfig) {
  const object = scene.objects.find((item) => item.objectType === 'Prism');
  if (!object) {
    return null;
  }

  try {
    return prismFromProperties(object.properties as PrismJson);
  } catch {
    return null;
  }
}
function firstLightObject(scene: SceneConfig) {
  const object = scene.objects.find((item) => item.objectType === 'CircleLight')
    ?? scene.objects.find((item) => item.objectType === 'AreaLight');
  if (!object) {
    return null;
  }

  try {
    const light = AreaLight.fromJson(object.properties as AreaLightJson);
    const properties = object.properties as { width?: number; height?: number; radius?: number };
    const isArea = object.objectType === 'AreaLight';
    const width = isArea ? properties.width ?? light.radius * 2 : light.radius * 2;
    const height = isArea ? properties.height ?? light.radius * 2 : light.radius * 2;
    return {
      center: light.center,
      direction: light.direction,
      right: light.right,
      up: light.up,
      shape: isArea ? 'area' : 'circle',
      radius: light.radius,
      width,
      height,
    } satisfies PreviewLight;
  } catch {
    return null;
  }
}

function rectPlaneFromProperties(properties: unknown) {
  try {
    return RectPlane.fromJson(properties as RectPlaneJson);
  } catch {
    return null;
  }
}

function prismFromProperties(properties: PrismJson) {
  const position = Array.isArray(properties.position)
    ? { x: properties.position[0], y: properties.position[1] }
    : properties.position;
  const alpha = THREE.MathUtils.degToRad(properties.prismAngleDeg);
  const halfAlpha = alpha * 0.5;
  const localVertices = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(-properties.radius * Math.sin(halfAlpha), -properties.radius * Math.cos(halfAlpha)),
    new THREE.Vector2(properties.radius * Math.sin(halfAlpha), -properties.radius * Math.cos(halfAlpha)),
  ];
  const rotation = THREE.MathUtils.degToRad(properties.rotationDeg);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const vertices = localVertices.map((vertex) => new THREE.Vector2(
    cos * vertex.x - sin * vertex.y + position.x,
    sin * vertex.x + cos * vertex.y + position.y,
  ));

  return {
    material: typeof properties.material === 'string' ? properties.material : 'bk7',
    planes: vertices.map((a, index): RectPlane => {
      const b = vertices[(index + 1) % vertices.length];
      const edge = b.clone().sub(a);
      const edgeLength = edge.length();
      const edgeDir = edge.clone().normalize();
      const midpoint = a.clone().add(b).multiplyScalar(0.5);

      return RectPlane.fromJson({
        point: [midpoint.x, midpoint.y, 0],
        normal: [edgeDir.y, -edgeDir.x, 0],
        right: [0, 0, 1],
        up: [-edgeDir.x, -edgeDir.y, 0],
        width: properties.zDepth,
        height: edgeLength,
      });
    }),
  } satisfies PreviewPrism;
}
function makePlaneMesh(plane: PreviewPlane, color: number, opacity: number, name: string) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(plane.width, plane.height),
    new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );

  orientRect(mesh, plane);
  mesh.name = name;

  const normal = toThree(plane.normal).normalize();
  const arrow = new THREE.ArrowHelper(normal, toThree(plane.point), 0.22, color, 0.06, 0.035);
  const wrapper = new THREE.Group();
  wrapper.add(mesh);
  wrapper.add(arrow);
  return wrapper;
}

function makeLightMesh(light: PreviewLight) {
  const geometry = light.shape === 'area'
    ? new THREE.PlaneGeometry(light.width, light.height)
    : new THREE.CircleGeometry(light.radius, 32);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      opacity: 0.72,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );

  orientRect(mesh, {
    point: light.center,
    normal: light.direction,
    right: light.right,
    up: light.up,
    width: light.width,
    height: light.height,
  });

  const direction = toThree(light.direction).normalize();
  const arrow = new THREE.ArrowHelper(direction, toThree(light.center), 0.24, 0xfacc15, 0.06, 0.035);
  const wrapper = new THREE.Group();
  wrapper.add(mesh);
  wrapper.add(arrow);
  return wrapper;
}

function makePrismEdges(prismPlanes: RectPlane[]) {
  const rects = prismPlanes.map(getRectCorners);
  if (rects.length === 0) {
    return new THREE.Group();
  }

  const points: THREE.Vector3[] = [];
  for (const corners of rects) {
    for (let i = 0; i < 4; i++) {
      points.push(corners[i], corners[(i + 1) % 4]);
    }
  }

  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xe5e7eb, transparent: true, opacity: 0.7 }),
  );
}

function makeDispersionRay(
  imagePlane: RectPlane,
  prismPlanes: RectPlane[],
  prismMaterial: string,
  light: PreviewLight,
  maxBounces: number,
) {
  const rays = new THREE.Group();
  if (prismPlanes.length === 0 || maxBounces <= 0) {
    return rays;
  }

  const incomingDirection = toThree(light.direction).normalize();
  const lightCenter = toThree(light.center);
  const source = lightCenter.clone();
  const entry = intersectClosestRect(source, incomingDirection, prismPlanes);

  if (!entry) {
    return rays;
  }

  rays.add(makeLine([source, entry.point], 0xf8fafc, 0.92));
  if (maxBounces <= 1) {
    return rays;
  }

  const spectralRays = spectralRaysForMaterial(prismMaterial);

  for (const ray of spectralRays) {
    const insideDirection = refract(incomingDirection, toThree(entry.plane.normal), 1.0, ray.ior);
    if (!insideDirection) {
      continue;
    }

    const exit = intersectClosestRect(
      entry.point.clone().add(insideDirection.clone().multiplyScalar(0.001)),
      insideDirection,
      prismPlanes.filter((plane) => plane !== entry.plane),
    );

    if (!exit || maxBounces <= 2) {
      rays.add(makeLine([entry.point, entry.point.clone().add(insideDirection.clone().multiplyScalar(1.1))], ray.color, 0.85));
      continue;
    }

    const outgoingDirection = refract(insideDirection, toThree(exit.plane.normal), ray.ior, 1.0);
    if (!outgoingDirection) {
      rays.add(makeLine([entry.point, exit.point], ray.color, 0.9));
      continue;
    }

    const finalDirection = outgoingDirection;
    const imageHit = maxBounces > 3
      ? intersectRect(
          exit.point.clone().add(finalDirection.clone().multiplyScalar(0.001)),
          finalDirection,
          imagePlane,
        )?.point ?? null
      : null;
    const end = imageHit ?? exit.point.clone().add(finalDirection.clone().multiplyScalar(1.85));

    rays.add(makeLine([entry.point, exit.point, end], ray.color, 0.9));
  }

  return rays;
}

function spectralRaysForMaterial(material: string) {
  // SF57
  if (material === 'sf57') {
    return [
      { color: 0xef4444, ior: 1.834862 }, // red, 670nm
      { color: 0xf97316, ior: 1.843712 }, // orange, 605nm
      { color: 0xfacc15, ior: 1.848034 }, // yellow, 580nm
      { color: 0x22c55e, ior: 1.857673 }, // green,  535nm
      { color: 0x38bdf8, ior: 1.874317 }, // blue, 480nm
      { color: 0x8b5cf6, ior: 1.903644 }, // violet, 420nm
    ];
  }

  // LAK34
  if (material === 'lak34') {
    return [
      { color: 0xef4444, ior: 1.724411 }, // red, 670nm
      { color: 0xf97316, ior: 1.728004 }, // orange, 605nm
      { color: 0xfacc15, ior: 1.729692 }, // yellow, 580nm
      { color: 0x22c55e, ior: 1.733326 }, // green,  535nm
      { color: 0x38bdf8, ior: 1.739230 }, // blue, 480nm
      { color: 0x8b5cf6, ior: 1.748642 }, // violet, 420nm
    ];
  }

  // FK51A
  if (material === 'fk51a') {
    return [
      { color: 0xef4444, ior: 1.484502 }, // red, 670nm
      { color: 0xf97316, ior: 1.486061 }, // orange, 605nm
      { color: 0xfacc15, ior: 1.486791 }, // yellow, 580nm
      { color: 0x22c55e, ior: 1.488356 }, // green,  535nm
      { color: 0x38bdf8, ior: 1.490882 }, // blue, 480nm
      { color: 0x8b5cf6, ior: 1.494860 }, // violet, 420nm
    ];
  }

  // BK7
  return [
    { color: 0xef4444, ior: 1.513905 }, // red, 670nm
    { color: 0xf97316, ior: 1.516100 }, // orange, 605nm
    { color: 0xfacc15, ior: 1.517122 }, // yellow, 580nm
    { color: 0x22c55e, ior: 1.519308 }, // green,  535nm
    { color: 0x38bdf8, ior: 1.522829 }, // blue, 480nm
    { color: 0x8b5cf6, ior: 1.528385 }, // violet, 420nm
  ];
}

function makeGrid() {
  const grid = new THREE.GridHelper(4, 16, 0x374151, 0x1f2937);
  grid.position.y = -1.25;
  return grid;
}

function getRectCorners(plane: RectPlane) {
  const center = toThree(plane.point);
  const right = toThree(plane.right).normalize();
  const up = toThree(plane.up).normalize();
  const halfWidth = plane.width * 0.5;
  const halfHeight = plane.height * 0.5;

  return [
    center.clone().add(right.clone().multiplyScalar(-halfWidth)).add(up.clone().multiplyScalar(-halfHeight)),
    center.clone().add(right.clone().multiplyScalar(halfWidth)).add(up.clone().multiplyScalar(-halfHeight)),
    center.clone().add(right.clone().multiplyScalar(halfWidth)).add(up.clone().multiplyScalar(halfHeight)),
    center.clone().add(right.clone().multiplyScalar(-halfWidth)).add(up.clone().multiplyScalar(halfHeight)),
  ];
}

function orientRect(object: THREE.Object3D, plane: PreviewPlane) {
  const right = toThree(plane.right).normalize();
  const up = toThree(plane.up).normalize();
  const normal = toThree(plane.normal).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, normal);

  object.position.copy(toThree(plane.point));
  object.quaternion.setFromRotationMatrix(basis);
}

function makeLine(points: THREE.Vector3[], color: number, opacity: number) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function intersectClosestRect(origin: THREE.Vector3, direction: THREE.Vector3, planes: RectPlane[]) {
  let closest: { plane: RectPlane; point: THREE.Vector3; t: number } | null = null;
  for (const plane of planes) {
    const hit = intersectRect(origin, direction, plane);
    if (hit && (!closest || hit.t < closest.t)) {
      closest = { plane, ...hit };
    }
  }
  return closest;
}

function intersectRect(origin: THREE.Vector3, direction: THREE.Vector3, plane: PreviewPlane) {
  const point = toThree(plane.point);
  const normal = toThree(plane.normal).normalize();
  const denom = direction.dot(normal);

  if (Math.abs(denom) < 0.000001) {
    return null;
  }

  const t = point.clone().sub(origin).dot(normal) / denom;
  if (t < 0) {
    return null;
  }

  const hitPoint = origin.clone().add(direction.clone().multiplyScalar(t));
  const local = hitPoint.clone().sub(point);
  const u = local.dot(toThree(plane.right).normalize());
  const v = local.dot(toThree(plane.up).normalize());

  if (Math.abs(u) > plane.width * 0.5 || Math.abs(v) > plane.height * 0.5) {
    return null;
  }

  return { point: hitPoint, t };
}

function refract(incidentValue: THREE.Vector3, normalValue: THREE.Vector3, fromIor: number, toIor: number) {
  const incident = incidentValue.clone().normalize();
  const normal = normalValue.clone().normalize();
  let cosI = -normal.dot(incident);

  if (cosI < 0) {
    normal.negate();
    cosI = -normal.dot(incident);
  }

  const eta = fromIor / toIor;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k < 0) {
    return null;
  }

  return incident
    .multiplyScalar(eta)
    .add(normal.multiplyScalar(eta * cosI - Math.sqrt(k)))
    .normalize();
}

function toThree(value: Vector3) {
  return new THREE.Vector3(value.x, value.y, value.z);
}
