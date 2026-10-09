#ifndef RENDERER_2D_SPECTRUM_H
#define RENDERER_2D_SPECTRUM_H

#include <random>
#include <string>
#include <vector>

#include "config.h"

struct Spectrum {
    explicit Spectrum(int binCount = 0) : bins(binCount, 0.0f) {}
    std::vector<float> bins;
};

struct SpectralPowerDistribution {
    std::vector<float> power;
    std::vector<float> cdf;

    void buildCDF();
    int sampleWavelengthBin(std::mt19937& rng) const;
};

int wavelengthToBin(float lambda, const RenderConfig& config);
float binToWavelength(int bin, const RenderConfig& config);

SpectralPowerDistribution loadSPDFromCSV(
    const std::string& filename,
    const RenderConfig& config
);

#endif
