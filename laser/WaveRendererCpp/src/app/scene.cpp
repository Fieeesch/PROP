#include "wave/app/scene.hpp"

#include "wave/optics/focus.hpp"

namespace wave {
    namespace {
        [[nodiscard]] Vec3 computeLaserSpotCenter(const Plane &wallPlane, const Plane &laserPlane) {
            const Vec3 beamDirection = glm::normalize(laserPlane.normal);
            const float denominator = glm::dot(wallPlane.normal, beamDirection);

            if (std::abs(denominator) < 1e-6f) {
                return wallPlane.center;
            }

            const float rayDistanceMm = glm::dot(wallPlane.center - laserPlane.center, wallPlane.normal) / denominator;
            if (rayDistanceMm <= 0.0f) {
                return wallPlane.center;
            }

            return laserPlane.center + beamDirection * rayDistanceMm;
        }

        [[nodiscard]] Plane resolveSensorPlaneForScene(
            const SimulationConfig &config,
            const Lens &lens,
            const Vec3 &focusPoint
        ) {
            const Plane sensorBasePlane = config.resolvedSensorPlane();
            if (!config.resolvedSensorAutoFocus()) {
                return sensorBasePlane;
            }

            return {
                computeSensorCenterForFocus(
                    lens.grid().basePlane(),
                    lens.focalLengthMm(),
                    focusPoint,
                    sensorBasePlane
                ),
                sensorBasePlane.normal
            };
        }
    } // namespace

    Scene::Scene(const SimulationConfig &config)
        : wall(
              config.wallPlane,
              config.wallWidth(),
              config.wallHeight(),
              config.pixelSizeMm()
          ),
          lens(
              config.lensPlane,
              config.lensWidth(),
              config.lensHeight(),
              config.lensPixelSizeMm(),
              config.lensFocalLengthMm,
              config.lensApertureRadiusMm
          ),
          focusPoint(computeLaserSpotCenter(config.wallPlane, config.resolvedLaserPlane())),
          sensor(
              resolveSensorPlaneForScene(config, lens, focusPoint),
              config.sensorSuperWidth(),
              config.sensorSuperHeight(),
              config.sensorPixelSizeMm()
          ),
          laser(
              config.resolvedLaserPlane(),
              config.laserRadiusMm,
              config.laserWavelengthNm,
              config.laserAmplitudeVm
          ),
          lensReferenceWave(makeReferenceWaveBetweenPlanes(wall.grid().basePlane(), lens.grid().basePlane())),
          sensorReferenceWave(makeReferenceWaveBetweenPlanes(lens.grid().basePlane(), sensor.grid().basePlane())),
          lensApertureMask(lens.apertureMask()) {
    }
} // namespace wave
