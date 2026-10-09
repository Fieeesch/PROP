#pragma once

#include <cstdint>
#include <vector>

#include "wave/core/envelope_field.hpp"
#include "wave/core/reference_wave.hpp"
#include "wave/core/sampled_plane.hpp"

namespace wave {
    [[nodiscard]] EnvelopeField propagateBetweenPlanes(
        const SampledPlane &srcPlane,
        const SampledPlane &dstPlane,
        float wavelengthNm,
        const EnvelopeField &sourceField,
        const ReferenceWave &dstReferenceWave,
        const std::vector<uint8_t> *dstMask = nullptr
    );

    [[nodiscard]] EnvelopeField propagateFFBetweenPlanes(
        const SampledPlane &srcPlane,
        const SampledPlane &dstPlane,
        float wavelengthNm,
        const EnvelopeField &sourceField,
        const ReferenceWave &dstReferenceWave,
        const std::vector<uint8_t> *dstMask = nullptr,
        int zeroPaddingFactor = 1,
        int spectralPaddingFactor = 1
    );
} // namespace wave
