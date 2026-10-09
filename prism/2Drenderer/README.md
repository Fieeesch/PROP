# 2D Spectral Light Tracer

Der 2D Spectral Light Tracer simuliert spektrale Dispersion an einer
konfigurierbaren Prisma-Szene und erzeugt PPM-Bilder. Das Verzeichnis enthält:

- `renderer_2d`: eigentlicher Renderer
- `spd_plotter`: Visualisierung von Spectral-Power-Distribution-Dateien
- `server/server.js`: HTTP-Backend für das gemeinsame Frontend

Für Area- und Circle-Lights wird CUDA verwendet, wenn CMake einen
CUDA-Compiler findet. Ohne CUDA wird automatisch der OpenMP-CPU-Pfad gebaut.
Der Spot-Light-Codepfad ist CPU-basiert.

## Voraussetzungen

- CMake 3.20 oder neuer
- C++20-Compiler
- Ninja oder ein anderer von CMake unterstützter Generator
- OpenMP
- GLM
- Matplot++ für den SPD-Plotter
- Node.js für das optionale HTTP-Backend
- optional: NVIDIA-Treiber und CUDA Toolkit

Die Abhängigkeiten sind außerdem im vcpkg-Manifest `vcpkg.json` hinterlegt.

## Build

### Abhängigkeiten mit vcpkg

Windows:

```powershell
C:/vcpkg/vcpkg install glm:x64-windows matplotplusplus:x64-windows
```

Linux:

```bash
./vcpkg install glm matplotplusplus
```

### Konfigurieren und bauen

Aus `prism/2Drenderer`:

Windows:

```powershell
cmake -S . -B cmake-build-release -G Ninja `
  -DCMAKE_BUILD_TYPE=Release `
  -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build cmake-build-release
```

Linux mit vcpkg:

```bash
cmake -S . -B cmake-build-release -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build cmake-build-release
```

Bei systemweit installierten Abhängigkeiten entfällt
`CMAKE_TOOLCHAIN_FILE`:

```bash
cmake -S . -B cmake-build-release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build cmake-build-release
```

Nur der Renderer ohne optionalen SPD-Plotter:

```bash
cmake -S . -B cmake-build-release -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SPD_PLOTTER=OFF
cmake --build cmake-build-release --target renderer_2d
```

Wenn CUDA gefunden wird, bindet CMake den CUDA-Raytracer und `cudart` ein.
Andernfalls erscheint eine Warnung und der CPU-Renderer wird gebaut.

## Renderer ausführen

Der Renderer akzeptiert optional eine Szenendatei und einen Ausgabepfad:

```text
renderer_2d [scene-file] [output-file]
```

Linux:

```bash
./cmake-build-release/renderer_2d
./cmake-build-release/renderer_2d path/to/scene.txt results/output.ppm
```

Windows:

```powershell
./cmake-build-release/renderer_2d.exe
./cmake-build-release/renderer_2d.exe path/to/scene.txt results/output.ppm
```

Ohne Parameter werden die Defaults aus `main.cpp` und `config.h` verwendet.
Die Standardausgabe liegt unter `results/output.ppm`.

## SPD-Plotter

```text
spd_plotter [spd-csv-file] [output-image]
```

- ohne Parameter: Default-SPD interaktiv anzeigen
- mit CSV-Datei: angegebene SPD interaktiv anzeigen
- mit CSV-Datei und Ausgabepfad: Plot als Bild speichern

Linux:

```bash
./cmake-build-release/spd_plotter \
  data/illuminants/CIE_std_illum_D65.csv \
  results/d65.png
```

Windows:

```powershell
./cmake-build-release/spd_plotter.exe `
  data/illuminants/CIE_std_illum_D65.csv `
  results/d65.png
```

## Backend starten

Nach erfolgreichem Build:

```bash
node server/server.js
```

Das Backend lauscht standardmäßig auf
<http://127.0.0.1:8080/render>. Konfigurierbare Umgebungsvariablen:

- `HOST`: Bind-Adresse, Standard `127.0.0.1`
- `PORT`: Port, Standard `8080`
- `RENDERER_EXE`: Pfad zu `renderer_2d`
- `SPD_PLOTTER_EXE`: Pfad zu `spd_plotter`
- `SPD_PLOT_TIMEOUT_MS`: Zeitlimit für SPD-Plots

Der projektweite Start über `start_all.sh` beziehungsweise `start_all.cmd` ist
in der [Root-README](../../README.md#gesamten-web-stack-bauen-und-starten)
beschrieben.
