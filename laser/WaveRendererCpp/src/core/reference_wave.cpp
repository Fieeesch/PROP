#include "wave/core/reference_wave.hpp"

namespace wave {
    ReferenceWave::ReferenceWave()
        : direction(0.0f, 0.0f, 1.0f),
          origin(0.0f, 0.0f, 0.0f) {
    }

    ReferenceWave::ReferenceWave(const Vec3 &direction, const Vec3 &origin)
        : direction(glm::normalize(direction)),
          origin(origin) {
    }

    double referenceOpticalPathMm(const ReferenceWave &referenceWave, const Vec3 &position) {
        return glm::dot(
            glm::dvec3(referenceWave.direction),
            glm::dvec3(position) - glm::dvec3(referenceWave.origin)
        );
    }

    ReferenceWave makeReferenceWaveBetweenPlanes(const Plane &srcPlane, const Plane &dstPlane) {
        return {dstPlane.center - srcPlane.center, dstPlane.center};
    }
} // namespace wave
