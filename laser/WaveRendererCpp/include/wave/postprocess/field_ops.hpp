#pragma once

#include <complex>
#include <vector>

namespace wave {
    [[nodiscard]] std::vector<float> resolveIntensity(const std::vector<std::complex<float> > &field);

    [[nodiscard]] std::vector<float> resolveAmplitude(const std::vector<std::complex<float> > &field);

    [[nodiscard]] std::vector<float> resolvePhase(const std::vector<std::complex<float> > &field);
} // namespace wave
