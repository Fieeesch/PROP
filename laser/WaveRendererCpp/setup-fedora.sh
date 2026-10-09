#!/usr/bin/env bash

set -Eeuo pipefail

readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BUILD_DIR="${PROJECT_DIR}/build"

log() {
    printf '\n==> %s\n' "$*"
}

if ! command -v dnf >/dev/null 2>&1; then
    printf 'Fehler: dnf wurde nicht gefunden. Dieses Skript ist für Fedora gedacht.\n' >&2
    exit 1
fi

log "Installiere Build-Abhängigkeiten"
sudo dnf install -y \
    gcc-c++ \
    cmake \
    ninja-build \
    glm-devel \
    fftw-devel \
    libgomp \
    pkgconf-pkg-config

log "Konfiguriere Release-Build"
cmake \
    -S "${PROJECT_DIR}" \
    -B "${BUILD_DIR}" \
    -G Ninja \
    -DCMAKE_BUILD_TYPE=Release

log "Baue WaveRendererCpp und WaveRendererBenchmark"
cmake --build "${BUILD_DIR}" --parallel

printf '\nFertig. Targets ausführen mit:\n'
printf '  %q\n' "${BUILD_DIR}/WaveRendererCpp"
printf '  %q\n' "${BUILD_DIR}/WaveRendererBenchmark"
