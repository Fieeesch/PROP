import { Vector3, type Vector3Json } from '../../model/Vector3';

export interface AreaLightJson {
  type: 'circle';
  center: Vector3Json;
  direction: Vector3Json;
  right: Vector3Json;
  up: Vector3Json;
  radius: number;
}

export class AreaLight {
  readonly type = 'circle' as const;

  constructor(
    public center = new Vector3(),
    public direction = new Vector3(1, 0, 0),
    public right = new Vector3(0, 0, -1),
    public up = new Vector3(0, 1, 0),
    public radius = 0.01,
  ) {}

  static fromJson(value: AreaLightJson & { normal?: Vector3Json; width?: number; height?: number }): AreaLight {
    const direction = Vector3.fromJson(value.direction ?? value.normal ?? [1, 0, 0]);
    const basis = basisFromDirection(direction);

    return new AreaLight(
      Vector3.fromJson(value.center),
      direction,
      value.right ? Vector3.fromJson(value.right) : basis.right,
      value.up ? Vector3.fromJson(value.up) : basis.up,
      value.radius ?? Math.min(value.width ?? 0.02, value.height ?? 0.02) * 0.5,
    );
  }

  clone(): AreaLight {
    return new AreaLight(
      this.center.clone(),
      this.direction.clone(),
      this.right.clone(),
      this.up.clone(),
      this.radius,
    );
  }

  toJson(): AreaLightJson {
    return {
      type: this.type,
      center: this.center.toJson(),
      direction: this.direction.toJson(),
      right: this.right.toJson(),
      up: this.up.toJson(),
      radius: this.radius,
    };
  }
}

function basisFromDirection(direction: Vector3) {
  const directionLength = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const forward = new Vector3(
    direction.x / directionLength,
    direction.y / directionLength,
    direction.z / directionLength,
  );
  const helper = Math.abs(forward.y) > 0.95 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = normalize(cross(forward, helper));
  const up = normalize(cross(right, forward));
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
