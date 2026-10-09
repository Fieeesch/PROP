#include "wave/postprocess/field_ops.hpp"

#include <cmath>

namespace wave {
    std::vector<float> resolveIntensity(const std::vector<std::complex<float> > &field) {
        std::vector<float> result(field.size());

        for (size_t index = 0; index < field.size(); ++index) {
            result[index] = std::norm(field[index]);
        }

        return result;
    }

    std::vector<float> resolveAmplitude(const std::vector<std::complex<float> > &field) {
        std::vector<float> result(field.size());

        for (size_t index = 0; index < field.size(); ++index) {
            result[index] = std::abs(field[index]);
        }

        return result;
    }

    std::vector<float> resolvePhase(const std::vector<std::complex<float> > &field) {
        std::vector<float> result(field.size());

        for (size_t index = 0; index < field.size(); ++index) {
            result[index] = std::atan2(field[index].imag(), field[index].real());
        }

        return result;
    }
} // namespace wave
