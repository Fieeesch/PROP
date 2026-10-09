#pragma once

#include "wave/core/plane.hpp"

namespace wave {
    struct SimulationConfig {
        bool useFF = true;

        // 216x216 was the smallest setup without obvious grid artifacts in the
        // original prototype. Higher resolutions get expensive quickly.
        int width = 216;
        int height = 216;

        int wallFactor = 2;
        int lensFactor = 1;
        int lensSupersampleFactor = 2;
        int sensorFactor = 1;
        int sensorSupersampleFactor = 2;
        int fftZeroPaddingFactor = 4;

        float laserRadiusMm = 1.75f;
        float lensApertureRadiusMm = 2.56f;
        float planeWidthMm = 5.12f;
        float lensFocalLengthMm = 128.0f;
        float laserWavelengthNm = 650.0f;
        float laserAmplitudeVm = 500.0f;
        unsigned baseSeed = 42069u;

        Plane lensPlane = Plane(Vec3(128.0f, 128.0f, -128.0f), Vec3(0.0f, 0.0f, -1.0f));
        Plane wallPlane = Plane(Vec3(128.0f, 128.0f, 256.0f), Vec3(0.0f, 0.0f, -1.0f));

        // Presets: 0 = customLaserPlane, 1 = normal incidence,
        // 2 = 45 degree oblique incidence, 3 = oblique with lateral shift,
        // 4 = shallow oblique incidence.
        int laserPreset = 1;
        Plane customLaserPlane = Plane(Vec3(-128.0f, 128.0f, 0.0f), Vec3(1.0f, 0.0f, 1.0f));

        // Presets: 0 = customSensorPlane/customSensorAutoFocus,
        // 1 = centered autofocus, 2 = x-shifted autofocus,
        // 3 = diagonal shift autofocus, 4 = strong y-tilt autofocus,
        // 5 = strong tilt plus lateral shift autofocus,
        // 6 = strongly defocused reference plane,
        // 7 = very shallow diagonal grazing-angle autofocus.
        int sensorPreset = 1;
        Plane customSensorPlane = Plane(Vec3(128.0f, 128.0f, -320.0f), Vec3(0.0f, 0.0f, 1.0f));
        bool customSensorAutoFocus = true;

        [[nodiscard]] const char *laserPresetName() const {
            switch (laserPreset) {
                case 1:
                    return "normal incidence";
                case 2:
                    return "45 degree oblique incidence";
                case 3:
                    return "45 degree oblique incidence with lateral shift";
                case 4:
                    return "shallow oblique incidence";
                default:
                    return "custom laser plane";
            }
        }

        [[nodiscard]] Plane resolvedLaserPlane() const {
            switch (laserPreset) {
                case 1:
                    return {
                        Vec3(128.0f, 128.0f, 0.0f),
                        Vec3(0.0f, 0.0f, 1.0f)
                    };
                case 2:
                    return {
                        Vec3(-128.0f, 128.0f, 0.0f),
                        Vec3(1.0f, 0.0f, 1.0f)
                    };
                case 3:
                    return {
                        Vec3(-128.0f, 129.5f, 0.0f),
                        Vec3(1.0f, 0.0f, 1.0f)
                    };
                case 4:
                    return {
                        Vec3(-384.0f, 128.0f, 0.0f),
                        Vec3(2.0f, 0.0f, 1.0f)
                    };
                default:
                    return customLaserPlane;
            }
        }

        [[nodiscard]] const char *sensorPresetName() const {
            switch (sensorPreset) {
                case 1:
                    return "centered autofocus";
                case 2:
                    return "x-shifted autofocus";
                case 3:
                    return "diagonal shift autofocus";
                case 4:
                    return "strong y-tilt autofocus";
                case 5:
                    return "strong tilt plus lateral shift autofocus";
                case 6:
                    return "strongly defocused reference plane";
                case 7:
                    return "very shallow diagonal grazing-angle autofocus";
                default:
                    return "custom sensor pose";
            }
        }

        [[nodiscard]] Plane resolvedSensorPlane() const {
            switch (sensorPreset) {
                case 1:
                    return {
                        Vec3(128.0f, 128.0f, -320.0f),
                        Vec3(0.0f, 0.0f, 1.0f)
                    };
                case 2:
                    return {
                        Vec3(129.0f, 128.0f, -320.0f),
                        Vec3(0.0f, 0.0f, 1.0f)
                    };
                case 3:
                    return {
                        Vec3(128.8f, 127.4f, -320.0f),
                        Vec3(0.0f, 0.0f, 1.0f)
                    };
                case 4:
                    return {
                        Vec3(128.0f, 128.0f, -320.0f),
                        Vec3(0.40f, 0.0f, 1.0f)
                    };
                case 5:
                    return {
                        Vec3(129.0f, 127.5f, -320.0f),
                        Vec3(0.55f, -0.25f, 1.0f)
                    };
                case 6:
                    return {
                        Vec3(128.0f, 128.0f, -272.0f),
                        Vec3(0.0f, 0.0f, 1.0f)
                    };
                case 7:
                    return {
                        Vec3(130.0f, 126.7f, -320.0f),
                        Vec3(1.10f, -1.60f, 0.80f)
                    };
                default:
                    return customSensorPlane;
            }
        }

        [[nodiscard]] bool resolvedSensorAutoFocus() const {
            switch (sensorPreset) {
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 7:
                    return true;
                case 6:
                    return false;
                default:
                    return customSensorAutoFocus;
            }
        }

        [[nodiscard]] float pixelSizeMm() const {
            return planeWidthMm / static_cast<float>(width);
        }

        [[nodiscard]] int wallWidth() const {
            return width * wallFactor;
        }

        [[nodiscard]] int wallHeight() const {
            return height * wallFactor;
        }

        [[nodiscard]] int lensWidth() const {
            return width * lensFactor * lensSupersampleFactor;
        }

        [[nodiscard]] int lensHeight() const {
            return height * lensFactor * lensSupersampleFactor;
        }

        [[nodiscard]] float lensPixelSizeMm() const {
            return pixelSizeMm() / static_cast<float>(lensSupersampleFactor);
        }

        [[nodiscard]] int sensorOutputWidth() const {
            return width * sensorFactor;
        }

        [[nodiscard]] int sensorOutputHeight() const {
            return height * sensorFactor;
        }

        [[nodiscard]] int sensorSuperWidth() const {
            return sensorOutputWidth() * sensorSupersampleFactor;
        }

        [[nodiscard]] int sensorSuperHeight() const {
            return sensorOutputHeight() * sensorSupersampleFactor;
        }

        [[nodiscard]] float sensorPixelSizeMm() const {
            return pixelSizeMm() / static_cast<float>(sensorSupersampleFactor);
        }
    };
} // namespace wave
