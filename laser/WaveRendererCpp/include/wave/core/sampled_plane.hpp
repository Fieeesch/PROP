#pragma once

#include <vector>

#include "wave/core/plane.hpp"

namespace wave {
    class SampledPlane {
    public:
        SampledPlane(const Plane &plane, int width, int height, float pixelSizeMm);

        [[nodiscard]] int width() const;

        [[nodiscard]] int height() const;

        [[nodiscard]] float pixelSizeMm() const;

        [[nodiscard]] const Plane &basePlane() const;

        [[nodiscard]] Vec3 samplePosition(int row, int col) const;

        [[nodiscard]] const std::vector<Vec3> &samplePositions() const;

    private:
        int width_;
        int height_;
        float pixelSizeMm_;
        Plane basePlane_;
        mutable std::vector<Vec3> cachedSamplePositions_;
        mutable bool hasCachedSamplePositions_ = false;
    };
} // namespace wave
