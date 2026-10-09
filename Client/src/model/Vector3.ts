export type Vector3Json = [number, number, number];

export class Vector3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  static fromJson(value: Vector3Json): Vector3 {
    return new Vector3(value[0], value[1], value[2]);
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  toJson(): Vector3Json {
    return [this.x, this.y, this.z];
  }
}
