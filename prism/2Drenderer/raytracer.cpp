//
// Created by Cecilia on 10.06.2026.
//

#include <vector>
#include <glm/glm.hpp>
#include <chrono>
#include <cstdint>
#include <random>
#include "config.h"
#include "geometry.h"
#include "optics.h"
#include "spectrum.h"
#include "raytracer.h"
#ifdef RENDERER_2D_WITH_CUDA
#include "raytracer_cuda.h"
#endif

#include <iostream>
#include <omp.h>

// Brechungsindex Luft
constexpr float ior_air = 1.0f;
// Pi
constexpr float PI = 3.14159265358979323846f;

std::mt19937 createThreadRng(const RenderConfig& config) {
    const auto thread = static_cast<std::uint32_t>(omp_get_thread_num());
    if (config.rngSeedEnabled) {
        std::seed_seq seedSequence{config.rngSeed, thread};
        return std::mt19937(seedSequence);
    }

    std::random_device randomDevice;
    std::seed_seq seedSequence{randomDevice(), randomDevice(), thread};
    return std::mt19937(seedSequence);
}

void traceRayRecursive(
    Ray ray,
    Plane imgPlane,
    const std::vector<Plane>& prismPlanes,
    SellmeierCoefficients prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::mt19937& rng,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
)
{
    constexpr float EPSILON = 0.001f;
    glm::vec3 prevHit;
    bool insidePrism = false;
    std::uniform_real_distribution<float> dist01(0.0f, 1.0f);

    // Brechungsindex der Wellenlänge:
    float ior_glass = ior_sellmeier(ray.wavelength, prismSellmeierCoeffs);
    //std::cout << "\nIOR Glass: ";
    //std::cout << ior_glass;

    for (int depth = 0; depth < config.recursionDepth; depth++)
    {
        bool foundHit = false;
        float closestT = std::numeric_limits<float>::max();
        glm::vec3 closestHit{};
        Plane closestPlane{};
        bool hitImagePlane = false;

        /// 1. BILDEBENE TESTEN ///
        {
            float t;
            glm::vec3 hitPoint;

            if (intersectPlane(ray, imgPlane, t, hitPoint)) {
                if (t > EPSILON && isPointOnPlaneRect(hitPoint, imgPlane)) {
                    if (t < closestT) {
                        foundHit = true;
                        closestT = t;
                        closestHit = hitPoint;
                        closestPlane = imgPlane;
                        hitImagePlane = true;
                    }
                }
            }
        }

        /// 2. PRISMAEBENEN TESTEN ///
        for (const Plane& prismPlane : prismPlanes) {
            float t;
            glm::vec3 hitPoint;

            if (!intersectPlane(ray, prismPlane, t, hitPoint)) {
                continue;
            }

            if (t <= EPSILON) {
                continue;
            }

            if (!isPointOnPlaneRect(hitPoint, prismPlane)) {
                continue;
            }

            if (t < closestT) {
                foundHit = true;
                closestT = t;
                closestHit = hitPoint;
                closestPlane = prismPlane;
                hitImagePlane = false;
            }
        }

        /// 3. FALLS NICHTS GETROFFEN ///
        if (!foundHit) {
            return;
        }

        /// 4. FALLS BILDEBENE GETROFFEN ///
        if (hitImagePlane) {

            // 4a. Globalen Schnittpunkt in lokale 2D Ebenenkoordinaten umrechnen

            glm::vec3 local = closestHit - imgPlane.point;
            // 3D zu 2D
            float u = glm::dot(local, imgPlane.right);
            float v = glm::dot(local, imgPlane.up);

            // 4b. auf Bildkoordinaten (Pixel) umrechnen und zum int casten

            int x = static_cast<int>((u / imgPlane.width + 0.5f) * config.imageWidth);
            int y = static_cast<int>((0.5f - v / imgPlane.height) * config.imageHeight);
            // im Bild?
            if (x < 0 || x >= config.imageWidth || y < 0 || y >= config.imageHeight) {
                return;
            }

            // 4c. Intensität der Wellenlänge am Bildpixel erhöhen //

            #pragma omp atomic
            spectralImage[y * config.imageWidth + x].bins[ray.wavelengthBin] += ray.intensity;
            return;
        }

        /// 5. FALLS PRISMAEBENE GETROFFEN ///

        float n1 = 1.0f;
        float n2 = 1.0f;

        // 5a. Brechungsindizes der Medien festlegen
        if (insidePrism)
        {
            n1 = ior_glass;
            n2 = ior_air;
        }
        else
        {
            n1 = ior_air;
            n2 = ior_glass;
        }

        // 5b. Falls Strahl im Prisma: Absorption? (Beer Lambert)
        if (insidePrism && depth > 0)
        {
            float materialTransmission = computeBeerLambertTransmittance(
                prevHit,
                closestHit,
                ray.wavelength,
                prismAbsorptionCoeffs
            );

            float r = dist01(rng);
            // Absorption = Ray hört auf
            if (r >= materialTransmission) {
                return;
            }
        }

        bool reflection = false;

        // 5c. Winkel berechnen & Totalreflexion prüfen
        RefractionTerms rTerms;
        if (!computeRefractionTerms(
            ray.direction,
            closestPlane.normal,
            n1,
            n2,
            rTerms))
        {
            reflection = true;
        }

        // 5d. Reflexion oder Brechung?
        if (!reflection) {
            float transmittance = 1.0f;
            if (USE_SCHLICK_APPROXIMATION)
            {
                // Schlick-Approximation
                transmittance = computeSchlickTransmittance(rTerms.cosI, n1, n2);
            }
            else
            {
                // Fresnel-Gleichung
                transmittance = computeFresnelTransmittance(rTerms.cosI, rTerms.cosT, n1, n2);
            }

            // transmittance = Gegen-WK für Reflexion
            if (dist01(rng) >= transmittance)
            {
                reflection = true;
            }
        }

        // 5e. Neue Richtung nach Brechung / Reflexion
        glm::vec3 newDirection;
        if (reflection) {
            newDirection = reflectDirection(ray.direction, closestPlane.normal);
        } else {
            newDirection = refractDirection(rTerms);
        }

        // 5f. Ray minimal weiterschieben, damit er nicht dieselbe Fläche nochmal trifft
        ray.origin = closestHit + newDirection * EPSILON;
        ray.direction = glm::normalize(newDirection);

        // 5g. Status updaten
        prevHit = closestHit;
        if (!reflection) {
            insidePrism = !insidePrism;
        }
    }

}

// Mit AreaLight
void generateSpectralImage(
    Plane& imgPlane,
    AreaLight& light,
    SpectralPowerDistribution& lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients& prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
    )
{
#ifdef RENDERER_2D_WITH_CUDA
    std::string fallbackReason;
    if (generateSpectralImageCuda(
        imgPlane,
        light,
        lightSPD,
        prismPlanes,
        prismSellmeierCoeffs,
        prismAbsorptionCoeffs,
        spectralImage,
        config,
        &fallbackReason
    )) {
        return;
    }
    std::cerr << "CUDA renderer unavailable, using CPU fallback: " << fallbackReason << '\n';
#endif

    #pragma omp parallel
    {
        std::mt19937 rng = createThreadRng(config);
        std::uniform_real_distribution<float> dist01(0.0f, 1.0f);

        #pragma omp for
        for (int i = 0; i < config.lightSamples; i++) {
            // Radius: Wurzel, damit nicht innen mehr Samples sind
            float a = dist01(rng);
            float b = dist01(rng);

            float su = a - 0.5f;
            float sv = b - 0.5f;

            // 2D local in 3D Weltkoordinaten umrechnen
            glm::vec3 rayOrigin =
                light.center
                + light.right * (su * light.width)
                + light.up * (sv * light.height);

            // Wellenlänge aus SPD samplen
            int wavelengthBin = lightSPD.sampleWavelengthBin(rng);
            float wavelength = binToWavelength(wavelengthBin, config);

            // Lichtstrahl erzeugen
            Ray ray{
                rayOrigin,
                light.direction,
                wavelength,
                wavelengthBin,
                config.lightPower / static_cast<float>(config.lightSamples)
            };

            // Strahl senden und mit Bildebene schneiden
            traceRayRecursive(
                ray,
                imgPlane,
                prismPlanes,
                prismSellmeierCoeffs,
                prismAbsorptionCoeffs,
                rng,
                spectralImage,
                config
            );
        }
    }
}

// Mit CircleLight
void generateSpectralImage(
    Plane& imgPlane,
    CircleLight& light,
    SpectralPowerDistribution& lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients& prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
)
{
#ifdef RENDERER_2D_WITH_CUDA
    std::string fallbackReason;
    if (generateSpectralImageCuda(
        imgPlane,
        light,
        lightSPD,
        prismPlanes,
        prismSellmeierCoeffs,
        prismAbsorptionCoeffs,
        spectralImage,
        config,
        &fallbackReason
    )) {
        return;
    }
    std::cerr << "CUDA renderer unavailable, using CPU fallback: " << fallbackReason << '\n';
#endif

    #pragma omp parallel
    {
        std::mt19937 rng = createThreadRng(config);
        std::uniform_real_distribution<float> dist01(0.0f, 1.0f);

        #pragma omp for
        for (int i = 0; i < config.lightSamples; i++) {
            // Radius: Wurzel, damit nicht innen mehr Samples sind
            float a = dist01(rng);
            float radiusLocal = std::sqrt(a) * light.radius;
            // Winkel (Radians)
            float b = dist01(rng);
            float angle = 2.0f * PI * b;

            float su = radiusLocal * std::cos(angle);
            float sv = radiusLocal * std::sin(angle);

            glm::vec3 rayOrigin =
                light.center
                + light.right * su
                + light.up * sv;

            // Wellenlänge aus SPD samplen
            int wavelengthBin = lightSPD.sampleWavelengthBin(rng);
            float wavelength = binToWavelength(wavelengthBin, config);

            // Lichtstrahl erzeugen
            Ray ray{
                rayOrigin,
                light.direction,
                wavelength,
                wavelengthBin,
                config.lightPower / static_cast<float>(config.lightSamples)
            };

            // Strahl senden und mit Bildebene schneiden
            traceRayRecursive(
                ray,
                imgPlane,
                prismPlanes,
                prismSellmeierCoeffs,
                prismAbsorptionCoeffs,
                rng,
                spectralImage,
                config
            );
        }
    }
}

// Mit SpotLight
void generateSpectralImage(
    Plane imgPlane,
    SpotLight light,
    SpectralPowerDistribution lightSPD,
    std::vector<Plane>& prismPlanes,
    SellmeierCoefficients prismSellmeierCoeffs,
    std::vector<AbsorptionSample>& prismAbsorptionCoeffs,
    std::vector<Spectrum>& spectralImage,
    const RenderConfig& config
) {
    #pragma omp parallel
    {
        std::mt19937 rng = createThreadRng(config);
        std::uniform_real_distribution<float> dist01(0.0f, 1.0f);

        glm::vec3 forward = glm::normalize(light.direction);
        glm::vec3 right = glm::normalize(light.right);
        glm::vec3 up = glm::normalize(light.up);

        float cosMaxAngle = std::cos(light.coneAngleRadians);

        #pragma omp for
        for (int i = 0; i < config.lightSamples; i++) {
            // Richtungsvektor: Wurzel, damit nicht innen mehr Samples sind
            float a = dist01(rng);
            float cosTheta = 1.0f - a * (1.0f - cosMaxAngle);
            float sinTheta = std::sqrt(1.0f - cosTheta * cosTheta);
            // Kreiswinkel (Radians)
            float b = dist01(rng);
            float angle = 2.0f * PI * b;

            glm::vec3 rayDirection = glm::normalize(
                forward * cosTheta
                + right * (sinTheta * std::cos(angle))
                + up * (sinTheta * std::sin(angle))
            );

            // Wellenlänge aus SPD samplen
            int wavelengthBin = lightSPD.sampleWavelengthBin(rng);
            float wavelength = binToWavelength(wavelengthBin, config);

            Ray ray{
                light.position,
                rayDirection,
                wavelength,
                wavelengthBin,
                config.lightPower / static_cast<float>(config.lightSamples)
            };

            // Strahl senden und mit Bildebene schneiden
            traceRayRecursive(
                ray,
                imgPlane,
                prismPlanes,
                prismSellmeierCoeffs,
                prismAbsorptionCoeffs,
                rng,
                spectralImage,
                config
            );
        }
    }
}
