//
// Created by Cecilia on 09.06.2026.
//

#include <cmath>
#include "config.h"
#include "color.h"

#include <algorithm>

// Asymmetrische Gauss-Funktion (links & rechts vom Maximum unterschiedlich breit
float gaussian(float lambda, float mu, float sigma1, float sigma2) {
    // t = (λ - μ) / σ₁, falls λ < μ
    // t = (λ - μ) / σ₂, falls λ ≥ μ
    float sigma = lambda < mu ? sigma1 : sigma2;
    float t = (lambda - mu) / sigma;
    // (λ, μ, σ₁, σ₂) = exp(-0.5 · t²)g
    return std::exp(-0.5f * t * t);
}

// Analytische Approximation der CIE Color Matching Functions x̄(λ), ȳ(λ), z̄(λ)
// (rechnen Wellenlänge zu XYZ Werten um)
XYZ cie1931Approx(float lambdaNm) {
    float x =
        1.056f * gaussian(lambdaNm, 599.8f, 37.9f, 31.0f) +
        0.362f * gaussian(lambdaNm, 442.0f, 16.0f, 26.7f) -
        0.065f * gaussian(lambdaNm, 501.1f, 20.4f, 26.2f);

    float y =
        0.821f * gaussian(lambdaNm, 568.8f, 46.9f, 40.5f) +
        0.286f * gaussian(lambdaNm, 530.9f, 16.3f, 31.1f);

    float z =
        1.217f * gaussian(lambdaNm, 437.0f, 11.8f, 36.0f) +
        0.681f * gaussian(lambdaNm, 459.0f, 26.0f, 13.8f);

    return XYZ{x, y, z};
}

// Berechnet XYZ-Farbe zu gegebenem Bin-Spektrum
XYZ spectrumToXYZ(const Spectrum& spectrum, const RenderConfig& config) {
    XYZ result{0.0f, 0.0f, 0.0f};

    // Breite der Bins
    float deltaLambda =
        (config.lambdaMax - config.lambdaMin) / static_cast<float>(config.spectrumBins - 1);

    // "Integrieren" (gewichtetes Aufsummieren) der Spektralwerte
    // X = Σ S(λᵢ) · x̄(λᵢ)
    // Y = Σ S(λᵢ) · ȳ(λᵢ)
    // Z = Σ S(λᵢ) · z̄(λᵢ)
    for (int i = 0; i < config.spectrumBins; i++) {
        // aktuelle Wellenlänge
        float lambdaUm = config.lambdaMin + i * deltaLambda;  // λ in Mikrometern
        float lambdaNm = lambdaUm * 1000.0f;            // λ in Nanometern

        // Color Matching Function: x̄(λᵢ), ȳ(λᵢ), z̄(λᵢ)
        XYZ cmf = cie1931Approx(lambdaNm);

        // Spektralwert: S(λᵢ), S(λᵢ), S(λᵢ)
        float power = spectrum.bins[i];

        // Summen Σ
        result.x += power * cmf.x;
        result.y += power * cmf.y;
        result.z += power * cmf.z;
    }

    return result;
}

// XYZ → linares sRGB
// (Linear bedeutet: doppelter Wert heißt doppelte Lichtenergie)
RGB xyzToLinearSRGB(const XYZ& xyz) {
    float r =  3.2406f * xyz.x - 1.5372f * xyz.y - 0.4986f * xyz.z;
    float g = -0.9689f * xyz.x + 1.8758f * xyz.y + 0.0415f * xyz.z;
    float b =  0.0557f * xyz.x - 0.2040f * xyz.y + 1.0570f * xyz.z;

    return RGB{r, g, b};
}

// Gamma-Korrektur: lineares sRGB → gammakorrigiertes sRGB
// (Displays und Bildformate speichern Helligkeit nicht linear, weil Menschen in dunkleren Bereichen besser sehen)

// einzelner Kanal
float linearToSRGB(float c) {
    c = std::clamp(c, 0.0f, 1.0f);

    if (c <= 0.0031308f) {
        return 12.92f * c;
    }

    return 1.055f * std::pow(c, 1.0f / 2.4f) - 0.055f;
}
// alle 3 RGB Kanäle
RGB linearToSRGB(RGB c) {
    return RGB{
        linearToSRGB(c.r),
        linearToSRGB(c.g),
        linearToSRGB(c.b)
    };
}
