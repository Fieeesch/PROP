#include "wave/app/simulation_runner.hpp"

#include <chrono>
#include <iostream>
#include <utility>

#include "wave/io/field_debug_writer.hpp"
#include "wave/io/ppm_writer.hpp"
#include "wave/postprocess/field_ops.hpp"
#include "wave/postprocess/resampling.hpp"
#include "wave/propagation/plane_propagator.hpp"

namespace wave {
    SimulationRunner::SimulationRunner(SimulationConfig config)
        : config_(config) {
    }

    PropagationRun SimulationRunner::runSinglePropagation(
        const Scene &scene,
        const SimulationConfig &config,
        const unsigned seed
    ) {
        auto runTimedStep = []<typename T0>(const char *label, T0 &&step) {
            std::cerr << label << std::flush;
            const auto startTime = std::chrono::steady_clock::now();
            auto result = std::forward<T0>(step)();
            const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - startTime
            ).count();
            std::cerr << " ... done! (" << elapsedMs << "ms)\n";
            return result;
        };

        auto wallField = runTimedStep("simulation (1/4): illuminating wall", [&] {
            return scene.wall.illuminate(scene.laser, seed);
        });

        auto lensInputField = runTimedStep("simulation (2/4): propagating wall >> lens", [&] {
            return config.useFF
                       ? propagateFFBetweenPlanes(
                           scene.wall.grid(),
                           scene.lens.grid(),
                           scene.laser.wavelengthNm,
                           wallField,
                           scene.lensReferenceWave,
                           &scene.lensApertureMask,
                           config.fftZeroPaddingFactor
                       )
                       : propagateBetweenPlanes(
                           scene.wall.grid(),
                           scene.lens.grid(),
                           scene.laser.wavelengthNm,
                           wallField,
                           scene.lensReferenceWave,
                           &scene.lensApertureMask
                       );
        });

        auto lensOutputField = runTimedStep("simulation (3/4): applying lens distortion", [&] {
            return scene.lens.apply(lensInputField, scene.laser.wavelengthNm);
        });

        auto sensorField = runTimedStep("simulation (4/4): propagating lens >> sensor", [&] {
            return config.useFF
                       ? propagateFFBetweenPlanes(
                           scene.lens.grid(),
                           scene.sensor.grid(),
                           scene.laser.wavelengthNm,
                           lensOutputField,
                           scene.sensorReferenceWave,
                           nullptr,
                           config.fftZeroPaddingFactor,
                           config.sensorSupersampleFactor
                       )
                       : propagateBetweenPlanes(
                           scene.lens.grid(),
                           scene.sensor.grid(),
                           scene.laser.wavelengthNm,
                           lensOutputField,
                           scene.sensorReferenceWave,
                           nullptr
                       );
        });

        return {
            std::move(wallField),
            std::move(lensInputField),
            std::move(lensOutputField),
            std::move(sensorField)
        };
    }

    SimulationOutput SimulationRunner::run(const Scene &scene) const {
        auto propagationRun = runSinglePropagation(scene, config_, config_.baseSeed);
        std::vector<float> sensorIntensity = downsampleBoxAverage(
            scene.sensor.resolve(propagationRun.sensorField.samples),
            scene.sensor.grid().width(),
            scene.sensor.grid().height(),
            config_.sensorSupersampleFactor
        );

        return {
            std::move(propagationRun),
            std::move(sensorIntensity)
        };
    }

    void writeSimulationOutputs(const Scene &scene, const SimulationConfig &config, const SimulationOutput &output) {
        const auto wallIntensity = resolveIntensity(output.propagationRun.wallField.samples);
        const auto lensInputIntensity = resolveIntensity(output.propagationRun.lensInputField.samples);
        const auto lensOutputIntensity = resolveIntensity(output.propagationRun.lensOutputField.samples);
        const Vec3 intensityColor = laserColorForWavelengthNm(scene.laser.wavelengthNm);

        writePPM(
            "wall_output.ppm",
            wallIntensity,
            scene.wall.grid().width(),
            scene.wall.grid().height(),
            intensityColor
        );
        writePPM(
            "lens_input_output.ppm",
            lensInputIntensity,
            scene.lens.grid().width(),
            scene.lens.grid().height(),
            intensityColor
        );
        writePPM(
            "lens_output.ppm",
            lensOutputIntensity,
            scene.lens.grid().width(),
            scene.lens.grid().height(),
            intensityColor
        );
        writePPM(
            "sensor_linear_output.ppm",
            output.sensorIntensity,
            config.sensorOutputWidth(),
            config.sensorOutputHeight(),
            intensityColor
        );
        writeCameraPPM(
            "sensor_output.ppm",
            output.sensorIntensity,
            config.sensorOutputWidth(),
            config.sensorOutputHeight(),
            intensityColor
        );

        writeFieldDebugPPMs(
            "wall",
            output.propagationRun.wallField.samples,
            scene.wall.grid().width(),
            scene.wall.grid().height()
        );
        writeFieldDebugPPMs(
            "lens_input",
            output.propagationRun.lensInputField.samples,
            scene.lens.grid().width(),
            scene.lens.grid().height()
        );
        writeFieldDebugPPMs(
            "lens_output",
            output.propagationRun.lensOutputField.samples,
            scene.lens.grid().width(),
            scene.lens.grid().height()
        );
        writeFieldDebugPPMs(
            "sensor",
            output.propagationRun.sensorField.samples,
            scene.sensor.grid().width(),
            scene.sensor.grid().height()
        );
    }
} // namespace wave
