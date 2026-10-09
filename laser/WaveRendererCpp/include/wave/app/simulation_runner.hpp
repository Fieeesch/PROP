#pragma once

#include <vector>

#include "wave/app/scene.hpp"
#include "wave/core/envelope_field.hpp"

namespace wave {
    struct PropagationRun {
        EnvelopeField wallField;
        EnvelopeField lensInputField;
        EnvelopeField lensOutputField;
        EnvelopeField sensorField;
    };

    struct SimulationOutput {
        PropagationRun propagationRun;
        std::vector<float> sensorIntensity;
    };

    class SimulationRunner {
    public:
        explicit SimulationRunner(SimulationConfig config);

        [[nodiscard]] SimulationOutput run(const Scene &scene) const;

    private:
        [[nodiscard]] static PropagationRun runSinglePropagation(
            const Scene &scene,
            const SimulationConfig &config,
            unsigned seed
        );

        SimulationConfig config_;
    };

    void writeSimulationOutputs(const Scene &scene, const SimulationConfig &config, const SimulationOutput &output);
} // namespace wave
