#!/usr/bin/env bash

set -eu

# Immer relativ zum Verzeichnis dieses Skripts arbeiten, damit ein Aufruf aus
# einem anderen Verzeichnis keine gleichnamigen Dateien an anderer Stelle löscht.
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd -- "$PROJECT_DIR"

printf 'Entferne Build-Artefakte ...\n'
rm -rf -- build cmake-build-debug cmake-build-release

printf 'Entferne Renderer-Ausgaben ...\n'
rm -f -- \
    wall_output.ppm \
    lens_input_output.ppm \
    lens_output.ppm \
    sensor_linear_output.ppm \
    sensor_output.ppm \
    wall_amplitude.ppm \
    wall_phase.ppm \
    lens_input_amplitude.ppm \
    lens_input_phase.ppm \
    lens_output_amplitude.ppm \
    lens_output_phase.ppm \
    sensor_amplitude.ppm \
    sensor_phase.ppm

printf 'Entferne Benchmark-Ausgaben ...\n'
rm -f -- \
    benchmark_results.csv \
    benchmark_results_image_corr.svg \
    benchmark_results_image_rmse.svg \
    benchmark_results_image_rmse_gain_matched.svg

printf 'Bereinigung abgeschlossen.\n'
