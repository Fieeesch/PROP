#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_TYPE="Release"
SKIP_CLIENT=0
SKIP_2D=0
SKIP_CUDA=0
START_AFTER_BUILD=0
INSTALL_CLIENT="auto"

usage() {
  cat <<'EOF'
Usage: ./build_all.sh [options]

Options:
  --skip-client        Do not build the Vue/Vite client
  --skip-2d            Do not build prism/2Drenderer
  --skip-cuda          Do not build prism/CUDA-Spectral-Pathtracer
  --no-client-install  Do not run npm ci/install when node_modules is missing
  --debug              Build native CMake targets as Debug instead of Release
  --start              Run start_all.sh after a successful build
  --help               Show this help

Environment overrides:
  VCPKG_ROOT           Path to a normal vcpkg checkout
  VCPKG_TOOLCHAIN      Path to vcpkg.cmake
  NINJA_EXE            Path to ninja
  CXX                  C++ compiler for CMake, e.g. clang++ or g++
  CC                   C compiler for CMake, e.g. clang or gcc
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-client) SKIP_CLIENT=1 ;;
    --skip-2d) SKIP_2D=1 ;;
    --skip-cuda) SKIP_CUDA=1 ;;
    --no-client-install) INSTALL_CLIENT="never" ;;
    --debug) BUILD_TYPE="Debug" ;;
    --start) START_AFTER_BUILD=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[build] Unknown argument: $1"; echo "[build] Use --help for usage."; exit 2 ;;
  esac
  shift
done

find_toolchain() {
  if [[ -n "${VCPKG_TOOLCHAIN:-}" && -f "$VCPKG_TOOLCHAIN" ]]; then
    return 0
  fi

  if [[ -n "${VCPKG_ROOT:-}" && -f "$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" ]]; then
    VCPKG_TOOLCHAIN="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
    export VCPKG_TOOLCHAIN
    return 0
  fi

  if command -v vcpkg >/dev/null 2>&1; then
    local vcpkg_bin
    vcpkg_bin="$(command -v vcpkg)"
    local candidate
    candidate="$(cd "$(dirname "$vcpkg_bin")" && pwd)/scripts/buildsystems/vcpkg.cmake"
    if [[ -f "$candidate" ]]; then
      VCPKG_TOOLCHAIN="$candidate"
      export VCPKG_TOOLCHAIN
      return 0
    fi
  fi

  echo "[build] Could not find vcpkg.cmake."
  echo "[build] Install vcpkg and set VCPKG_ROOT or VCPKG_TOOLCHAIN."
  return 1
}

find_ninja() {
  if [[ -n "${NINJA_EXE:-}" && -x "$NINJA_EXE" ]]; then
    return 0
  fi
  if command -v ninja >/dev/null 2>&1; then
    NINJA_EXE="$(command -v ninja)"
    export NINJA_EXE
    return 0
  fi
  echo "[build] Could not find ninja."
  echo "[build] Install Ninja or set NINJA_EXE."
  return 1
}

prepare_cmake_build_dir() {
  local build_dir="$1"
  if [[ ! -f "$build_dir/CMakeCache.txt" ]]; then
    return 0
  fi
  if ! grep -q "CMAKE_TOOLCHAIN_FILE:FILEPATH=" "$build_dir/CMakeCache.txt"; then
    echo "[build] Existing CMake cache in $build_dir was not configured with the vcpkg toolchain."
    echo "[build] Recreating generated build directory $build_dir."
    rm -rf "$build_dir"
  fi
}

cmake_common_args() {
  local args=(
    -G Ninja
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
    -DCMAKE_MAKE_PROGRAM="$NINJA_EXE"
    -DCMAKE_TOOLCHAIN_FILE="$VCPKG_TOOLCHAIN"
  )
  if [[ -n "${CC:-}" ]]; then
    args+=("-DCMAKE_C_COMPILER=$CC")
  fi
  if [[ -n "${CXX:-}" ]]; then
    args+=("-DCMAKE_CXX_COMPILER=$CXX")
  fi
  printf '%s\n' "${args[@]}"
}

build_client() {
  echo
  echo "[build] Building client..."
  cd "$ROOT/Client"
  if [[ ! -d node_modules ]]; then
    if [[ "$INSTALL_CLIENT" == "never" ]]; then
      echo "[build] Client node_modules is missing. Run npm ci or remove --no-client-install."
      return 1
    fi
    if [[ -f package-lock.json ]]; then
      npm ci
    else
      npm install
    fi
  fi
  npm run build
}

build_2d() {
  echo
  echo "[build] Building 2D renderer..."
  cd "$ROOT/prism/2Drenderer"
  prepare_cmake_build_dir "cmake-build-release"
  mapfile -t common_args < <(cmake_common_args)
  cmake -S . -B cmake-build-release "${common_args[@]}"
  cmake --build cmake-build-release --config "$BUILD_TYPE"
}

build_cuda() {
  echo
  echo "[build] Building CUDA spectral pathtracer..."
  cd "$ROOT/prism/CUDA-Spectral-Pathtracer"
  prepare_cmake_build_dir "build"
  mapfile -t common_args < <(cmake_common_args)
  cmake -S . -B build "${common_args[@]}" -DBUILD_TESTING=OFF
  cmake --build build --config "$BUILD_TYPE"
}

find_toolchain
find_ninja

echo "[build] Root: $ROOT"
echo "[build] Build type: $BUILD_TYPE"
echo "[build] Ninja: $NINJA_EXE"
echo "[build] vcpkg toolchain: $VCPKG_TOOLCHAIN"

if [[ "$SKIP_CLIENT" == "0" ]]; then build_client; fi
if [[ "$SKIP_2D" == "0" ]]; then build_2d; fi
if [[ "$SKIP_CUDA" == "0" ]]; then build_cuda; fi

echo
echo "[build] All requested targets built successfully."

if [[ "$START_AFTER_BUILD" == "1" ]]; then
  echo "[build] Starting project stack..."
  exec "$ROOT/start_all.sh"
fi
