#pragma once

#include "wave/core/math.hpp"

namespace wave {
    struct Plane {
        Vec3 center;
        Vec3 normal;
        float distance;
        Vec3 right;
        Vec3 up;

        Plane();

        Plane(const Vec3 &origin, const Vec3 &normal);
    };
} // namespace wave
