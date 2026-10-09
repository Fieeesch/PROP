#include "raytracer_cuda.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include <cuda_runtime.h>

namespace {

constexpr float IOR_AIR = 1.0f;
constexpr float PI = 3.14159265358979323846f;
constexpr int BLOCK_SIZE = 256;

struct Vec3D {
    float x;
    float y;
    float z;
};

struct PlaneD {
    Vec3D point;
    Vec3D normal;
    Vec3D right;
    Vec3D up;
    float width;
    float height;
};

struct AreaLightD {
    Vec3D center;
    Vec3D direction;
    Vec3D right;
    Vec3D up;
    float width;
    float height;
};

struct CircleLightD {
    Vec3D center;
    Vec3D direction;
    Vec3D right;
    Vec3D up;
    float radius;
};

struct RayD {
    Vec3D origin;
    Vec3D direction;
    float wavelength;
    int wavelengthBin;
    float intensity;
};

struct SellmeierD {
    float b1;
    float b2;
    float b3;
    float c1;
    float c2;
    float c3;
};

struct AbsorptionSampleD {
    float wavelengthNm;
    float sigmaA_cm_inv;
};

struct RenderConfigD {
    int recursionDepth;
    float lambdaMin;
    float lambdaMax;
    int spectrumBins;
    float lightPower;
    int lightSamples;
    int imageWidth;
    int imageHeight;
    bool rngSeedEnabled;
    std::uint32_t rngSeed;
};

struct RefractionTermsD {
    Vec3D I;
    Vec3D N;
    float eta;
    float cosI;
    float sinT2;
    float cosT;
};

Vec3D toDeviceVec(const glm::vec3& v) {
    return {v.x, v.y, v.z};
}

PlaneD toDevicePlane(const Plane& plane) {
    return {
        toDeviceVec(plane.point),
        toDeviceVec(plane.normal),
        toDeviceVec(plane.right),
        toDeviceVec(plane.up),
        plane.width,
        plane.height,
    };
}

RenderConfigD toDeviceConfig(const RenderConfig& config) {
    return {
        config.recursionDepth,
        config.lambdaMin,
        config.lambdaMax,
        config.spectrumBins,
        config.lightPower,
        config.lightSamples,
        config.imageWidth,
        config.imageHeight,
        config.rngSeedEnabled,
        config.rngSeed,
    };
}

__device__ Vec3D add(Vec3D a, Vec3D b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}

__device__ Vec3D sub(Vec3D a, Vec3D b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}

__device__ Vec3D mul(Vec3D v, float s) {
    return {v.x * s, v.y * s, v.z * s};
}

__device__ float dot(Vec3D a, Vec3D b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

__device__ float length(Vec3D v) {
    return sqrtf(dot(v, v));
}

__device__ Vec3D normalize(Vec3D v) {
    const float len = length(v);
    return len > 0.0f ? mul(v, 1.0f / len) : Vec3D{0.0f, 0.0f, 0.0f};
}

__device__ float clamp01(float value) {
    return fminf(fmaxf(value, 0.0f), 1.0f);
}

__device__ float random01(std::uint32_t& state) {
    state = state * 1664525u + 1013904223u;
    return static_cast<float>((state >> 8) & 0x00ffffffu) * (1.0f / 16777216.0f);
}

__device__ std::uint32_t initRandomState(int sampleIndex, const RenderConfigD& config) {
    std::uint32_t seed = config.rngSeedEnabled ? config.rngSeed : 0x9e3779b9u;
    std::uint32_t state = seed ^ (static_cast<std::uint32_t>(sampleIndex) * 747796405u + 2891336453u);
    state ^= state >> 16;
    state *= 2246822519u;
    state ^= state >> 13;
    state *= 3266489917u;
    state ^= state >> 16;
    return state;
}

__device__ int sampleWavelengthBin(const float* cdf, int binCount, std::uint32_t& rng) {
    const float r = random01(rng);
    int lo = 0;
    int hi = binCount - 1;
    while (lo < hi) {
        const int mid = (lo + hi) / 2;
        if (cdf[mid] >= r) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}

__device__ float binToWavelengthDevice(int bin, const RenderConfigD& config) {
    const float t = static_cast<float>(bin) / static_cast<float>(config.spectrumBins - 1);
    return config.lambdaMin + t * (config.lambdaMax - config.lambdaMin);
}

__device__ bool intersectPlaneDevice(const RayD& ray, const PlaneD& plane, float& t, Vec3D& hitPoint) {
    const float denom = dot(ray.direction, plane.normal);
    if (fabsf(denom) < 1e-6f) {
        return false;
    }

    t = dot(sub(plane.point, ray.origin), plane.normal) / denom;
    if (t < 0.0f) {
        return false;
    }

    hitPoint = add(ray.origin, mul(ray.direction, t));
    return true;
}

__device__ bool isPointOnPlaneRectDevice(Vec3D point, const PlaneD& plane) {
    const Vec3D local = sub(point, plane.point);
    const float u = dot(local, plane.right);
    const float v = dot(local, plane.up);
    return u >= -plane.width * 0.5f && u <= plane.width * 0.5f
        && v >= -plane.height * 0.5f && v <= plane.height * 0.5f;
}

__device__ float iorSellmeierDevice(float lambda, SellmeierD coeffs) {
    const float l2 = lambda * lambda;
    const float n2 = 1.0f
        + coeffs.b1 * l2 / (l2 - coeffs.c1)
        + coeffs.b2 * l2 / (l2 - coeffs.c2)
        + coeffs.b3 * l2 / (l2 - coeffs.c3);
    return sqrtf(n2);
}

__device__ bool computeRefractionTermsDevice(Vec3D incident, Vec3D normal, float n1, float n2, RefractionTermsD& terms) {
    terms.I = normalize(incident);
    terms.N = normalize(normal);
    terms.eta = n1 / n2;
    terms.cosI = fminf(fmaxf(-dot(terms.N, terms.I), -1.0f), 1.0f);
    if (terms.cosI < 0.0f) {
        terms.N = mul(terms.N, -1.0f);
        terms.cosI = -terms.cosI;
    }

    terms.sinT2 = terms.eta * terms.eta * (1.0f - terms.cosI * terms.cosI);
    if (terms.sinT2 > 1.0f) {
        return false;
    }

    terms.cosT = sqrtf(fmaxf(0.0f, 1.0f - terms.sinT2));
    return true;
}

__device__ Vec3D refractDirectionDevice(const RefractionTermsD& terms) {
    return normalize(add(mul(terms.I, terms.eta), mul(terms.N, terms.eta * terms.cosI - terms.cosT)));
}

__device__ Vec3D reflectDirectionDevice(Vec3D incident, Vec3D normal) {
    const Vec3D I = normalize(incident);
    const Vec3D N = normalize(normal);
    return normalize(sub(I, mul(N, 2.0f * dot(I, N))));
}

__device__ float computeFresnelTransmittanceDevice(float cosI, float cosT, float n1, float n2) {
    const float rsNumerator = n1 * cosI - n2 * cosT;
    const float rsDenominator = n1 * cosI + n2 * cosT;
    const float Rs = (rsNumerator / rsDenominator) * (rsNumerator / rsDenominator);

    const float rpNumerator = n1 * cosT - n2 * cosI;
    const float rpDenominator = n1 * cosT + n2 * cosI;
    const float Rp = (rpNumerator / rpDenominator) * (rpNumerator / rpDenominator);

    return clamp01(1.0f - 0.5f * (Rs + Rp));
}

__device__ float interpolateSigmaADevice(const AbsorptionSampleD* samples, int sampleCount, float wavelengthNm) {
    if (sampleCount <= 0) {
        return 0.0f;
    }

    if (wavelengthNm <= samples[0].wavelengthNm) {
        return samples[0].sigmaA_cm_inv;
    }

    if (wavelengthNm >= samples[sampleCount - 1].wavelengthNm) {
        return samples[sampleCount - 1].sigmaA_cm_inv;
    }

    for (int i = 0; i + 1 < sampleCount; ++i) {
        const AbsorptionSampleD a = samples[i];
        const AbsorptionSampleD b = samples[i + 1];
        if (wavelengthNm >= a.wavelengthNm && wavelengthNm <= b.wavelengthNm) {
            const float t = (wavelengthNm - a.wavelengthNm) / (b.wavelengthNm - a.wavelengthNm);
            return a.sigmaA_cm_inv + t * (b.sigmaA_cm_inv - a.sigmaA_cm_inv);
        }
    }

    return samples[sampleCount - 1].sigmaA_cm_inv;
}

__device__ float computeBeerLambertTransmittanceDevice(
    Vec3D entryPoint,
    Vec3D exitPoint,
    float wavelength,
    const AbsorptionSampleD* samples,
    int sampleCount
) {
    const float wavelengthNm = wavelength * 1000.0f;
    const float sigmaA = interpolateSigmaADevice(samples, sampleCount, wavelengthNm);
    return expf(-sigmaA * length(sub(exitPoint, entryPoint)));
}

__device__ void traceRayDevice(
    RayD ray,
    PlaneD imgPlane,
    const PlaneD* prismPlanes,
    int prismPlaneCount,
    SellmeierD sellmeier,
    const AbsorptionSampleD* absorption,
    int absorptionCount,
    float* spectralImage,
    const RenderConfigD& config,
    std::uint32_t& rng
) {
    constexpr float EPSILON = 0.001f;
    Vec3D prevHit{};
    bool insidePrism = false;
    const float iorGlass = iorSellmeierDevice(ray.wavelength, sellmeier);

    for (int depth = 0; depth < config.recursionDepth; ++depth) {
        bool foundHit = false;
        float closestT = 3.402823466e+38f;
        Vec3D closestHit{};
        PlaneD closestPlane{};
        bool hitImagePlane = false;

        float t = 0.0f;
        Vec3D hitPoint{};
        if (intersectPlaneDevice(ray, imgPlane, t, hitPoint)
            && t > EPSILON
            && isPointOnPlaneRectDevice(hitPoint, imgPlane)
            && t < closestT) {
            foundHit = true;
            closestT = t;
            closestHit = hitPoint;
            closestPlane = imgPlane;
            hitImagePlane = true;
        }

        for (int i = 0; i < prismPlaneCount; ++i) {
            const PlaneD prismPlane = prismPlanes[i];
            if (!intersectPlaneDevice(ray, prismPlane, t, hitPoint)
                || t <= EPSILON
                || !isPointOnPlaneRectDevice(hitPoint, prismPlane)) {
                continue;
            }

            if (t < closestT) {
                foundHit = true;
                closestT = t;
                closestHit = hitPoint;
                closestPlane = prismPlane;
                hitImagePlane = false;
            }
        }

        if (!foundHit) {
            return;
        }

        if (hitImagePlane) {
            const Vec3D local = sub(closestHit, imgPlane.point);
            const float u = dot(local, imgPlane.right);
            const float v = dot(local, imgPlane.up);
            const int x = static_cast<int>((u / imgPlane.width + 0.5f) * config.imageWidth);
            const int y = static_cast<int>((0.5f - v / imgPlane.height) * config.imageHeight);
            if (x < 0 || x >= config.imageWidth || y < 0 || y >= config.imageHeight) {
                return;
            }

            const int offset = (y * config.imageWidth + x) * config.spectrumBins + ray.wavelengthBin;
            atomicAdd(&spectralImage[offset], ray.intensity);
            return;
        }

        const float n1 = insidePrism ? iorGlass : IOR_AIR;
        const float n2 = insidePrism ? IOR_AIR : iorGlass;

        if (insidePrism && depth > 0) {
            const float materialTransmission = computeBeerLambertTransmittanceDevice(
                prevHit,
                closestHit,
                ray.wavelength,
                absorption,
                absorptionCount
            );
            if (random01(rng) >= materialTransmission) {
                return;
            }
        }

        bool reflection = false;
        RefractionTermsD refractionTerms{};
        if (!computeRefractionTermsDevice(ray.direction, closestPlane.normal, n1, n2, refractionTerms)) {
            reflection = true;
        }

        if (!reflection) {
            const float transmittance = computeFresnelTransmittanceDevice(
                refractionTerms.cosI,
                refractionTerms.cosT,
                n1,
                n2
            );
            if (random01(rng) >= transmittance) {
                reflection = true;
            }
        }

        const Vec3D newDirection = reflection
            ? reflectDirectionDevice(ray.direction, closestPlane.normal)
            : refractDirectionDevice(refractionTerms);

        ray.origin = add(closestHit, mul(newDirection, EPSILON));
        ray.direction = normalize(newDirection);
        prevHit = closestHit;
        if (!reflection) {
            insidePrism = !insidePrism;
        }
    }
}

__global__ void traceAreaLightKernel(
    PlaneD imgPlane,
    AreaLightD light,
    const float* cdf,
    const PlaneD* prismPlanes,
    int prismPlaneCount,
    SellmeierD sellmeier,
    const AbsorptionSampleD* absorption,
    int absorptionCount,
    float* spectralImage,
    RenderConfigD config
) {
    const int sampleIndex = static_cast<int>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (sampleIndex >= config.lightSamples) {
        return;
    }

    std::uint32_t rng = initRandomState(sampleIndex, config);
    const float su = random01(rng) - 0.5f;
    const float sv = random01(rng) - 0.5f;
    const Vec3D rayOrigin = add(add(light.center, mul(light.right, su * light.width)), mul(light.up, sv * light.height));
    const int wavelengthBin = sampleWavelengthBin(cdf, config.spectrumBins, rng);
    RayD ray{
        rayOrigin,
        light.direction,
        binToWavelengthDevice(wavelengthBin, config),
        wavelengthBin,
        config.lightPower / static_cast<float>(config.lightSamples),
    };

    traceRayDevice(ray, imgPlane, prismPlanes, prismPlaneCount, sellmeier, absorption, absorptionCount, spectralImage, config, rng);
}

__global__ void traceCircleLightKernel(
    PlaneD imgPlane,
    CircleLightD light,
    const float* cdf,
    const PlaneD* prismPlanes,
    int prismPlaneCount,
    SellmeierD sellmeier,
    const AbsorptionSampleD* absorption,
    int absorptionCount,
    float* spectralImage,
    RenderConfigD config
) {
    const int sampleIndex = static_cast<int>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (sampleIndex >= config.lightSamples) {
        return;
    }

    std::uint32_t rng = initRandomState(sampleIndex, config);
    const float radiusLocal = sqrtf(random01(rng)) * light.radius;
    const float angle = 2.0f * PI * random01(rng);
    const float su = radiusLocal * cosf(angle);
    const float sv = radiusLocal * sinf(angle);
    const Vec3D rayOrigin = add(add(light.center, mul(light.right, su)), mul(light.up, sv));
    const int wavelengthBin = sampleWavelengthBin(cdf, config.spectrumBins, rng);
    RayD ray{
        rayOrigin,
        light.direction,
        binToWavelengthDevice(wavelengthBin, config),
        wavelengthBin,
        config.lightPower / static_cast<float>(config.lightSamples),
    };

    traceRayDevice(ray, imgPlane, prismPlanes, prismPlaneCount, sellmeier, absorption, absorptionCount, spectralImage, config, rng);
}

void checkCuda(cudaError_t result, const char* operation) {
    if (result != cudaSuccess) {
        throw std::runtime_error(std::string(operation) + ": " + cudaGetErrorString(result));
    }
}

bool hasCudaDevice(std::string* fallbackReason) {
    int deviceCount = 0;
    const cudaError_t result = cudaGetDeviceCount(&deviceCount);
    if (result != cudaSuccess || deviceCount < 1) {
        if (fallbackReason) {
            *fallbackReason = result == cudaSuccess
                ? "no CUDA device found"
                : std::string("CUDA device query failed: ") + cudaGetErrorString(result);
        }
        return false;
    }
    return true;
}

void copyCudaResultToSpectra(
    const std::vector<float>& flatSpectralImage,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
) {
    const int pixelCount = config.imageWidth * config.imageHeight;
    for (int pixel = 0; pixel < pixelCount; ++pixel) {
        std::copy_n(
            flatSpectralImage.begin() + static_cast<std::ptrdiff_t>(pixel) * config.spectrumBins,
            config.spectrumBins,
            spectralImage[pixel].bins.begin()
        );
    }
}

template <typename KernelLaunch>
bool generateSpectralImageCudaImpl(
    const Plane& imgPlane,
    const SpectralPowerDistribution& lightSPD,
    const std::vector<Plane>& prismPlanes,
    const SellmeierCoefficients& prismSellmeierCoeffs,
    const std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config,
    std::string* fallbackReason,
    KernelLaunch launchKernel
) {
    if (!hasCudaDevice(fallbackReason)) {
        return false;
    }

    if (static_cast<int>(lightSPD.cdf.size()) != config.spectrumBins) {
        throw std::runtime_error("SPD CDF size does not match spectrum bin count");
    }

    const int pixelCount = config.imageWidth * config.imageHeight;
    const std::size_t spectralValueCount = static_cast<std::size_t>(pixelCount) * config.spectrumBins;
    std::vector<float> flatSpectralImage(spectralValueCount, 0.0f);

    std::vector<PlaneD> hostPrismPlanes;
    hostPrismPlanes.reserve(prismPlanes.size());
    for (const Plane& plane : prismPlanes) {
        hostPrismPlanes.push_back(toDevicePlane(plane));
    }

    std::vector<AbsorptionSampleD> hostAbsorption;
    hostAbsorption.reserve(prismAbsorptionCoeffs.size());
    for (const AbsorptionSample& sample : prismAbsorptionCoeffs) {
        hostAbsorption.push_back({sample.wavelengthNm, sample.sigmaA_cm_inv});
    }

    float* deviceSpectralImage = nullptr;
    float* deviceCdf = nullptr;
    PlaneD* devicePrismPlanes = nullptr;
    AbsorptionSampleD* deviceAbsorption = nullptr;

    try {
        checkCuda(cudaMalloc(&deviceSpectralImage, spectralValueCount * sizeof(float)), "cudaMalloc spectral image");
        checkCuda(cudaMemset(deviceSpectralImage, 0, spectralValueCount * sizeof(float)), "cudaMemset spectral image");
        checkCuda(cudaMalloc(&deviceCdf, lightSPD.cdf.size() * sizeof(float)), "cudaMalloc SPD CDF");
        checkCuda(cudaMemcpy(deviceCdf, lightSPD.cdf.data(), lightSPD.cdf.size() * sizeof(float), cudaMemcpyHostToDevice), "cudaMemcpy SPD CDF");
        checkCuda(cudaMalloc(&devicePrismPlanes, hostPrismPlanes.size() * sizeof(PlaneD)), "cudaMalloc prism planes");
        checkCuda(cudaMemcpy(devicePrismPlanes, hostPrismPlanes.data(), hostPrismPlanes.size() * sizeof(PlaneD), cudaMemcpyHostToDevice), "cudaMemcpy prism planes");
        checkCuda(cudaMalloc(&deviceAbsorption, std::max<std::size_t>(hostAbsorption.size(), 1) * sizeof(AbsorptionSampleD)), "cudaMalloc absorption");
        if (!hostAbsorption.empty()) {
            checkCuda(cudaMemcpy(deviceAbsorption, hostAbsorption.data(), hostAbsorption.size() * sizeof(AbsorptionSampleD), cudaMemcpyHostToDevice), "cudaMemcpy absorption");
        }

        const dim3 block(BLOCK_SIZE);
        const dim3 grid((config.lightSamples + BLOCK_SIZE - 1) / BLOCK_SIZE);
        launchKernel(
            grid,
            block,
            toDevicePlane(imgPlane),
            deviceCdf,
            devicePrismPlanes,
            static_cast<int>(hostPrismPlanes.size()),
            SellmeierD{
                prismSellmeierCoeffs.b1,
                prismSellmeierCoeffs.b2,
                prismSellmeierCoeffs.b3,
                prismSellmeierCoeffs.c1,
                prismSellmeierCoeffs.c2,
                prismSellmeierCoeffs.c3,
            },
            deviceAbsorption,
            static_cast<int>(hostAbsorption.size()),
            deviceSpectralImage,
            toDeviceConfig(config)
        );
        checkCuda(cudaGetLastError(), "launch CUDA renderer");
        checkCuda(cudaDeviceSynchronize(), "synchronize CUDA renderer");
        checkCuda(cudaMemcpy(flatSpectralImage.data(), deviceSpectralImage, spectralValueCount * sizeof(float), cudaMemcpyDeviceToHost), "cudaMemcpy spectral image");
        copyCudaResultToSpectra(flatSpectralImage, spectralImage, config);
    } catch (...) {
        cudaFree(deviceSpectralImage);
        cudaFree(deviceCdf);
        cudaFree(devicePrismPlanes);
        cudaFree(deviceAbsorption);
        throw;
    }

    cudaFree(deviceSpectralImage);
    cudaFree(deviceCdf);
    cudaFree(devicePrismPlanes);
    cudaFree(deviceAbsorption);
    return true;
}

} // namespace

bool generateSpectralImageCuda(
    const Plane& imgPlane,
    const AreaLight& light,
    const SpectralPowerDistribution& lightSPD,
    const std::vector<Plane>& prismPlanes,
    const SellmeierCoefficients& prismSellmeierCoeffs,
    const std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config,
    std::string* fallbackReason
) {
    const AreaLightD deviceLight{
        toDeviceVec(light.center),
        toDeviceVec(light.direction),
        toDeviceVec(light.right),
        toDeviceVec(light.up),
        light.width,
        light.height,
    };

    return generateSpectralImageCudaImpl(
        imgPlane,
        lightSPD,
        prismPlanes,
        prismSellmeierCoeffs,
        prismAbsorptionCoeffs,
        spectralImage,
        config,
        fallbackReason,
        [deviceLight](
            dim3 grid,
            dim3 block,
            PlaneD deviceImgPlane,
            const float* deviceCdf,
            const PlaneD* devicePrismPlanes,
            int prismPlaneCount,
            SellmeierD deviceSellmeier,
            const AbsorptionSampleD* deviceAbsorption,
            int absorptionCount,
            float* deviceSpectralImage,
            RenderConfigD deviceConfig
        ) {
            traceAreaLightKernel<<<grid, block>>>(
                deviceImgPlane,
                deviceLight,
                deviceCdf,
                devicePrismPlanes,
                prismPlaneCount,
                deviceSellmeier,
                deviceAbsorption,
                absorptionCount,
                deviceSpectralImage,
                deviceConfig
            );
        }
    );
}

bool generateSpectralImageCuda(
    const Plane& imgPlane,
    const CircleLight& light,
    const SpectralPowerDistribution& lightSPD,
    const std::vector<Plane>& prismPlanes,
    const SellmeierCoefficients& prismSellmeierCoeffs,
    const std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config,
    std::string* fallbackReason
) {
    const CircleLightD deviceLight{
        toDeviceVec(light.center),
        toDeviceVec(light.direction),
        toDeviceVec(light.right),
        toDeviceVec(light.up),
        light.radius,
    };

    return generateSpectralImageCudaImpl(
        imgPlane,
        lightSPD,
        prismPlanes,
        prismSellmeierCoeffs,
        prismAbsorptionCoeffs,
        spectralImage,
        config,
        fallbackReason,
        [deviceLight](
            dim3 grid,
            dim3 block,
            PlaneD deviceImgPlane,
            const float* deviceCdf,
            const PlaneD* devicePrismPlanes,
            int prismPlaneCount,
            SellmeierD deviceSellmeier,
            const AbsorptionSampleD* deviceAbsorption,
            int absorptionCount,
            float* deviceSpectralImage,
            RenderConfigD deviceConfig
        ) {
            traceCircleLightKernel<<<grid, block>>>(
                deviceImgPlane,
                deviceLight,
                deviceCdf,
                devicePrismPlanes,
                prismPlaneCount,
                deviceSellmeier,
                deviceAbsorption,
                absorptionCount,
                deviceSpectralImage,
                deviceConfig
            );
        }
    );
}
