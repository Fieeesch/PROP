# PROP – Physikalisch plausibles Rendering optischer Phänomene

## Überblick

PROPeller untersucht ausgewählte lichtoptische Phänomene mit physikalisch
plausiblen Renderingverfahren. Im Mittelpunkt stehen Effekte, die sich mit
klassischer Rasterisierung oder reinem RGB-Raytracing nur unzureichend
darstellen lassen:

- spektrale Dispersion an einem Prisma
- Interferenz und Speckle bei kohärentem Laserlicht

Das Projekt besteht aus spezialisierten Minimalrenderern und einem gemeinsamen
Vue/Vite-Frontend zur Konfiguration und Visualisierung.

## Projektstruktur

- [`prism/2Drenderer`](prism/2Drenderer): 2D Spectral Light Tracer für
  Prisma-Dispersion, mit OpenMP-CPU-Fallback und optionaler CUDA-Beschleunigung
- [`prism/CUDA-Spectral-Pathtracer`](prism/CUDA-Spectral-Pathtracer):
  CUDA-beschleunigter Spectral Path Tracer für spektrales Rendering in 3D
- [`prism/example-scenes`](prism/example-scenes): Beispiel-Szenendateien für
  die Frontend-Nutzung von 2D Spectral Light Tracer und CUDA Spectral Path
  Tracer
- [`Client`](Client): Vue/Vite-Frontend; spricht mit den Prisma-Backends und
  berechnet die Laser-Speckle-Vorschau direkt im Browser mit WebGPU
- [`laser/WaveRendererCpp`](laser/WaveRendererCpp): eigenständiger,
  headless C++-Laser-Renderer für lokale PPM-Ausgaben und Benchmarks
- [`scripts`](scripts): projektübergreifende Build-, Start- und Benchmark-Skripte
- [`PROP_Paper.pdf`](Prop_Paper.pdf): Schriftliche Ausarbeitung und Erläuterung des Projekts

## Quick Start mit Docker

Der Web-Stack besteht aus drei Containern:

- `prism-2d`: 2D-Prisma-Renderer mit Node-Backend (CPU/OpenMP)
- `prism-cuda`: CUDA Spectral Path Tracer mit Node-Backend
- `laser-frontend`: gebautes Vue/Vite-Frontend hinter nginx

Der eigenständige C++-Laser-Renderer ist nicht Teil der Images. Für ihn gibt es
einen separaten
[Quick Start](laser/WaveRendererCpp/README.md#schnellstart) mit Setup-Skripten
für Bazzite/Distrobox, Fedora und Ubuntu sowie einem manuellen Build-Pfad.

### Voraussetzungen

- Docker mit Docker Compose
- NVIDIA-GPU und passender NVIDIA-Treiber
- NVIDIA Container Toolkit für den CUDA-Prisma-Renderer
- Browser mit WebGPU-Unterstützung für den Laser-Renderer

### Starten

Aus dem Repository-Wurzelverzeichnis:

```bash
docker compose up --build -d
```

Danach ist die Anwendung unter <http://localhost:5173> erreichbar.

Ein anderer Host-Port kann über `FRONTEND_PORT` gesetzt werden:

```bash
FRONTEND_PORT=8088 docker compose up --build -d
```

Logs anzeigen:

```bash
docker compose logs -f
```

### WebGPU für den Laser-Renderer

Die Prisma-Renderer rechnen in den Containern. Der Laser-Renderer läuft dagegen
per WebGPU auf der GPU des Browser-Rechners.

Empfohlen wird ein aktueller Chrome- oder Chromium-Browser. Unter Firefox auf
Linux muss WebGPU gegebenenfalls über `about:config` mit
`dom.webgpu.enabled = true` aktiviert und Firefox anschließend vollständig neu
gestartet werden.

WebGPU ist nur in einem sicheren Browser-Kontext verfügbar. Für den lokalen
Start deshalb `http://localhost:5173` verwenden. Ein unverschlüsselter Zugriff
über eine LAN-Adresse wie `http://192.168.x.x:5173` reicht nicht aus; für
Netzwerkzugriff muss das Frontend über HTTPS bereitgestellt werden.
Der Laser-Renderer funktioniert dann nicht und kann etwa
`Uniform "storageTexture" not implemented` melden.

### Stoppen

```bash
docker compose down
```

## Native Entwicklung

Die vollständige plattformübergreifende Build-Anleitung einschließlich
Toolchains, vcpkg, CUDA und aller Skriptoptionen steht in
[`BUILD.md`](BUILD.md).

### Gesamten Web-Stack bauen und starten

Die Sammelskripte bauen das Frontend und beide Prisma-Renderer. Der
eigenständige C++-Laser-Renderer ist bewusst nicht Bestandteil dieses Builds.

Linux:

```bash
./build_all.sh
./start_all.sh
```

Windows:

```powershell
./build_all.cmd
./start_all.cmd
```

Ein Build mit anschließendem Start ist ebenfalls möglich:

```bash
./build_all.sh --start
```

```powershell
./build_all.cmd --start
```

Alle Optionen und Umgebungsvariablen sind in
[`BUILD.md`](BUILD.md#optionen) dokumentiert.

### Einzelne Komponenten

#### 2D Spectral Light Tracer

Build, CPU-/CUDA-Ausführung, SPD-Plotter und Backend:

- [README des 2D-Renderers](prism/2Drenderer/README.md)

#### CUDA Spectral Path Tracer

Build, Tests, Szenen und Kommandozeilenparameter:

- [README des CUDA Spectral Path Tracers](prism/CUDA-Spectral-Pathtracer/README.md)

#### C++ Wave Renderer für Laser-Speckle

Setup-Skripte, Konfiguration, Ausgabedateien und Benchmarks:

- [README des C++ Wave Renderers](laser/WaveRendererCpp/README.md)

#### Frontend

Für die lokale Frontend-Entwicklung:

```bash
cd Client
npm install
npm run dev
```

Das Frontend ist anschließend unter <http://localhost:5173> erreichbar. Die
Prisma-Renderfunktionen benötigen ihre jeweiligen lokalen Backends; die
Laser-Vorschau benötigt nur WebGPU im Browser.

Beispiel-Szenen für den 2D Spectral Light Tracer und den CUDA Spectral Path
Tracer liegen unter [`prism/example-scenes`](prism/example-scenes) und können
im Frontend importiert werden.

Produktionsbuild:

```bash
npm run build
```

Die Renderer-Auswahl wird über `Client/public/renderer.json` geladen. Der Pfad
dorthin ist in `Client/.env` beziehungsweise `Client/.env.example` über
`VITE_RENDERER_BACKENDS_FILE` konfiguriert.
