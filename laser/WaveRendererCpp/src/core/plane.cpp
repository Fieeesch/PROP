#include "wave/core/plane.hpp"

#include <cmath>

namespace wave {
    Plane::Plane()
        : center(0.0f, 0.0f, 0.0f),
          normal(0.0f, 0.0f, 1.0f),
          distance(0.0f),
          right(1.0f, 0.0f, 0.0f),
          up(0.0f, 1.0f, 0.0f) {
    }

    Plane::Plane(const Vec3 &origin, const Vec3 &normal)
        : center(origin),
          normal(glm::normalize(normal)),
          distance(-glm::dot(this->normal, origin)) {
        const Vec3 helper = std::abs(this->normal.y) < 0.999f
                                ? Vec3(0.0f, 1.0f, 0.0f)
                                : Vec3(1.0f, 0.0f, 0.0f);

        right = glm::normalize(glm::cross(helper, this->normal));
        up = glm::normalize(glm::cross(this->normal, right));
    }
} // namespace wave
