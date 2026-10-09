#ifndef RENDERER_2D_CONFIG_H
#define RENDERER_2D_CONFIG_H

#include <cstdint>
#include <string>

struct RenderConfig {
    int recursionDepth = 4;
    float lambdaMin = 0.38f;
    float lambdaMax = 0.78f;
    int spectrumBins = 81;
    float lightPower = 200.0f;
    int lightSamples = 1024 * 1024 * 16;
    float imageExposure = 100.0f;
    int imageWidth = 256 * 2;
    int imageHeight = 256 * 2;
    bool rngSeedEnabled = false;
    std::uint32_t rngSeed = 1;
};

inline const std::string SPD_FILENAME = "data/illuminants/CIE_illum_HPs.csv";
inline const std::string SELLMEIER_FILENAME = "data/material_sellmeier/bk7_sellmeier_coefficients.csv";
inline const std::string ABSORP_FILENAME = "data/material_absorption/bk7_absorption_coefficients.csv";
constexpr bool USE_SCHLICK_APPROXIMATION = false;

#endif
