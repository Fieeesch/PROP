# Build-Anleitung

Dieses Projekt nutzt fuer JavaScript `package.json` und fuer die C++-Dependencies vcpkg-Manifeste (`vcpkg.json`).

## Inhaltsverzeichnis

- [Support-Status](#support-status)
- [Voraussetzungen](#voraussetzungen)
- [Windows-Setup](#windows-setup)
- [Ubuntu-/Linux-Setup](#ubuntu-linux-setup)
- [CUDA unter Ubuntu/Linux](#cuda-unter-ubuntulinux)
- [Schnellstart unter Windows](#schnellstart-unter-windows)
- [Schnellstart unter Linux](#schnellstart-unter-linux)
- [Build-Details](#build-details)
- [Optionen](#optionen)

## Support-Status

Windows und Linux sind fuer diesen Projektstand unterstuetzte Build-Pfade. Die Windows-Skripte (`build_all.cmd`, `start_all.cmd`) und die Linux-Skripte (`build_all.sh`, `start_all.sh`) sind fuer diese Version validiert.

Der Linux-Build wurde unter WSL 2 mit Ubuntu validiert. Unter Linux muessen vcpkg, CMake, Ninja, ein C++-Compiler und fuer den CUDA-Renderer eine passende NVIDIA/CUDA-Installation vorhanden sein.

## Voraussetzungen

- Node.js mit `npm.cmd` auf Windows bzw. `npm` auf Linux
- CMake
- Ninja
- vcpkg mit Ports-Registry
- Visual Studio C++ Build Tools auf Windows bzw. GCC/Clang auf Linux
- CUDA Toolkit fuer den CUDA-Renderer
- `pkg-config` unter Linux

Die C++-Dependencies sind in Manifesten festgehalten:

- `prism\2Drenderer\vcpkg.json`: `glm`, `matplotplusplus`
- `prism\CUDA-Spectral-Pathtracer\vcpkg.json`: `nlohmann-json`

## Windows-Setup

Installiere fuer den Windows-Build:

- Node.js
- CMake
- Ninja
- Visual Studio C++ Build Tools
- CUDA Toolkit
- vcpkg

Die Visual-Studio-interne vcpkg-Installation kann auf manchen Systemen keine normale Ports-Registry aufloesen. Wenn `build_all.cmd` Fehler wie `glm does not exist` oder `nlohmann-json does not exist` meldet, installiere ein normales vcpkg und starte den Build mit gesetztem `VCPKG_ROOT`.

Beispiel:

```cmd
set VCPKG_ROOT=C:\dev\vcpkg
build_all.cmd
```

Alternativ kann direkt die Toolchain gesetzt werden:

```cmd
set VCPKG_TOOLCHAIN=C:\dev\vcpkg\scripts\buildsystems\vcpkg.cmake
build_all.cmd
```

## Ubuntu-/Linux-Setup

Der validierte Linux-Build lief unter Ubuntu in WSL 2. Auf einem nativen Ubuntu-System sollten dieselben Pakete passen.

Basiswerkzeuge:

```bash
sudo apt update
sudo apt install build-essential git cmake ninja-build pkg-config
```

Falls `cmake`, `ninja` oder `pkg-config` einzeln fehlen:

```bash
sudo apt install cmake
sudo apt-get install ninja-build
sudo apt install pkg-config
```

Ninja-Pakete sind auch in der offiziellen Ninja-Uebersicht verlinkt:

- https://github.com/ninja-build/ninja/wiki/Pre-built-Ninja-packages

### vcpkg unter Ubuntu/Linux installieren

Microsofts vcpkg-Repository:

- https://github.com/microsoft/vcpkg

Installation unter Ubuntu/Linux, mit `git clone` statt `wget`:

```bash
mkdir -p "$HOME/HSRM/vcpkg_git"
cd "$HOME/HSRM/vcpkg_git"
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
./bootstrap-vcpkg.sh
```

Danach den Build aus dem Projektverzeichnis mit `VCPKG_ROOT` starten:

```bash
cd /pfad/zum/projekt/propeller
VCPKG_ROOT="$HOME/HSRM/vcpkg_git/vcpkg" ./build_all.sh
```

Referenz fuer vcpkg unter Ubuntu:

- https://lindevs.com/install-vcpkg-on-ubuntu/

## CUDA unter Ubuntu/Linux

Fuer den CUDA-Renderer muss CUDA unter Linux installiert sein. Die passende NVIDIA-Seite ist:

- https://developer.nvidia.com/cuda-downloads?target_os=Linux

Fuer Ubuntu 22.04 x86_64 als lokales `.deb`-Paket:

- https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=22.04&target_type=deb_local

Den Anweisungen auf der NVIDIA-Seite folgen. Danach CUDA in den `PATH` aufnehmen:

```bash
echo 'export PATH=/usr/local/cuda/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

Pruefen:

```bash
nvcc --version
```

## Schnellstart unter Windows

```cmd
build_all.cmd
start_all.cmd
```

Optional kann der Stack direkt nach erfolgreichem Build gestartet werden:

```cmd
build_all.cmd --start
```

## Schnellstart unter Linux

```bash
chmod +x build_all.sh start_all.sh
./build_all.sh
./start_all.sh
```

Optional kann der Stack direkt nach erfolgreichem Build gestartet werden:

```bash
./build_all.sh --start
```

Wenn vcpkg nicht im `PATH` liegt, kann der vcpkg-Checkout direkt fuer den Build angegeben werden:

```bash
VCPKG_ROOT="$HOME/HSRM/vcpkg_git/vcpkg" ./build_all.sh
```

## Build-Details

### Was `build_all.cmd` baut

- `Client`: installiert bei Bedarf `node_modules` und fuehrt `npm.cmd run build` aus
- `prism\2Drenderer`: baut `renderer_2d.exe` und `spd_plotter.exe` nach `cmake-build-release`
- `prism\CUDA-Spectral-Pathtracer`: baut `PathtracerSpectralRealtime.exe` nach `out\build\x64-release`

Diese Ausgabepfade passen zu den Pfaden, die `start_all.cmd` bzw. die Backend-Server erwarten.

Wenn in einem dieser Build-Verzeichnisse ein alter CMake-Cache ohne vcpkg-Toolchain liegt, legt `build_all.cmd` nur dieses generierte Build-Verzeichnis neu an. Das ist noetig, weil `CMAKE_TOOLCHAIN_FILE` bei CMake praktisch beim ersten Konfigurieren gesetzt werden muss.

### Was `build_all.sh` baut

- `Client`: installiert bei Bedarf `node_modules` und fuehrt `npm run build` aus
- `prism/2Drenderer`: baut `renderer_2d` und `spd_plotter` nach `cmake-build-release`
- `prism/CUDA-Spectral-Pathtracer`: baut `PathtracerSpectralRealtime` nach `build`

Diese Linux-Ausgabepfade passen zu den plattformabhaengigen Backend-Defaults. Falls der CUDA-Renderer auf einem Linux-System in einem anderen Pfad liegt, kann `CUDA_RENDERER_EXE` gesetzt werden. Fuer den 2D-Renderer gehen entsprechend `RENDERER_EXE` und `SPD_PLOTTER_EXE`.

## Optionen

```cmd
build_all.cmd --skip-client
build_all.cmd --skip-2d
build_all.cmd --skip-cuda
build_all.cmd --debug
build_all.cmd --no-client-install
build_all.cmd --start
```

Mit `build_all.cmd --help` bzw. `./build_all.sh --help` werden alle Optionen und Environment-Overrides angezeigt.
