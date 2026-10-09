#pragma once

#include "wave/core/plane.hpp"

namespace wave {
    [[nodiscard]] float distanceAlongOpticalAxisMm(const Plane &plane, const Vec3 &point);

    [[nodiscard]] float computeImageDistanceMm(float focalLengthMm, float objectDistanceMm);

    [[nodiscard]] Vec3 computeImagePointForFocus(const Plane &lensPlane, float focalLengthMm, const Vec3 &focusPoint);

    [[nodiscard]] Vec3 autofocusPlaneCenterAlongNormal(const Plane &sensorPlane, const Vec3 &pointOnSensorPlane);

    [[nodiscard]] Vec3 computeSensorCenterForFocus(
        const Plane &lensPlane,
        float focalLengthMm,
        const Vec3 &focusPoint,
        const Plane &sensorPlane
    );
} // namespace wave
