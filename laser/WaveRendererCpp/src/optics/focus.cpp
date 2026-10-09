#include "wave/optics/focus.hpp"

#include <cmath>

namespace wave {
    float distanceAlongOpticalAxisMm(const Plane &plane, const Vec3 &point) {
        return glm::dot(point - plane.center, plane.normal);
    }

    float computeImageDistanceMm(const float focalLengthMm, const float objectDistanceMm) {
        return focalLengthMm * objectDistanceMm / (objectDistanceMm - focalLengthMm);
    }

    Vec3 computeImagePointForFocus(const Plane &lensPlane, const float focalLengthMm, const Vec3 &focusPoint) {
        const Vec3 lensToFocus = focusPoint - lensPlane.center;
        const float signedObjectDistanceMm = glm::dot(lensToFocus, lensPlane.normal);
        const float objectDistanceMm = std::abs(signedObjectDistanceMm);

        if (objectDistanceMm <= 1e-6f) {
            return lensPlane.center;
        }

        const float imageDistanceMm = computeImageDistanceMm(focalLengthMm, objectDistanceMm);
        const Vec3 transverseOffset = lensToFocus - signedObjectDistanceMm * lensPlane.normal;

        return lensPlane.center
               + lensPlane.normal * imageDistanceMm
               - transverseOffset * (imageDistanceMm / objectDistanceMm);
    }

    Vec3 autofocusPlaneCenterAlongNormal(const Plane &sensorPlane, const Vec3 &pointOnSensorPlane) {
        const float shiftMm = glm::dot(pointOnSensorPlane - sensorPlane.center, sensorPlane.normal);
        return sensorPlane.center + sensorPlane.normal * shiftMm;
    }

    Vec3 computeSensorCenterForFocus(
        const Plane &lensPlane,
        const float focalLengthMm,
        const Vec3 &focusPoint,
        const Plane &sensorPlane
    ) {
        return autofocusPlaneCenterAlongNormal(
            sensorPlane,
            computeImagePointForFocus(lensPlane, focalLengthMm, focusPoint)
        );
    }
} // namespace wave
