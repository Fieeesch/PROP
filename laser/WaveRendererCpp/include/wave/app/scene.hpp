#pragma once

#include <cstdint>
#include <vector>

#include "wave/app/simulation_config.hpp"
#include "wave/core/reference_wave.hpp"
#include "wave/elements/diffuse_wall.hpp"
#include "wave/elements/laser.hpp"
#include "wave/elements/lens.hpp"
#include "wave/elements/sensor.hpp"

namespace wave {
    struct Scene {
        explicit Scene(const SimulationConfig &config);

        DiffuseWall wall;
        Lens lens;
        Vec3 focusPoint;
        Sensor sensor;
        Laser laser;
        ReferenceWave lensReferenceWave;
        ReferenceWave sensorReferenceWave;
        std::vector<uint8_t> lensApertureMask;
    };
} // namespace wave
