#pragma once

#include <complex>
#include <vector>

#include "wave/core/envelope_field.hpp"
#include "wave/core/sampled_plane.hpp"
#include "wave/elements/laser.hpp"

namespace wave {
    class DiffuseWall {
    public:
        DiffuseWall(
            const Plane &plane,
            int width,
            int height,
            float pixelSizeMm,
            float correlationLengthMm = 0.04f,
            float albedo = 1.0f
        );

        [[nodiscard]] const SampledPlane &grid() const;

        [[nodiscard]] EnvelopeField illuminate(const Laser &laser, unsigned seed = 42069u) const;

    private:
        static std::vector<float> makeCorrelatedNormalField(
            int width,
            int height,
            float pixelSizeMm,
            float correlationLengthMm,
            unsigned seed
        );

        static std::vector<std::complex<float> > makeDiffuseReflectanceField(
            int width,
            int height,
            float pixelSizeMm,
            float correlationLengthMm,
            unsigned seed
        );

        SampledPlane plane_;
        float correlationLengthMm_;
        float albedo_;
    };
} // namespace wave
