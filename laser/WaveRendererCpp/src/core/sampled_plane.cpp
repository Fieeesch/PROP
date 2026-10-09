#include "wave/core/sampled_plane.hpp"

namespace wave {
    SampledPlane::SampledPlane(const Plane &plane, const int width, const int height, const float pixelSizeMm)
        : width_(width),
          height_(height),
          pixelSizeMm_(pixelSizeMm),
          basePlane_(plane) {
    }

    int SampledPlane::width() const {
        return width_;
    }

    int SampledPlane::height() const {
        return height_;
    }

    float SampledPlane::pixelSizeMm() const {
        return pixelSizeMm_;
    }

    const Plane &SampledPlane::basePlane() const {
        return basePlane_;
    }

    Vec3 SampledPlane::samplePosition(const int row, const int col) const {
        return basePlane_.center
               + (static_cast<float>(col) - (static_cast<float>(width_) - 1.0f) * 0.5f) * pixelSizeMm_ * basePlane_.
               right
               + (static_cast<float>(row) - (static_cast<float>(height_) - 1.0f) * 0.5f) * pixelSizeMm_ * basePlane_.up;
    }

    const std::vector<Vec3> &SampledPlane::samplePositions() const {
        if (!hasCachedSamplePositions_) {
            cachedSamplePositions_.resize(width_ * height_);

            for (int row = 0; row < height_; ++row) {
                for (int col = 0; col < width_; ++col) {
                    cachedSamplePositions_[row * width_ + col] = samplePosition(row, col);
                }
            }

            hasCachedSamplePositions_ = true;
        }

        return cachedSamplePositions_;
    }
} // namespace wave
