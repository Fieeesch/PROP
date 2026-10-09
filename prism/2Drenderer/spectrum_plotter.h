//
// Created by Cecilia on 09.06.2026.
//

#ifndef RENDERER_2D_SPECTRUM_PLOTTER_H
#define RENDERER_2D_SPECTRUM_PLOTTER_H

#include <string>
#include <vector>

struct SpdData {
    std::string spdName;
    std::vector<double> wavelengths;
    std::vector<double> values;
};

std::vector<std::string> splitCsvLine(const std::string& line);

double parseDouble(const std::string& text);

SpdData readSpdFromCsv(const std::string& path);

void plotSpdFromCsv(const std::string& path);

void saveSpdPlotFromCsv(const std::string& path, const std::string& outputPath);

#endif //RENDERER_2D_SPECTRUM_PLOTTER_H
