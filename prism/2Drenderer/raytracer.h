#ifndef RENDERER_2D_RAYTRACER_H
#define RENDERER_2D_RAYTRACER_H

#include <vector>

#include "config.h"
#include "geometry.h"
#include "optics.h"
#include "spectrum.h"

void traceRayRecursive(
    Ray ray,
    Plane imgPlane,
    const std::vector<Plane>& prismPlanes,
    SellmeierCoefficients prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::mt19937& rng,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
);

void generateSpectralImage(
    Plane& imgPlane,
    AreaLight& light,
    SpectralPowerDistribution& lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients& prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
);

void generateSpectralImage(
    Plane& imgPlane,
    CircleLight& light,
    SpectralPowerDistribution& lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients& prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
);

void generateSpectralImage(
    Plane imgPlane,
    SpotLight light,
    SpectralPowerDistribution lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
);

#endif
