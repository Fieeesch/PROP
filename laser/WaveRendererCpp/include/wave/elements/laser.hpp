#pragma once

#include "wave/core/plane.hpp"

namespace wave {
    struct Laser {
        Plane plane;
        float radiusMm;
        float wavelengthNm;
        float amplitudeVm;

        Laser(const Plane &plane, const float radiusMm, const float wavelengthNm, const float amplitudeVm)
            : plane(plane),
              radiusMm(radiusMm),
              wavelengthNm(wavelengthNm),
              amplitudeVm(amplitudeVm) {
        }
    };
} // namespace wave
