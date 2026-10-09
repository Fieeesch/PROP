#pragma once

#include <string>
#include <vector>

#include "wave/core/math.hpp"

namespace wave {
    [[nodiscard]] Vec3 laserColorForWavelengthNm(float wavelengthNm);

    void writePPM(
        const std::string &filename,
        const std::vector<float> &intensity,
        int width,
        int height,
        const Vec3 &color
    );

    void writeCameraPPM(
        const std::string &filename,
        const std::vector<float> &intensity,
        int width,
        int height,
        const Vec3 &color
    );

    void writeAmplitudePPM(
        const std::string &filename,
        const std::vector<float> &amplitude,
        int width,
        int height
    );

    void writePhasePPM(
        const std::string &filename,
        const std::vector<float> &phase,
        int width,
        int height
    );
} // namespace wave
