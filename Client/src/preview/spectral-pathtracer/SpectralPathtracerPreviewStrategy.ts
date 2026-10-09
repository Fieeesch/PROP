import * as THREE from 'three';

import { httpRenderBackendCommunication } from '../../backend/http/HttpRenderBackendCommunication';
import type { RendererCapabilities } from '../../model/RendererCapabilities';
import type { SceneConfig } from '../../model/SceneConfig';
import { isVector3, vectorComponents } from '../../model/RendererValidation';
import type { PreviewInstance, RendererStrategy } from '../RendererStrategy';

type JsonRecord = Record<string, unknown>;

export const spectralPathtracerRendererStrategy: RendererStrategy = {
  id: 'spectral-pathtracer',
  backendCommunication: httpRenderBackendCommunication,

  create(scene, capabilities) {
    return new SpectralPathtracerPreviewInstance(scene, capabilities);
  },
};

class SpectralPathtracerPreviewInstance implements PreviewInstance {
  readonly object3d = new THREE.Group();

  constructor(scene: SceneConfig, capabilities: RendererCapabilities) {
    this.update(scene, capabilities);
  }

  update(scene: SceneConfig, _capabilities: RendererCapabilities) {
    disposeObjectTree(this.object3d);
    this.object3d.clear();
    this.object3d.add(buildSpectralPreview(scene));
  }

  dispose() {
    disposeObjectTree(this.object3d);
    this.object3d.clear();
  }
}

function buildSpectralPreview(scene: SceneConfig) {
  const root = new THREE.Group();
  root.add(new THREE.GridHelper(8, 16, 0x475569, 0x263241));
  addPreviewLighting(root);
  const materials = materialMapFor(scene);

  for (const object of scene.objects) {
    const properties = recordOf(object.properties);
    if (!properties) continue;

    if (object.objectType === 'Camera') {
      const camera = makeCameraPreview(properties);
      if (camera) root.add(camera);
    } else if (object.objectType === 'Sphere') {
      const sphere = makeSpherePreview(properties, materials);
      if (sphere) root.add(sphere);
    } else if (object.objectType === 'Rectangle') {
      const rectangle = makeRectanglePreview(properties, materials);
      if (rectangle) root.add(rectangle);
    } else if (object.objectType === 'TriangularPrism') {
      const prism = makeTriangularPrismPreview(properties, materials);
      if (prism) root.add(prism);
    } else if (object.objectType === 'Box') {
      const box = makeBoxPreview(properties, materials);
      if (box) root.add(box);
    } else if (object.objectType === 'ObjMesh') {
      const objMesh = makeObjMeshPreview(properties, materials);
      if (objMesh) root.add(objMesh);
    }
  }

  return root;
}

function makeCameraPreview(properties: JsonRecord) {
  const lookFrom = vectorOf(properties.lookFrom);
  const lookAt = vectorOf(properties.lookAt);
  if (!lookFrom || !lookAt) return null;

  const group = new THREE.Group();
  const origin = toThree(lookFrom);
  const target = toThree(lookAt);
  const direction = target.clone().sub(origin).normalize();
  group.add(new THREE.ArrowHelper(direction, origin, 0.8, 0x38bdf8, 0.14, 0.08));
  group.add(makeLine([origin, target], 0x38bdf8, 0.65));

  const cameraBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.16, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true }),
  );
  cameraBody.position.copy(origin);
  cameraBody.lookAt(target);
  group.add(cameraBody);
  return group;
}

function makeSpherePreview(properties: JsonRecord, materials: Map<string, JsonRecord>) {
  const center = vectorOf(properties.center);
  const radius = numberOf(properties.radius);
  if (!center || radius === null || radius <= 0) return null;

  const material = materialFor(properties.material, materials);
  const mesh = new THREE.Mesh(
    hardEdgeGeometry(new THREE.SphereGeometry(radius, 32, 16)),
    material,
  );
  mesh.position.copy(toThree(center));
  return mesh;
}

function makeRectanglePreview(properties: JsonRecord, materials: Map<string, JsonRecord>) {
  const orientation = typeof properties.orientation === 'string' ? properties.orientation : 'xz';
  const minA = numberOf(properties.minA);
  const maxA = numberOf(properties.maxA);
  const minB = numberOf(properties.minB);
  const maxB = numberOf(properties.maxB);
  const k = numberOf(properties.k);
  if ([minA, maxA, minB, maxB, k].some((value) => value === null)) return null;

  const width = Math.abs((maxA as number) - (minA as number));
  const height = Math.abs((maxB as number) - (minB as number));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    materialFor(properties.material, materials),
  );

  if (orientation === 'xy') {
    mesh.position.set(((minA as number) + (maxA as number)) * 0.5, ((minB as number) + (maxB as number)) * 0.5, k as number);
  } else if (orientation === 'yz') {
    mesh.position.set(k as number, ((minA as number) + (maxA as number)) * 0.5, ((minB as number) + (maxB as number)) * 0.5);
    mesh.rotation.y = Math.PI / 2;
  } else {
    mesh.position.set(((minA as number) + (maxA as number)) * 0.5, k as number, ((minB as number) + (maxB as number)) * 0.5);
    mesh.rotation.x = -Math.PI / 2;
  }
  applyAxisAngleRotation(mesh, properties);
  return mesh;
}

function addPreviewLighting(root: THREE.Group) {
  root.add(new THREE.AmbientLight(0xffffff, 0.18));
  root.add(new THREE.HemisphereLight(0xf8fafc, 0x1f2937, 0.62));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(3.4, 4.8, 2.6);
  root.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xc7d2fe, 0.42);
  fillLight.position.set(-3.2, 2.6, -3.8);
  root.add(fillLight);
}

function makeTriangularPrismPreview(properties: JsonRecord, materials: Map<string, JsonRecord>) {
  const baseCenter = vectorOf(properties.baseCenter);
  const baseSize = numberOf(properties.baseSize);
  const height = numberOf(properties.height);
  if (!baseCenter || baseSize === null || height === null) return null;

  const triangleHeight = baseSize * Math.sqrt(3) * 0.5;
  const r = baseSize / Math.sqrt(3);
  const vertices = [
    0, 0, r,
    baseSize * 0.5, 0, -triangleHeight / 3,
    -baseSize * 0.5, 0, -triangleHeight / 3,
    0, height, r,
    baseSize * 0.5, height, -triangleHeight / 3,
    -baseSize * 0.5, height, -triangleHeight / 3,
  ];
  const indices = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 3,
    1, 4, 3,
    1, 2, 4,
    2, 5, 4,
    2, 0, 5,
    0, 3, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  makeHardEdgeGeometry(geometry);

  const mesh = new THREE.Mesh(
    geometry,
    materialFor(properties.material, materials),
  );
  mesh.position.copy(toThree(baseCenter));
  applyAxisAngleRotation(mesh, properties);
  return mesh;
}

function makeBoxPreview(properties: JsonRecord, materials: Map<string, JsonRecord>) {
  const min = vectorOf(properties.min);
  const max = vectorOf(properties.max);
  if (!min || !max) return null;

  const size = toThree(max).sub(toThree(min));
  const center = toThree(min).add(size.clone().multiplyScalar(0.5));
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)),
    materialFor(properties.material, materials),
  );
  mesh.position.copy(center);
  applyAxisAngleRotation(mesh, properties);
  return mesh;
}

function makeObjMeshPreview(properties: JsonRecord, materials: Map<string, JsonRecord>) {
  const content = objContentOf(properties.objFile) ?? stringOf(properties.objContent);
  const position = vectorOf(properties.position) ?? { x: 0, y: 0, z: 0 };
  const size = numberOf(properties.size) ?? 1;
  const scale = vectorOf(properties.scale) ?? { x: 1, y: 1, z: 1 };
  if (!content) return null;

  const geometry = geometryFromObj(content);
  if (!geometry) return null;

  const mesh = new THREE.Mesh(
    geometry,
    materialFor(properties.material, materials),
  );
  mesh.scale.set(size * scale.x, size * scale.y, size * scale.z);
  mesh.position.copy(toThree(position));
  applyAxisAngleRotation(mesh, properties);
  return mesh;
}

function applyAxisAngleRotation(object: THREE.Object3D, properties: JsonRecord) {
  const axis = vectorOf(properties.rotationAxis);
  const angleDeg = numberOf(properties.rotationAngleDeg);
  if (!axis || angleDeg === null || Math.abs(angleDeg) <= 1e-8) return;

  const axisVector = toThree(axis);
  if (axisVector.lengthSq() <= 1e-8) return;

  object.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      axisVector.normalize(),
      THREE.MathUtils.degToRad(angleDeg),
    ),
  );
}

function materialFor(value: unknown, materials: Map<string, JsonRecord>) {
  const material = resolveMaterial(value, materials);
  const type = typeof material?.type === 'string' ? material.type : 'lambertian';
  const color = colorFrom(material?.albedo);
  const baseColor = color ?? new THREE.Color(0xffffff);

  if (type === 'dielectric') {
    return new THREE.MeshPhysicalMaterial({
      color: colorFrom(material?.absorptionColor) ?? baseColor,
      metalness: 0,
      roughness: 0.08,
      transmission: 0.58,
      thickness: 0.35,
      ior: numberOf(material?.ior) ?? numberOf(material?.dispersionA) ?? 1.5,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  if (type === 'emissive') {
    const emission = colorFrom(material?.emission) ?? baseColor;
    const intensity = Math.max(0.7, Math.min(3.5, maxVectorComponent(material?.emission) || 1.4));
    return new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emission,
      emissiveIntensity: intensity,
      metalness: 0,
      roughness: 0.34,
      side: THREE.DoubleSide,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });
}

function hardEdgeGeometry<T extends THREE.BufferGeometry>(geometry: T) {
  makeHardEdgeGeometry(geometry);
  return geometry;
}

function makeHardEdgeGeometry(geometry: THREE.BufferGeometry) {
  const nonIndexed = geometry.toNonIndexed();
  geometry.copy(nonIndexed);
  nonIndexed.dispose();
  geometry.computeVertexNormals();
}

function materialMapFor(scene: SceneConfig) {
  const materials = new Map<string, JsonRecord>();
  for (const object of scene.objects) {
    if (object.objectType !== 'Material') continue;
    const properties = recordOf(object.properties);
    if (!properties) continue;
    materials.set(object.objectId, properties);
    materials.set(object.objectName, properties);
  }
  return materials;
}

function resolveMaterial(value: unknown, materials: Map<string, JsonRecord>) {
  const material = recordOf(value);
  const referenceId = typeof value === 'string'
    ? value
    : typeof material?.$ref === 'string'
      ? material.$ref
      : typeof material?.objectId === 'string'
        ? material.objectId
        : '';
  return referenceId ? materials.get(referenceId) ?? null : material;
}

function colorFrom(value: unknown) {
  const vector = vectorOf(value);
  if (!vector) return null;
  return new THREE.Color(
    Math.min(1, Math.max(0, vector.x)),
    Math.min(1, Math.max(0, vector.y)),
    Math.min(1, Math.max(0, vector.z)),
  );
}

function maxVectorComponent(value: unknown) {
  const vector = vectorOf(value);
  return vector ? Math.max(vector.x, vector.y, vector.z) : null;
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

function makeLine(points: THREE.Vector3[], color: number, opacity: number) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function vectorOf(value: unknown) {
  if (!isVector3(value)) return null;
  const [x, y, z] = vectorComponents(value);
  return { x, y, z };
}

function toThree(value: { x: number; y: number; z: number }) {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function numberOf(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOf(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function objContentOf(value: unknown) {
  const file = recordOf(value);
  return typeof file?.content === 'string' ? file.content : null;
}

function recordOf(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function geometryFromObj(content: string) {
  const vertices: THREE.Vector3[] = [];
  const positions: number[] = [];
  const indices: number[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'v') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if ([x, y, z].every(Number.isFinite)) vertices.push(new THREE.Vector3(x, y, z));
    } else if (parts[0] === 'f') {
      const face = parts.slice(1)
        .map((token) => objVertexIndex(token, vertices.length))
        .filter((index): index is number => index !== null);
      if (face.length < 3) continue;
      for (let i = 1; i + 1 < face.length; i += 1) {
        indices.push(face[0], face[i], face[i + 1]);
      }
    }
  }

  if (vertices.length === 0 || indices.length === 0) return null;
  for (const vertex of vertices) positions.push(vertex.x, vertex.y, vertex.z);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  makeHardEdgeGeometry(geometry);
  return geometry;
}

function objVertexIndex(token: string, vertexCount: number) {
  const rawIndex = Number(token.split('/')[0]);
  if (!Number.isInteger(rawIndex) || rawIndex === 0) return null;
  const resolved = rawIndex < 0 ? vertexCount + rawIndex : rawIndex - 1;
  return resolved >= 0 && resolved < vertexCount ? resolved : null;
}
