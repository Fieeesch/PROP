import { Vector3, type Vector3Json } from '../../model/Vector3';

export interface RectPlaneJson {
  point: Vector3Json;
  normal: Vector3Json;
  right: Vector3Json;
  up: Vector3Json;
  width: number;
  height: number;
}

export class RectPlane {
  constructor(
    public point = new Vector3(),
    public normal = new Vector3(0, 1, 0),
    public right = new Vector3(1, 0, 0),
    public up = new Vector3(0, 0, 1),
    public width = 1,
    public height = 1,
  ) {}

  static fromJson(value: RectPlaneJson & { center?: Vector3Json }): RectPlane {
    const point = value.point ?? value.center;
    const normal = Vector3.fromJson(value.normal);
    const basis = basisFromNormal(normal);

    return new RectPlane(
      Vector3.fromJson(point),
      normal,
      value.right ? Vector3.fromJson(value.right) : basis.right,
      value.up ? Vector3.fromJson(value.up) : basis.up,
      value.width,
      value.height,
    );
  }

  clone(): RectPlane {
    return new RectPlane(
      this.point.clone(),
      this.normal.clone(),
      this.right.clone(),
      this.up.clone(),
      this.width,
      this.height,
    );
  }

  toJson(): RectPlaneJson {
    return {
      point: this.point.toJson(),
      normal: this.normal.toJson(),
      right: this.right.toJson(),
      up: this.up.toJson(),
      width: this.width,
      height: this.height,
    };
  }
}

function basisFromNormal(normal: Vector3) {
  const normalLength = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const nx = normal.x / normalLength;
  const ny = normal.y / normalLength;
  const nz = normal.z / normalLength;
  const helper = Math.abs(ny) > 0.95 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = normalize(cross(helper, new Vector3(nx, ny, nz)));
  const up = normalize(cross(new Vector3(nx, ny, nz), right));
  return { right, up };
}

function cross(a: Vector3, b: Vector3) {
  return new Vector3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function normalize(value: Vector3) {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return new Vector3(value.x / length, value.y / length, value.z / length);
}
