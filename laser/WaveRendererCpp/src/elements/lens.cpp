#include "wave/elements/lens.hpp"

#include <cmath>

#include "wave/core/math.hpp"

namespace wave {
    Lens::Lens(
        const Plane &plane,
        const int width,
        const int height,
        const float pixelSizeMm,
        const float focalLengthMm,
        const float apertureRadiusMm,
        const float transmission
    )
        : plane_(plane, width, height, pixelSizeMm),
          focalLengthMm_(focalLengthMm),
          apertureRadiusMm_(apertureRadiusMm),
          transmission_(transmission) {
    }

    const SampledPlane &Lens::grid() const {
        return plane_;
    }

    float Lens::focalLengthMm() const {
        return focalLengthMm_;
    }

    float Lens::radiusSquaredAt(const int row, const int col) const {
        const float x = (static_cast<float>(col) - (static_cast<float>(plane_.width()) - 1.0f) * 0.5f) * plane_.
                        pixelSizeMm();
        const float y = (static_cast<float>(row) - (static_cast<float>(plane_.height()) - 1.0f) * 0.5f) * plane_.
                        pixelSizeMm();
        return x * x + y * y;
    }

    bool Lens::isInsideAperture(const int row, const int col) const {
        return radiusSquaredAt(row, col) <= apertureRadiusMm_ * apertureRadiusMm_;
    }

    std::vector<uint8_t> Lens::apertureMask() const {
        std::vector<uint8_t> mask(plane_.width() * plane_.height(), 0);

        for (int row = 0; row < plane_.height(); ++row) {
            for (int col = 0; col < plane_.width(); ++col) {
                if (isInsideAperture(row, col)) {
                    mask[row * plane_.width() + col] = 1;
                }
            }
        }

        return mask;
    }

    std::complex<float> Lens::transferAt(const int row, const int col, const float wavelengthNm) const {
        const float radiusSquared = radiusSquaredAt(row, col);
        if (radiusSquared > apertureRadiusMm_ * apertureRadiusMm_) {
            return {0.0f, 0.0f};
        }

        const float wavelengthMm = wavelengthNm * 1e-6f;
        const float k = 2.0f * kPi / wavelengthMm;
        const float phi = -k * radiusSquared / (2.0f * focalLengthMm_);

        return transmission_ * std::complex(std::cos(phi), std::sin(phi));
    }

    EnvelopeField Lens::apply(const EnvelopeField &inputField, const float wavelengthNm) const {
        std::vector<std::complex<float> > result(plane_.width() * plane_.height());

        for (int row = 0; row < plane_.height(); ++row) {
            for (int col = 0; col < plane_.width(); ++col) {
                const int index = row * plane_.width() + col;
                result[index] = inputField.samples[index] * transferAt(row, col, wavelengthNm);
            }
        }

        return {std::move(result), inputField.referenceWave};
    }
} // namespace wave
