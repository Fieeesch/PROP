#pragma once

#include <complex>
#include <vector>

#include "wave/core/sampled_plane.hpp"

namespace wave {
    class Sensor {
    public:
        Sensor(const Plane &plane, int width, int height, float pixelSizeMm);

        [[nodiscard]] const SampledPlane &grid() const;

        [[nodiscard]] std::vector<float> resolve(const std::vector<std::complex<float> > &sensorField) const;

    private:
        SampledPlane plane_;
    };
} // namespace wave
