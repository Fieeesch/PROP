#pragma once

#include <complex>
#include <cstdint>
#include <vector>

#include "wave/core/envelope_field.hpp"
#include "wave/core/sampled_plane.hpp"

namespace wave {
    class Lens {
    public:
        Lens(
            const Plane &plane,
            int width,
            int height,
            float pixelSizeMm,
            float focalLengthMm,
            float apertureRadiusMm,
            float transmission = 1.0f
        );

        [[nodiscard]] const SampledPlane &grid() const;

        [[nodiscard]] float focalLengthMm() const;

        [[nodiscard]] std::vector<uint8_t> apertureMask() const;

        [[nodiscard]] EnvelopeField apply(const EnvelopeField &inputField, float wavelengthNm) const;

    private:
        [[nodiscard]] float radiusSquaredAt(int row, int col) const;

        [[nodiscard]] bool isInsideAperture(int row, int col) const;

        [[nodiscard]] std::complex<float> transferAt(int row, int col, float wavelengthNm) const;

        SampledPlane plane_;
        float focalLengthMm_;
        float apertureRadiusMm_;
        float transmission_;
    };
} // namespace wave
