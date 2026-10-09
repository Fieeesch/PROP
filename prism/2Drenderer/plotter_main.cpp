//
// Created by Cecilia on 09.06.2026.
//

#include <exception>
#include <iostream>
#include <string>
#include "config.h"
#include "spectrum_plotter.h"

int main(int argc, char* argv[]) {
    try {
        if (argc >= 3) {
            saveSpdPlotFromCsv(argv[1], argv[2]);
        } else {
            plotSpdFromCsv(argc >= 2 ? argv[1] : SPD_FILENAME);
        }
    } catch (const std::exception& e) {
        std::cerr << "Fehler: " << e.what() << '\n';
        return 1;
    }

    return 0;
}
