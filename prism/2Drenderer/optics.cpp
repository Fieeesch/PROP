//
// Created by Cecilia on 02.06.2026.
//

#include "optics.h"

#include <glm/glm.hpp>
#include <cmath>
#include <algorithm>
#include <fstream>
#include <stdexcept>
#include <sstream>
#include <string>
#include <vector>

// nach Snellius-Gesetz
bool computeRefractionTerms(
    const glm::vec3& incident,
    const glm::vec3& normal,
    float n1,
    float n2,
    RefractionTerms& terms
) {
    // Snellius Brechungsgesetz:
    // n1 * sin(theta_i) = n2 * sin(theta_t)
    // mit  theta_i = Einfallswinkel
    //      theta_t = Brechungswinkel

    // umgestellt:
    // sin(theta_t) = (n1/n2) * sin(theta_i)
    //                  ↑
    //                 eta

    // Einfallsvektor und Normalenvektor normalisieren
    terms.I = glm::normalize(incident);
    terms.N = glm::normalize(normal);

    terms.eta = n1 / n2;

    // cos(theta_i) = -dot(N, I)        → minus, weil I zum Material zeigt und N davon weg
    terms.cosI = std::clamp(-glm::dot(terms.N, terms.I), -1.0f, 1.0f);
    if (terms.cosI < 0.0f) {
        terms.N = -terms.N;
        terms.cosI = -terms.cosI;
    }

    // sin(theta_i) = eta * sin(theta_t)          // sin²(theta_i) + cos²(theta_i) = 1
    //              ↓                             //               ↓
    // sin²(theta_t) = eta² · sin²(theta_i)       // sin²(theta_i) = 1 - cos²(theta_i)
    //              ↓                           ↙
    // sin²(theta_t) = eta² · 1 - cos²(theta_i)
    terms.sinT2 = terms.eta * terms.eta * (1.0f - terms.cosI * terms.cosI);

    // Totalreflexion prüfen
    if (terms.sinT2 > 1.0f) {
        return false;
    }

    // sin²(theta_t) + cos²(theta_t) = 1
    //              ↓
    // cos(theta_t) = sqrt(1 - sin²(theta_t))
    terms.cosT = std::sqrt(std::max(0.0f, 1.0f - terms.sinT2));

    // Keine Totalreflexion
    return true;
}

// Sellmeier-Gleichung für wellenlängenabhängigen Brechungsindex
// n²(λ) = 1 + B₁λ²/(λ² - C₁) + B₂λ²/(λ² - C₂) + B₃λ²/(λ² - C₃)
float ior_sellmeier(float lambda, SellmeierCoefficients coeffs) {
    float l2 = lambda * lambda;

    float n2 = 1.0f
        + coeffs.b1 * l2 / (l2 - coeffs.c1)
        + coeffs.b2 * l2 / (l2 - coeffs.c2)
        + coeffs.b3 * l2 / (l2 - coeffs.c3);

    return std::sqrt(n2);
}

// Richtung nach Brechung
glm::vec3 refractDirection(RefractionTerms& terms) {
    glm::vec3 refracted = terms.eta * terms.I + (terms.eta * terms.cosI - terms.cosT) * terms.N;
    return glm::normalize(refracted);
}

// Reflexion (Schlick-Approximation)
float computeSchlickTransmittance(
    float cosI,
    float n1,
    float n2
) {
    // Minimaler Reflexionsanteil (senkrechter Einfall)
    float raw = (n1 - n2) / (n1 + n2);
    float R_0 = raw * raw;

    // Reflexionsanteil (Schlick-Approximation)
    float R = R_0 + (1.0f - R_0) * std::pow(1.0f - cosI, 5.0f);

    // Transmittierter Anteil
    float T = 1.0f - R;
    return glm::clamp(T, 0.0f, 1.0f);
}

// Reflexion (Fresnel-Gleichung)
float computeFresnelTransmittance(
    float cosI,
    float cosT,
    float n1,                   // Brechungsindex erstes Medium
    float n2                    // Brechungsindex zweites Medium
) {
    // R_s = |(n₁ cos(θᵢ) - n₂ cos(θₜ)) / (n₁ cos(θᵢ) + n₂ cos(θₜ))|²
    float rsNumerator   = n1 * cosI - n2 * cosT;
    float rsDenominator = n1 * cosI + n2 * cosT;
    float Rs = (rsNumerator / rsDenominator) * (rsNumerator / rsDenominator);

    // R_p = |(n₁ cos(θₜ) - n₂ cos(θᵢ)) / (n₁ cos(θₜ) + n₂ cos(θᵢ))|²
    float rpNumerator   = n1 * cosT - n2 * cosI;
    float rpDenominator = n1 * cosT + n2 * cosI;
    float Rp = (rpNumerator / rpDenominator) * (rpNumerator / rpDenominator);

    // R = 1/2 · (R_s + R_p)
    float R = 0.5f * (Rs + Rp);

    // Transmittierter Teil
    float T = 1.0f - R;
    return glm::clamp(T, 0.0f, 1.0f);
}

// Richtung nach Reflexion
glm::vec3 reflectDirection(
    const glm::vec3& incident,
    const glm::vec3& normal
) {
    glm::vec3 I = glm::normalize(incident);
    glm::vec3 N = glm::normalize(normal);

    return glm::normalize(I - 2.0f * glm::dot(I, N) * N);
}

std::vector<AbsorptionSample> readAbsorptionCsv(const std::string& filename)
{
    std::ifstream file(filename);

    if (!file.is_open()) {
        throw std::runtime_error("Could not open absorption CSV: " + filename);
    }

    std::vector<AbsorptionSample> samples;

    std::string line;
    std::getline(file, line); // Header überspringen

    while (std::getline(file, line)) {
        if (line.empty()) {
            continue;
        }

        std::stringstream ss(line);
        std::string wavelengthStr;
        std::string tauStr;
        std::string sigmaStr;

        std::getline(ss, wavelengthStr, ',');
        std::getline(ss, tauStr, ',');
        std::getline(ss, sigmaStr, ',');

        if (wavelengthStr.empty() || sigmaStr.empty()) {
            continue;
        }

        samples.push_back({
            std::stof(wavelengthStr),
            std::stof(sigmaStr)
        });
    }

    std::sort(samples.begin(), samples.end(),
        [](const AbsorptionSample& a, const AbsorptionSample& b) {
            return a.wavelengthNm < b.wavelengthNm;
        });

    return samples;
}

SellmeierCoefficients readSellmeierCsv(const std::string& filename)
{
    std::ifstream file(filename);

    if (!file.is_open()) {
        throw std::runtime_error("Could not open Sellmeier CSV: " + filename);
    }

    // alles mit 1 initialisieren
    SellmeierCoefficients coeffs{
        1.0f, 1.0f, 1.0f,
        1.0f, 1.0f, 1.0f
    };

    std::string line;
    while (std::getline(file, line)) {
        std::stringstream ss(line);
        std::string key;
        std::string value;

        std::getline(ss, key, ',');
        std::getline(ss, value, ',');

        if (!value.empty() && value.back() == 'f') {
            value.pop_back();
        }

        const float parsed = std::stof(value);

        if (key == "b1") coeffs.b1 = parsed;
        else if (key == "b2") coeffs.b2 = parsed;
        else if (key == "b3") coeffs.b3 = parsed;
        else if (key == "c1") coeffs.c1 = parsed;
        else if (key == "c2") coeffs.c2 = parsed;
        else if (key == "c3") coeffs.c3 = parsed;
    }

    return coeffs;
}

float interpolateSigmaA(
    const std::vector<AbsorptionSample>& samples,
    float wavelengthNm
)
{
    if (samples.empty()) {
        throw std::runtime_error("Absorption table is empty");
    }

    if (wavelengthNm <= samples.front().wavelengthNm) {
        return samples.front().sigmaA_cm_inv;
    }

    if (wavelengthNm >= samples.back().wavelengthNm) {
        return samples.back().sigmaA_cm_inv;
    }

    for (size_t i = 0; i + 1 < samples.size(); ++i) {
        const auto& a = samples[i];
        const auto& b = samples[i + 1];

        if (wavelengthNm >= a.wavelengthNm && wavelengthNm <= b.wavelengthNm) {
            float t = (wavelengthNm - a.wavelengthNm)
                    / (b.wavelengthNm - a.wavelengthNm);

            return a.sigmaA_cm_inv
                 + t * (b.sigmaA_cm_inv - a.sigmaA_cm_inv);
        }
    }

    return samples.back().sigmaA_cm_inv;
}

// Transmission im Prisma-Material
float computeBeerLambertTransmittance(
    glm::vec3 entryPoint,
    glm::vec3 exitPoint,
    float wavelength,
    const std::vector<AbsorptionSample>& samples
)
{
    // σₐ(λ) aus eingelesenen CSV-Werten interpolieren
    const float wavelengthNm = wavelength * 1000.0f;
    const float sigmaA = interpolateSigmaA(samples, wavelengthNm);

    // d = Abstand zw. Eintritts- und Austrittspunkt (in cm)
    const float distance = glm::length(exitPoint - entryPoint);

    // T(λ) = exp(-σₐ(λ) · d)
    return std::exp(-sigmaA * distance);
}
