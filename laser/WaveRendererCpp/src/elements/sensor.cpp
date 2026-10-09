#include "wave/elements/sensor.hpp"

namespace wave {
    Sensor::Sensor(const Plane &plane, const int width, const int height, const float pixelSizeMm)
        : plane_(plane, width, height, pixelSizeMm) {
    }

    const SampledPlane &Sensor::grid() const {
        return plane_;
    }

    std::vector<float> Sensor::resolve(const std::vector<std::complex<float> > &sensorField) const {
        std::vector<float> result(plane_.width() * plane_.height());

        for (int index = 0; index < plane_.width() * plane_.height(); ++index) {
            result[index] = std::norm(sensorField[index]);
        }

        return result;
    }
} // namespace wave
