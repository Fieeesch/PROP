//
// Created by Cecilia on 09.06.2026.
//

#include <fstream>
#include <sstream>
#include <vector>
#include <algorithm>
#include <stdexcept>

#include "spectrum.h"
#include "color.h"

// select matching spectral bin for wavelength
int wavelengthToBin(float lambda, const RenderConfig& config) {
    // Wellenlänge auf [0,1] skalieren -> 0 = min_WL, 1 = max_WL
    float t = (lambda - config.lambdaMin) / (config.lambdaMax - config.lambdaMin);
    // Bin-Index rausfinden
    int bin = static_cast<int>(t * static_cast<float>(config.spectrumBins));

    if (bin < 0) {
        return 0;
    }

    if (bin >= config.spectrumBins) {
        return config.spectrumBins - 1;
    }

    return bin;
}

// Bin-Index zu Wellenlänge
float binToWavelength(int bin, const RenderConfig& config) {
    float t = static_cast<float>(bin) / static_cast<float>(config.spectrumBins - 1);
    return config.lambdaMin + t * (config.lambdaMax - config.lambdaMin);
}

// Spectral Power Distribution Bins -> Kummulative Power Distribution
void SpectralPowerDistribution::buildCDF() {
    float sum = 0.0f;

    // Summe der Power-Werte aller Bins
    for (float value : power) {
        sum += std::max(value, 0.0f);
    }

    if (sum <= 0.0f) {
        throw std::runtime_error("SPD contains no positive power values.");
    }

    // CDF füllen
    float accum = 0.0f;
    for (size_t i = 0; i < power.size(); i++) {
        accum += std::max(power[i], 0.0f) / sum;
        cdf[i] = accum;
    }
    cdf.back() = 1.0f;
}

// Sampled eine Wellenlänge aus der SPD
int SpectralPowerDistribution::sampleWavelengthBin(std::mt19937& rng) const {
    // Zahl zwischen 1 und 0
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);
    float r = dist(rng);

    // welcher Bin gehört zu der Zufallszahl?
    // Suche in Kummulativer Power Distribution nach dem ersten Element, das >= r ist
    auto it = std::lower_bound(cdf.begin(), cdf.end(), r);
    int bin = static_cast<int>(std::distance(cdf.begin(), it));

    if (bin >= static_cast<int>(cdf.size())) {
        bin = static_cast<int>(cdf.size()) - 1;
    }

    // Gesampelter Bin zu Wellenlänge
    return bin;
}

// SPD aus gegebener CSV-Datei lesen
SpectralPowerDistribution loadSPDFromCSV(
    const std::string& filename,
    const RenderConfig& config
) {
    // SPD CSV Datei lesen:
    std::ifstream file(filename);

    if (!file) {
        throw std::runtime_error("Could not open SPD CSV file: " + filename);
    }

    // Wellenlänge-Power Paare werden als zwei Vektoren gespeichert
    std::vector<float> wavelengthsNm;
    std::vector<float> powers;

    std::string line;

    while (std::getline(file, line)) {
        if (line.empty()) {
            continue;
        }

        std::replace(line.begin(), line.end(), ';', ',');

        std::stringstream ss(line);
        std::vector<std::string> columns;
        std::string cell;

        while (std::getline(ss, cell, ',')) {
            columns.push_back(cell);
        }

        if (columns.size() < 2) {
            continue;
        }

        try {
            float lambdaNm = std::stof(columns[0]);
            float power = std::stof(columns[1]);

            wavelengthsNm.push_back(lambdaNm);
            powers.push_back(power);
        } catch (...) {
            // Header-Zeilen oder nicht-numerische Zeilen ignorieren
            continue;
        }
    }

    if (wavelengthsNm.size() < 2) {
        throw std::runtime_error("SPD CSV has too few valid rows.");
    }

    // SPD initialisieren
    SpectralPowerDistribution spd;
    spd.power.resize(config.spectrumBins);
    spd.cdf.resize(config.spectrumBins);

    // für jeden Bin die passende Wellenlänge aus den gelesenen Vektoren auswählen
    for (int bin = 0; bin < config.spectrumBins; bin++) {
        // Wellelänge des Bins holen
        float lambdaUm = binToWavelength(bin, config);
        float lambdaNm = lambdaUm * 1000.0f;

        // Falls WL des Bins <= kleinste WL der SPD: die kleinste nehmen
        if (lambdaNm <= wavelengthsNm.front()) {
            spd.power[bin] = powers.front();
            continue;
        }

        // Falls WL des Bins >= größte WL der SPD: die größte nehmen
        if (lambdaNm >= wavelengthsNm.back()) {
            spd.power[bin] = powers.back();
            continue;
        }

        // Lineare Interpolation der Power zwischen den beiden Benachbarten WL
        for (int i = 0; i < static_cast<int>(wavelengthsNm.size()) - 1; i++) {
            float l0 = wavelengthsNm[i];
            float l1 = wavelengthsNm[i + 1];

            if (lambdaNm >= l0 && lambdaNm <= l1) {
                float p0 = powers[i];
                float p1 = powers[i + 1];

                float t = (lambdaNm - l0) / (l1 - l0);
                spd.power[bin] = p0 * (1.0f - t) + p1 * t;
                break;
            }
        }
    }

    spd.buildCDF();
    return spd;
}
