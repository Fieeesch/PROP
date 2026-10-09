#ifndef RENDERER_2D_RAYTRACER_CUDA_H
#define RENDERER_2D_RAYTRACER_CUDA_H

#include <string>
#include <vector>

#include "config.h"
#include "geometry.h"
#include "optics.h"
#include "spectrum.h"

bool generateSpectralImageCuda(
    const Plane& imgPlane,
    const AreaLight& light,
    const SpectralPowerDistribution& lightSPD,
    const std::vector<Plane>& prismPlanes,
    const SellmeierCoefficients& prismSellmeierCoeffs,
    const std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config,
    std::string* fallbackReason = nullptr
);

bool generateSpectralImageCuda(
    const Plane& imgPlane,
    const CircleLight& light,
    const SpectralPowerDistribution& lightSPD,
    const std::vector<Plane>& prismPlanes,
    const SellmeierCoefficients& prismSellmeierCoeffs,
    const std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config,
    std::string* fallbackReason = nullptr
);

#endif
