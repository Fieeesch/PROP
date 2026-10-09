#include "wave/elements/diffuse_wall.hpp"

#include <algorithm>
#include <cmath>
#include <random>

namespace wave {
    DiffuseWall::DiffuseWall(
        const Plane &plane,
        const int width,
        const int height,
        const float pixelSizeMm,
        const float correlationLengthMm,
        const float albedo
    )
        : plane_(plane, width, height, pixelSizeMm),
          correlationLengthMm_(correlationLengthMm),
          albedo_(albedo) {
    }

    const SampledPlane &DiffuseWall::grid() const {
        return plane_;
    }

    std::vector<float> DiffuseWall::makeCorrelatedNormalField(
        const int width,
        const int height,
        const float pixelSizeMm,
        const float correlationLengthMm,
        const unsigned seed
    ) {
        const float safePixelSizeMm = std::max(pixelSizeMm, 1e-6f);
        const float safeCorrelationLengthMm = std::max(correlationLengthMm, safePixelSizeMm);
        const float widthMm = static_cast<float>(std::max(width - 1, 0)) * safePixelSizeMm;
        const float heightMm = static_cast<float>(std::max(height - 1, 0)) * safePixelSizeMm;

        const int lowWidth = std::max(
            2,
            static_cast<int>(std::ceil(widthMm / safeCorrelationLengthMm)) + 1
        );
        const int lowHeight = std::max(
            2,
            static_cast<int>(std::ceil(heightMm / safeCorrelationLengthMm)) + 1
        );

        std::mt19937 generator(seed);
        std::normal_distribution distribution(0.0f, 1.0f);

        std::vector<float> low(lowWidth * lowHeight);
        for (int y = 0; y < lowHeight; ++y) {
            for (int x = 0; x < lowWidth; ++x) {
                low[y * lowWidth + x] = distribution(generator);
            }
        }

        std::vector<float> values(width * height);
        for (int y = 0; y < height; ++y) {
            const float yMm = static_cast<float>(y) * safePixelSizeMm;
            const float gy = yMm / safeCorrelationLengthMm;
            const int y0 = static_cast<int>(std::floor(gy));
            const int y1 = std::min(y0 + 1, lowHeight - 1);
            const float ty = gy - static_cast<float>(y0);

            for (int x = 0; x < width; ++x) {
                const float xMm = static_cast<float>(x) * safePixelSizeMm;
                const float gx = xMm / safeCorrelationLengthMm;
                const int x0 = static_cast<int>(std::floor(gx));
                const int x1 = std::min(x0 + 1, lowWidth - 1);
                const float tx = gx - static_cast<float>(x0);

                const float a = low[y0 * lowWidth + x0];
                const float b = low[y0 * lowWidth + x1];
                const float c = low[y1 * lowWidth + x0];
                const float d = low[y1 * lowWidth + x1];

                const float ab = a * (1.0f - tx) + b * tx;
                const float cd = c * (1.0f - tx) + d * tx;

                values[y * width + x] = ab * (1.0f - ty) + cd * ty;
            }
        }

        double mean = 0.0;
        for (const float value: values) {
            mean += value;
        }
        mean /= static_cast<double>(values.size());

        double variance = 0.0;
        for (const float value: values) {
            const double delta = static_cast<double>(value) - mean;
            variance += delta * delta;
        }
        variance /= static_cast<double>(values.size());

        const auto rms = static_cast<float>(std::sqrt(variance));
        const float scale = rms > 0.0f ? 1.0f / rms : 0.0f;

        for (float &value: values) {
            value = (value - static_cast<float>(mean)) * scale;
        }

        return values;
    }

    std::vector<std::complex<float> > DiffuseWall::makeDiffuseReflectanceField(
        const int width,
        const int height,
        const float pixelSizeMm,
        const float correlationLengthMm,
        const unsigned seed
    ) {
        const std::vector<float> realPart =
                makeCorrelatedNormalField(width, height, pixelSizeMm, correlationLengthMm, seed);
        const std::vector<float> imagPart =
                makeCorrelatedNormalField(width, height, pixelSizeMm, correlationLengthMm, seed + 1u);

        std::vector<std::complex<float> > reflectance(width * height);
        double meanPower = 0.0;

        for (int index = 0; index < width * height; ++index) {
            reflectance[index] = {realPart[index], imagPart[index]};
            meanPower += static_cast<double>(std::norm(reflectance[index]));
        }

        const float scale = meanPower > 0.0
                                ? static_cast<float>(1.0 / std::sqrt(
                                                         meanPower / static_cast<double>(reflectance.size())))
                                : 0.0f;

        for (auto &value: reflectance) {
            value *= scale;
        }

        return reflectance;
    }

    EnvelopeField DiffuseWall::illuminate(const Laser &laser, const unsigned seed) const {
        std::vector<std::complex<float> > result(plane_.width() * plane_.height());

        const Vec3 beamDirection = glm::normalize(laser.plane.normal);
        const ReferenceWave wallReferenceWave(beamDirection, laser.plane.center);
        const std::vector<std::complex<float> > diffuseReflectance = makeDiffuseReflectanceField(
            plane_.width(),
            plane_.height(),
            plane_.pixelSizeMm(),
            correlationLengthMm_,
            seed
        );

        const auto &samplePositions = plane_.samplePositions();

        for (int index = 0; index < plane_.width() * plane_.height(); ++index) {
            const Vec3 position = samplePositions[index];
            const Vec3 relative = position - laser.plane.center;
            const float z = glm::dot(relative, beamDirection);

            if (z <= 0.0f) {
                result[index] = {0.0f, 0.0f};
                continue;
            }

            const Vec3 radial = relative - z * beamDirection;
            const float radius = glm::length(radial);
            const float laserAmplitude = laser.amplitudeVm * std::exp(
                                             -(radius * radius) / (laser.radiusMm * laser.radiusMm));
            const float finalAmplitude = laserAmplitude * std::sqrt(albedo_);

            result[index] = finalAmplitude * diffuseReflectance[index];
        }

        return {std::move(result), wallReferenceWave};
    }
} // namespace wave
