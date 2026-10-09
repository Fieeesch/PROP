const MT_STATE_SIZE = 624;
const MT_PERIOD_OFFSET = 397;
const FLOAT_UNIT = 1 / 0x1000000;

/**
 * Erzeugt das zum Standalone-Renderer passende korrelierte Reflexionsfeld der Wand.
 */
export function createCppDiffuseReflectanceField(
  width: number,
  height: number,
  pixelSizeXmm: number,
  pixelSizeYmm: number,
  correlationLengthMm: number,
  seed: number,
) {
  const realPart = makeCorrelatedNormalField(
    width,
    height,
    pixelSizeXmm,
    pixelSizeYmm,
    correlationLengthMm,
    seed,
  );
  const imaginaryPart = makeCorrelatedNormalField(
    width,
    height,
    pixelSizeXmm,
    pixelSizeYmm,
    correlationLengthMm,
    (seed + 1) >>> 0,
  );
  const reflectance = new Float32Array(width * height * 2);
  let meanPower = 0;

  for (let index = 0; index < width * height; index += 1) {
    const real = realPart[index];
    const imaginary = imaginaryPart[index];
    meanPower += Math.fround(
      Math.fround(real * real) + Math.fround(imaginary * imaginary),
    );
  }

  const scale = Math.fround(
    meanPower > 0 ? 1 / Math.sqrt(meanPower / (width * height)) : 0,
  );
  for (let index = 0; index < width * height; index += 1) {
    reflectance[index * 2] = Math.fround(realPart[index] * scale);
    reflectance[index * 2 + 1] = Math.fround(imaginaryPart[index] * scale);
  }

  return reflectance;
}

function makeCorrelatedNormalField(
  width: number,
  height: number,
  pixelSizeXmm: number,
  pixelSizeYmm: number,
  correlationLengthMm: number,
  seed: number,
) {
  const safePixelSizeXmm = Math.fround(Math.max(pixelSizeXmm, 1e-6));
  const safePixelSizeYmm = Math.fround(Math.max(pixelSizeYmm, 1e-6));
  const safeCorrelationLengthMm = Math.fround(
    Math.max(correlationLengthMm, safePixelSizeXmm, safePixelSizeYmm),
  );
  const widthMm = Math.fround(Math.max(width - 1, 0) * safePixelSizeXmm);
  const heightMm = Math.fround(Math.max(height - 1, 0) * safePixelSizeYmm);
  const lowWidth = Math.max(
    2,
    Math.ceil(Math.fround(widthMm / safeCorrelationLengthMm)) + 1,
  );
  const lowHeight = Math.max(
    2,
    Math.ceil(Math.fround(heightMm / safeCorrelationLengthMm)) + 1,
  );

  const normalDistribution = new MsvcNormalDistribution(seed);
  const low = new Float32Array(lowWidth * lowHeight);
  for (let index = 0; index < low.length; index += 1) {
    low[index] = normalDistribution.next();
  }

  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const yMm = Math.fround(y * safePixelSizeYmm);
    const gy = Math.fround(yMm / safeCorrelationLengthMm);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, lowHeight - 1);
    const ty = Math.fround(gy - y0);

    for (let x = 0; x < width; x += 1) {
      const xMm = Math.fround(x * safePixelSizeXmm);
      const gx = Math.fround(xMm / safeCorrelationLengthMm);
      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, lowWidth - 1);
      const tx = Math.fround(gx - x0);
      const a = low[y0 * lowWidth + x0];
      const b = low[y0 * lowWidth + x1];
      const c = low[y1 * lowWidth + x0];
      const d = low[y1 * lowWidth + x1];
      const ab = lerpFloat(a, b, tx);
      const cd = lerpFloat(c, d, tx);

      values[y * width + x] = lerpFloat(ab, cd, ty);
    }
  }

  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;

  let variance = 0;
  for (const value of values) {
    const delta = value - mean;
    variance += delta * delta;
  }
  variance /= values.length;

  const rms = Math.fround(Math.sqrt(variance));
  const scale = Math.fround(rms > 0 ? 1 / rms : 0);
  const floatMean = Math.fround(mean);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.fround(
      Math.fround(values[index] - floatMean) * scale,
    );
  }

  return values;
}

function lerpFloat(a: number, b: number, amount: number) {
  return Math.fround(
    Math.fround(a * Math.fround(1 - amount)) + Math.fround(b * amount),
  );
}

class MsvcNormalDistribution {
  private readonly generator: Mt19937;
  private spare: number | null = null;

  constructor(seed: number) {
    this.generator = new Mt19937(seed);
  }

  next() {
    if (this.spare !== null) {
      const result = this.spare;
      this.spare = null;
      return result;
    }

    let first = 0;
    let second = 0;
    let radiusSquared = 0;
    do {
      first = Math.fround(Math.fround(2 * this.uniformFloat()) - 1);
      second = Math.fround(Math.fround(2 * this.uniformFloat()) - 1);
      radiusSquared = Math.fround(
        Math.fround(first * first) + Math.fround(second * second),
      );
    } while (
      radiusSquared >= 1
      || first === 0
      || second === 0
    );

    const logRadiusSquared = Math.fround(Math.log(radiusSquared));
    const factor = Math.fround(Math.sqrt(Math.fround(
      Math.fround(-2 * logRadiusSquared) / radiusSquared,
    )));
    this.spare = Math.fround(second * factor);
    return Math.fround(first * factor);
  }

  private uniformFloat() {
    return Math.fround((this.generator.nextUint32() >>> 8) * FLOAT_UNIT);
  }
}

class Mt19937 {
  private readonly state = new Uint32Array(MT_STATE_SIZE);
  private index = MT_STATE_SIZE;

  constructor(seed: number) {
    this.state[0] = seed >>> 0;
    for (let index = 1; index < MT_STATE_SIZE; index += 1) {
      const previous = this.state[index - 1];
      this.state[index] = (
        Math.imul(1812433253, previous ^ (previous >>> 30)) + index
      ) >>> 0;
    }
  }

  nextUint32() {
    if (this.index >= MT_STATE_SIZE) this.twist();

    let value = this.state[this.index];
    this.index += 1;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  private twist() {
    for (let index = 0; index < MT_STATE_SIZE; index += 1) {
      const combined = (this.state[index] & 0x80000000)
        | (this.state[(index + 1) % MT_STATE_SIZE] & 0x7fffffff);
      this.state[index] = this.state[(index + MT_PERIOD_OFFSET) % MT_STATE_SIZE]
        ^ (combined >>> 1)
        ^ ((combined & 1) === 0 ? 0 : 0x9908b0df);
    }
    this.index = 0;
  }
}
