#include <chrono>
#include <cmath>
#include <format>
#include <iostream>

#include "wave/app/scene.hpp"
#include "wave/app/simulation_runner.hpp"
#include "wave/optics/focus.hpp"

int main() {
    const wave::SimulationConfig config;
    const wave::Scene scene(config);
    const wave::SimulationRunner runner(config);

    auto now = std::chrono::system_clock::now();
    std::cerr << "starting: "
            << std::format("{:%Y-%m-%d %H:%M:%S}", now)
            << '\n';
    std::cerr << "laser preset: " << config.laserPreset << " (" << config.laserPresetName() << ")\n";
    std::cerr << "sensor preset: " << config.sensorPreset << " (" << config.sensorPresetName()
            << "), autofocus: " << (config.resolvedSensorAutoFocus() ? "on" : "off") << '\n';
    std::cerr << "focus distance object->lens: "
            << std::abs(wave::distanceAlongOpticalAxisMm(scene.lens.grid().basePlane(), scene.focusPoint))
            << " mm, lens->sensor: "
            << std::abs(
                wave::distanceAlongOpticalAxisMm(
                    scene.lens.grid().basePlane(),
                    scene.sensor.grid().basePlane().center
                )
            )
            << " mm\n";
    std::cerr << "laser spot focus point: ("
            << scene.focusPoint.x << ", "
            << scene.focusPoint.y << ", "
            << scene.focusPoint.z << "), sensor center: ("
            << scene.sensor.grid().basePlane().center.x << ", "
            << scene.sensor.grid().basePlane().center.y << ", "
            << scene.sensor.grid().basePlane().center.z << ")\n";

    const auto output = runner.run(scene);

    now = std::chrono::system_clock::now();
    std::cerr << "stopping: "
            << std::format("{:%Y-%m-%d %H:%M:%S}", now)
            << '\n';

    wave::writeSimulationOutputs(scene, config, output);
}
