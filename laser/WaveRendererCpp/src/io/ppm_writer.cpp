#include "wave/io/ppm_writer.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <ranges>

#include "wave/core/math.hpp"

namespace wave {
    namespace {
        // ReSharper disable once CppDFAConstantParameter
        [[nodiscard]] float percentileValue(std::vector<float> values, const float percentile) {
            if (values.empty()) {
                return 0.0f;
            }

            const float clampedPercentile = std::clamp(percentile, 0.0f, 1.0f);
            const auto index = static_cast<size_t>(
                clampedPercentile * static_cast<float>(values.size() - 1)
            );

            std::ranges::nth_element(values, values.begin() + static_cast<std::ptrdiff_t>(index));
            return values[index];
        }

        [[nodiscard]] unsigned char toByte(const float value) {
            return static_cast<unsigned char>(255.0f * std::clamp(value, 0.0f, 1.0f));
        }

        template<typename TTransform>
        void writeBinaryPPMImage(
            const std::string &filename,
            const int width,
            const int height,
            const size_t pixelCount,
            TTransform &&transform
        ) {
            std::ofstream out(filename, std::ios::binary);
            out << "P6\n" << width << " " << height << "\n255\n";

            std::vector<unsigned char> buffer(pixelCount * 3);
            for (size_t index = 0; index < pixelCount; ++index) {
                const std::array<unsigned char, 3> rgb = transform(index);
                const size_t offset = index * 3;
                buffer[offset + 0] = rgb[0];
                buffer[offset + 1] = rgb[1];
                buffer[offset + 2] = rgb[2];
            }

            out.write(reinterpret_cast<const char *>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
        }
    } // namespace

    Vec3 laserColorForWavelengthNm(const float wavelengthNm) {
        if (wavelengthNm < 500.0f) {
            return {0.25f, 0.45f, 1.0f};
        }
        if (wavelengthNm < 580.0f) {
            return {0.1f, 1.0f, 0.2f};
        }
        if (wavelengthNm < 620.0f) {
            return {1.0f, 0.9f, 0.1f};
        }
        return {1.0f, 0.1f, 0.1f};
    }

    void writePPM(
        const std::string &filename,
        const std::vector<float> &intensity,
        const int width,
        const int height,
        const Vec3 &color
    ) {
        float maxIntensity = 0.0f;
        for (const float value: intensity) {
            maxIntensity = std::max(maxIntensity, value);
        }

        writeBinaryPPMImage(filename, width, height, intensity.size(), [&](const size_t index) {
            const float value = intensity[index];
            float x = 0.0f;
            if (maxIntensity > 0.0f) {
                x = value / maxIntensity;
            }

            x = std::sqrt(std::clamp(x, 0.0f, 1.0f));

            const Vec3 rgb = x * color;
            return std::array{
                toByte(rgb.r),
                toByte(rgb.g),
                toByte(rgb.b)
            };
        });
    }

    void writeCameraPPM(
        const std::string &filename,
        const std::vector<float> &intensity,
        const int width,
        const int height,
        const Vec3 &color
    ) {
        constexpr float whitePercentile = 0.995f;
        constexpr float highlightHeadroom = 1.25f;

        const float whitePoint = percentileValue(intensity, whitePercentile);
        const float exposure = whitePoint > 0.0f ? highlightHeadroom / whitePoint : 0.0f;

        writeBinaryPPMImage(filename, width, height, intensity.size(), [&](const size_t index) {
            const float value = intensity[index];
            constexpr float gamma = 2.2f;
            const float linear = std::max(0.0f, value * exposure);
            const float clipped = std::clamp(linear, 0.0f, 1.0f);
            const float encoded = std::pow(clipped, 1.0f / gamma);

            const Vec3 rgb = encoded * color;
            return std::array{
                toByte(rgb.r),
                toByte(rgb.g),
                toByte(rgb.b)
            };
        });
    }

    void writeAmplitudePPM(
        const std::string &filename,
        const std::vector<float> &amplitude,
        const int width,
        const int height
    ) {
        float maxAmplitude = 0.0f;
        for (const float value: amplitude) {
            maxAmplitude = std::max(maxAmplitude, value);
        }

        writeBinaryPPMImage(filename, width, height, amplitude.size(), [&](const size_t index) {
            const float value = amplitude[index];
            float x = 0.0f;
            if (maxAmplitude > 0.0f) {
                x = value / maxAmplitude;
            }

            x = std::sqrt(std::clamp(x, 0.0f, 1.0f));
            const unsigned char gray = toByte(x);
            return std::array{gray, gray, gray};
        });
    }

    void writePhasePPM(
        const std::string &filename,
        const std::vector<float> &phase,
        const int width,
        const int height
    ) {
        writeBinaryPPMImage(filename, width, height, phase.size(), [&](const size_t index) {
            const float value = phase[index];
            const float wrapped = (value + kPi) / (2.0f * kPi);
            const float t = std::clamp(wrapped, 0.0f, 1.0f);

            const float r = 0.5f + 0.5f * std::cos(2.0f * kPi * t);
            const float g = 0.5f + 0.5f * std::cos(2.0f * kPi * (t - 1.0f / 3.0f));
            const float b = 0.5f + 0.5f * std::cos(2.0f * kPi * (t - 2.0f / 3.0f));

            return std::array{
                toByte(r),
                toByte(g),
                toByte(b)
            };
        });
    }
} // namespace wave
