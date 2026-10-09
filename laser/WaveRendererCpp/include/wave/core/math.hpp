#pragma once

#include <glm/glm.hpp>
#include <complex>

namespace wave {
    using Vec3 = glm::vec3;

    inline constexpr float kPi = 3.14159265358979323846f;
    inline constexpr auto kI = std::complex(0.0f, 1.0f);
} // namespace wave
