#pragma once

#include <complex>
#include <utility>
#include <vector>

#include "wave/core/reference_wave.hpp"

namespace wave {
    struct EnvelopeField {
        std::vector<std::complex<float> > samples;
        ReferenceWave referenceWave;

        EnvelopeField() = default;

        EnvelopeField(std::vector<std::complex<float> > values, const ReferenceWave &reference)
            : samples(std::move(values)),
              referenceWave(reference) {
        }
    };
} // namespace wave
