//
// Created by Cecilia on 09.06.2026.
//

#include <matplot/matplot.h>

#include <algorithm>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "spectrum_plotter.h"

std::vector<std::string> splitCsvLine(const std::string& line) {
    std::vector<std::string> result;
    std::stringstream ss(line);
    std::string cell;

    while (std::getline(ss, cell, ',')) {
        result.push_back(cell);
    }

    return result;
}

double parseDouble(const std::string& text) {
    try {
        return std::stod(text);
    } catch (...) {
        throw std::runtime_error("Konnte Zahl nicht parsen: " + text);
    }
}

SpdData readSpdFromCsv(const std::string& path) {
    std::ifstream file(path);

    if (!file.is_open()) {
        throw std::runtime_error("CSV konnte nicht geöffnet werden: " + path);
    }

    std::string firstLine;
    if (!std::getline(file, firstLine)) {
        throw std::runtime_error("CSV ist leer.");
    }

    SpdData data;
    data.spdName = path;

    auto appendDataRow = [&data](const std::string& row, std::size_t lineNumber) {
        if (row.empty()) {
            return;
        }

        std::string normalizedRow = row;
        std::replace(normalizedRow.begin(), normalizedRow.end(), ';', ',');
        auto cells = splitCsvLine(normalizedRow);

        if (cells.size() < 2) {
            throw std::runtime_error(
                "Zeile "
                + std::to_string(lineNumber)
                + " hat nicht genug Spalten."
            );
        }

        data.wavelengths.push_back(parseDouble(cells[0]));
        data.values.push_back(parseDouble(cells[1]));
    };

    std::size_t lineNumber = 1;
    try {
        appendDataRow(firstLine, lineNumber);
    } catch (...) {
        std::string normalizedHeader = firstLine;
        std::replace(normalizedHeader.begin(), normalizedHeader.end(), ';', ',');
        auto headers = splitCsvLine(normalizedHeader);
        if (headers.size() >= 2) {
            data.spdName = headers[1];
        }
    }

    std::string line;
    while (std::getline(file, line)) {
        ++lineNumber;
        appendDataRow(line, lineNumber);
    }

    if (data.wavelengths.empty()) {
        throw std::runtime_error("No data rows found.");
    }

    return data;
}

static matplot::figure_handle drawSpdPlot(
    const SpdData& data,
    bool quietMode,
    const std::string& outputPath = ""
) {
    using namespace matplot;

    auto fig = figure(quietMode);
    if (!outputPath.empty()) {
        fig->backend()->output(outputPath);
    }
    figure(fig);
    plot(data.wavelengths, data.values)->line_width(1.5);
    title("Spectral Power Distribution: " + data.spdName);
    xlabel("Wavelength [nm]");
    ylabel("Relative intensity");
    ytickformat("");
    grid(on);

    return fig;
}

void plotSpdFromCsv(const std::string& path) {
    SpdData data = readSpdFromCsv(path);

    auto fig = drawSpdPlot(data, false);
    matplot::show(fig);
}

void saveSpdPlotFromCsv(const std::string& path, const std::string& outputPath) {
    SpdData data = readSpdFromCsv(path);

    auto fig = drawSpdPlot(data, true, outputPath);
    fig->draw();
}
