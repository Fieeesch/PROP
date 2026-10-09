#!/usr/bin/env bash

set -Eeuo pipefail

readonly CONTAINER_NAME="${WAVE_CONTAINER_NAME:-hsrm-ss26-avc-propeller}"
readonly CONTAINER_IMAGE="${WAVE_CONTAINER_IMAGE:-fedora:44}"
readonly PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_PATH="${PROJECT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"

log() {
    printf '\n==> %s\n' "$*"
}

setup_inside_container() {
    log "Installiere Build-Abhängigkeiten in ${CONTAINER_NAME}"
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
        -B "${PROJECT_DIR}/build" \
        -G Ninja \
        -DCMAKE_BUILD_TYPE=Release

    log "Baue WaveRendererCpp und WaveRendererBenchmark"
    cmake --build "${PROJECT_DIR}/build" --parallel

    printf '\nFertig. Targets ausführen mit:\n'
    printf '  distrobox enter %q -- %q\n' \
        "${CONTAINER_NAME}" "${PROJECT_DIR}/build/WaveRendererCpp"
    printf '  distrobox enter %q -- %q\n' \
        "${CONTAINER_NAME}" "${PROJECT_DIR}/build/WaveRendererBenchmark"
}

if [[ "${1:-}" == "--inside-container" || -f /run/.containerenv ]]; then
    setup_inside_container
    exit 0
fi

if ! command -v distrobox >/dev/null 2>&1; then
    printf 'Fehler: distrobox wurde nicht gefunden. Dieses Skript ist für Bazzite DX gedacht.\n' >&2
    exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
    printf 'Fehler: podman wurde nicht gefunden.\n' >&2
    exit 1
fi

if ! podman container exists "${CONTAINER_NAME}"; then
    log "Erstelle Distrobox ${CONTAINER_NAME} aus ${CONTAINER_IMAGE}"
    distrobox create \
        --name "${CONTAINER_NAME}" \
        --image "${CONTAINER_IMAGE}" \
        --yes
else
    log "Verwende vorhandene Distrobox ${CONTAINER_NAME}"
fi

log "Richte Projekt in der Distrobox ein"
distrobox enter "${CONTAINER_NAME}" -- \
    "${SCRIPT_PATH}" --inside-container
