#pragma once

#include "wave/core/plane.hpp"

namespace wave {
    struct ReferenceWave {
        Vec3 direction;
        Vec3 origin;

        ReferenceWave();

        ReferenceWave(const Vec3 &direction, const Vec3 &origin);
    };

    [[nodiscard]] double referenceOpticalPathMm(const ReferenceWave &referenceWave, const Vec3 &position);

    [[nodiscard]] ReferenceWave makeReferenceWaveBetweenPlanes(const Plane &srcPlane, const Plane &dstPlane);
} // namespace wave
