# WaveRendererCpp

WaveRendererCpp simuliert die Ausbreitung einer kohärenten Lichtwelle durch
eine Szene aus Laser, diffuser Wand, Linse und Sensor. Das Projekt enthält
zwei ausführbare Programme:

- `WaveRendererCpp` rendert eine einzelne konfigurierte Szene und schreibt
  Bilder im PPM-Format.
- `WaveRendererBenchmark` vergleicht die schnelle
  Fraunhofer-/FFT-Ausbreitung mit einer direkten Referenzberechnung und
  erzeugt Messwerte sowie Heatmaps.

Das Projekt ist eine Headless-Kommandozeilenanwendung. CLion, ein Fenstersystem
und eine GPU werden nicht benötigt.

## Schnellstart

### Bazzite DX mit Distrobox

```bash
./setup-distrobox.sh
```

Das Skript erstellt bei Bedarf die Fedora-Distrobox `hsrm-ss26-avc-propeller`, installiert
die Abhängigkeiten und baut beide Targets.

### Fedora

```bash
./setup-fedora.sh
```

### Ubuntu

```bash
./setup-ubuntu.sh
```

### Manueller Build

Benötigt werden:

- ein C++20-Compiler
- CMake 3.25 oder neuer
- Ninja
- GLM
- FFTW3 für `float` (`fftw3f`)
- OpenMP
- `pkg-config`, falls FFTW keine eigene CMake-Konfiguration bereitstellt

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

Nur ein bestimmtes Target bauen:

```bash
cmake --build build --target WaveRendererCpp --parallel
cmake --build build --target WaveRendererBenchmark --parallel
```

Ein Release-Build wird empfohlen. Die direkte Ausbreitung ist sehr
rechenintensiv und der Release-Build aktiviert unter anderem `-O3`,
CPU-spezifische Optimierungen, Fast-Math und Link-Time-Optimierung.

## Rendering verwenden

Der Renderer wird aus dem Projektverzeichnis gestartet:

```bash
./build/WaveRendererCpp
```

Er gibt Fortschritt, ausgewählte Presets und Fokusabstände auf `stderr` aus.
Die Bilder werden in das aktuelle Arbeitsverzeichnis geschrieben:

| Datei | Inhalt |
|---|---|
| `wall_output.ppm` | Intensität auf der Wand |
| `lens_input_output.ppm` | Intensität am Linseneingang |
| `lens_output.ppm` | Intensität nach der Linse |
| `sensor_linear_output.ppm` | lineare Sensorintensität |
| `sensor_output.ppm` | kameramäßig aufbereitete Sensorausgabe |
| `wall_amplitude.ppm`, `wall_phase.ppm` | Amplitude und Phase an der Wand |
| `lens_input_amplitude.ppm`, `lens_input_phase.ppm` | Feld am Linseneingang |
| `lens_output_amplitude.ppm`, `lens_output_phase.ppm` | Feld am Linsenausgang |
| `sensor_amplitude.ppm`, `sensor_phase.ppm` | Feld auf dem Sensor |

PPM-Dateien lassen sich beispielsweise mit GIMP, ImageMagick oder vielen
Bildbetrachtern öffnen.

## Rendering konfigurieren

Es gibt momentan keine Kommandozeilenparameter. Die Renderkonfiguration steht
in [`include/wave/app/simulation_config.hpp`](include/wave/app/simulation_config.hpp)
in `wave::SimulationConfig`. Nach einer Änderung muss das betroffene Target neu
gebaut werden:

```bash
cmake --build build --target WaveRendererCpp --parallel
./build/WaveRendererCpp
```

### Ausbreitungsverfahren

```cpp
bool useFF = true;
```

- `true`: schnelle Fraunhofer-/FFT-Ausbreitung
- `false`: direkte numerische Integration

Die direkte Methode dient vor allem als Referenz. Sie kann schon bei moderaten
Auflösungen erheblich länger dauern.

```cpp
int fftZeroPaddingFactor = 4;
```

Der Zero-Padding-Faktor beeinflusst die FFT-Ausbreitung. Höhere Werte können
Abtastungsartefakte reduzieren, erhöhen aber Speicherbedarf und Laufzeit.

### Auflösung und Abtastung

```cpp
int width = 216;
int height = 216;

int wallFactor = 2;
int lensFactor = 1;
int lensSupersampleFactor = 2;
int sensorFactor = 1;
int sensorSupersampleFactor = 2;
```

Die effektiven Rastergrößen werden daraus berechnet:

| Ebene/Ausgabe | Rastergröße |
|---|---|
| Wand | `width * wallFactor` × `height * wallFactor` |
| Linse | `width * lensFactor * lensSupersampleFactor` × entsprechend Höhe |
| Sensorfeld intern | `width * sensorFactor * sensorSupersampleFactor` × entsprechend Höhe |
| Sensorbild | `width * sensorFactor` × `height * sensorFactor` |

Laufzeit und Speicherbedarf steigen schnell mit der Rastergröße. Änderungen
sollten deshalb zunächst mit kleinen Werten getestet werden.

### Optische Parameter

```cpp
float laserRadiusMm = 1.75f;
float lensApertureRadiusMm = 2.56f;
float planeWidthMm = 5.12f;
float lensFocalLengthMm = 128.0f;
float laserWavelengthNm = 650.0f;
float laserAmplitudeVm = 500.0f;
unsigned baseSeed = 42069u;
```

`baseSeed` steuert die reproduzierbare Zufallsstruktur der diffusen Wand.
Gleicher Seed und gleiche Konfiguration erzeugen reproduzierbare Ergebnisse.

Die festen Ebenen für Linse und Wand werden ebenfalls in
`SimulationConfig` definiert:

```cpp
Plane lensPlane = Plane(position, up);
Plane wallPlane = Plane(position, up);
```

Ein `Plane` besteht aus seiner Position und einem Orientierungsvektor.
Koordinaten und optische Abstände werden in Millimetern angegeben.

### Laser-Presets

Das aktive Preset wird mit `laserPreset` gewählt:

| Wert | Bedeutung |
|---:|---|
| `0` | benutzerdefinierte Ebene aus `customLaserPlane` |
| `1` | senkrechter Einfall |
| `2` | schräger Einfall mit 45° |
| `3` | schräger Einfall mit seitlicher Verschiebung |
| `4` | flacher schräger Einfall |

Beispiel für ein benutzerdefiniertes Preset:

```cpp
int laserPreset = 0;
Plane customLaserPlane =
    Plane(Vec3(-128.0f, 128.0f, 0.0f), Vec3(1.0f, 0.0f, 1.0f));
```

### Sensor-Presets und Autofokus

Das aktive Sensor-Preset wird mit `sensorPreset` gewählt:

| Wert | Bedeutung | Autofokus |
|---:|---|:---:|
| `0` | `customSensorPlane` | `customSensorAutoFocus` |
| `1` | zentrierter Sensor | an |
| `2` | in X-Richtung verschoben | an |
| `3` | diagonal verschoben | an |
| `4` | stark in Y-Richtung geneigt | an |
| `5` | stark geneigt und seitlich verschoben | an |
| `6` | stark defokussierte Referenzebene | aus |
| `7` | sehr flacher diagonaler Einfallswinkel | an |

Eine eigene Sensorlage wird so aktiviert:

```cpp
int sensorPreset = 0;
Plane customSensorPlane =
    Plane(Vec3(128.0f, 128.0f, -320.0f), Vec3(0.0f, 0.0f, 1.0f));
bool customSensorAutoFocus = true;
```

`customSensorPlane` und `customSensorAutoFocus` werden nur ausgewertet, wenn
`sensorPreset` auf `0` oder einen anderen nicht definierten Presetwert gesetzt
ist. Bei aktiviertem Autofokus wird die Sensorposition passend zur Szene
auf die berechnete Fokusebene verschoben.

## Benchmark verwenden

Der Benchmark wird ebenfalls im Quellcode konfiguriert und anschließend neu
gebaut:

```bash
cmake --build build --target WaveRendererBenchmark --parallel
./build/WaveRendererBenchmark
```

Die Konfiguration befindet sich in
[`src/benchmark_main.cpp`](src/benchmark_main.cpp):

- `makeBenchmarkConfig()` bestimmt die gemeinsame `SimulationConfig`.
- `makeBenchmarkRunConfig()` bestimmt Presetbereiche, CSV-Datei und
  Referenzimport/-export.

Der Benchmark führt für jede ausgewählte Kombination eine schnelle
FFT-Ausbreitung aus. Als Vergleich benötigt er außerdem eine direkte
Referenz. Diese wird entweder aus einer Binärdatei importiert oder mit
`useFF = false` neu berechnet.

Import und Export von Referenzen sind standardmäßig deaktiviert:

```cpp
//config.directReferenceImportPath =
//    std::filesystem::path{"benchmark_direct_reference.bin"};
//config.directReferenceExportPath =
//    std::filesystem::path{"benchmark_direct_reference.bin"};
```

In diesem Zustand berechnet jeder Benchmarklauf alle direkten Referenzen neu
und legt keine Referenzdatei an. Zum Aktivieren wird die jeweils benötigte
Zuweisung in `makeBenchmarkRunConfig()` einkommentiert.

### Benchmarkfälle auswählen

In `BenchmarkConfig` werden die inklusiven Presetbereiche festgelegt:

```cpp
int firstLaserPreset = 1;
int lastLaserPreset = 2;
int firstSensorPreset = 1;
int lastSensorPreset = 7;
```

Die Voreinstellung führt damit 14 Kombinationen aus. Für einen schnellen
Einzeltest:

```cpp
config.firstLaserPreset = 1;
config.lastLaserPreset = 1;
config.firstSensorPreset = 1;
config.lastSensorPreset = 1;
```

Gemeinsame Simulationsparameter werden in `makeBenchmarkConfig()` gesetzt:

```cpp
[[nodiscard]] wave::SimulationConfig makeBenchmarkConfig() {
    wave::SimulationConfig config = {};
    config.width = 216;
    config.fftZeroPaddingFactor = 4;
    return config;
}
```

`laserPreset`, `sensorPreset` und `useFF` setzt die Benchmarkschleife selbst.

### Erster Lauf: direkte Referenzen erzeugen und exportieren

Beim ersten Lauf darf kein Importpfad gesetzt sein. Stattdessen wird ein
Exportpfad angegeben:

```cpp
[[nodiscard]] BenchmarkConfig makeBenchmarkRunConfig() {
    BenchmarkConfig config;
    config.directReferenceImportPath = {};
    config.directReferenceExportPath =
        std::filesystem::path{"benchmark_direct_reference.bin"};
    return config;
}
```

Danach neu bauen und starten:

```bash
cmake --build build --target WaveRendererBenchmark --parallel
./build/WaveRendererBenchmark
```

Für jede Presetkombination werden jetzt sowohl die schnelle Methode als auch
die langsame direkte Methode ausgeführt. Am Ende enthält
`benchmark_direct_reference.bin` alle erfolgreich verwendeten direkten
Referenzen.

### Folgeläufe: Referenzen importieren

Für spätere Läufe wird die Datei importiert und der Export deaktiviert:

```cpp
[[nodiscard]] BenchmarkConfig makeBenchmarkRunConfig() {
    BenchmarkConfig config;
    config.directReferenceImportPath =
        std::filesystem::path{"benchmark_direct_reference.bin"};
    config.directReferenceExportPath = {};
    return config;
}
```

Nach erneutem Build:

```bash
cmake --build build --target WaveRendererBenchmark --parallel
./build/WaveRendererBenchmark
```

Passende Referenzen kommen nun aus der Datei, sodass die teure direkte
Berechnung übersprungen wird. Die CSV-Spalte `direct_reference_source` zeigt
für jeden Fall `imported` oder `computed`.

### Referenz des Papers verwenden

Das versionierte Archiv `cmake-build-release.zip` enthält unter
`cmake-build-release/benchmark_direct_reference.bin` die direkte Referenz des
im Paper verwendeten Benchmarks. Nur diese Datei lässt sich ins
Projektverzeichnis entpacken mit:

```bash
unzip -j cmake-build-release.zip \
    cmake-build-release/benchmark_direct_reference.bin \
    -d .
```

Anschließend den Import in `makeBenchmarkRunConfig()` aktivieren:

```cpp
config.directReferenceImportPath =
    std::filesystem::path{"benchmark_direct_reference.bin"};
```

Nach dem Neubau verwendet der Benchmark die Paper-Referenz für alle passenden
Konfigurationen:

```bash
cmake --build build --target WaveRendererBenchmark --parallel
./build/WaveRendererBenchmark
```

Die Referenz gehört zur Konfiguration des Paper-Benchmarks. Nach Änderungen an
maßgeblichen Simulationsparametern werden nicht passende Datensätze nicht
wiederverwendet und müssen direkt neu berechnet werden.

Wichtige Details:

- Ist ein Importpfad gesetzt, muss die Datei existieren und ein gültiges
  Referenzformat enthalten. Andernfalls bricht der Benchmark vor dem ersten
  Lauf ab.
- Enthält eine gültige Importdatei keine Referenz für eine bestimmte
  Konfiguration, wird nur diese Referenz neu berechnet.
- Referenzen sind an die maßgebliche Simulationskonfiguration gebunden.
  Veränderte Auflösung, Optik, Geometrie, Presets oder Seed führen zu einem
  anderen Konfigurationsschlüssel und damit zu einer Neuberechnung.
- Stimmen die gespeicherten und aktuellen Rasterformen nicht überein, wird der
  betreffende Benchmarkfall als Fehler gemeldet.
- Import und Export können gleichzeitig gesetzt werden. Dann werden vorhandene
  Referenzen importiert, fehlende berechnet und anschließend alle im Lauf
  verwendeten Referenzen in die Exportdatei geschrieben. Für eine
  Aktualisierung sollte eine andere Exportdatei verwendet werden, damit die
  funktionierende Importdatei bis zum erfolgreichen Ende erhalten bleibt.

### Benchmarkausgaben

Der Benchmark erzeugt:

| Datei | Inhalt |
|---|---|
| `benchmark_results.csv` | Messwerte für jede Presetkombination |
| `benchmark_results_image_corr.svg` | Heatmap der Bildkorrelation |
| `benchmark_results_image_rmse.svg` | Heatmap des relativen Bild-RMSE |
| `benchmark_results_image_rmse_gain_matched.svg` | RMSE nach optimaler Verstärkungsanpassung |

Die CSV enthält unter anderem:

- Laufzeiten der direkten und schnellen Methode
- Quelle der direkten Referenz
- relativen RMSE an Linse, Sensorfeld und Sensorbild
- Bildkorrelation
- optimale Verstärkung und RMSE nach Verstärkungsanpassung

Die Konsolenzusammenfassung nennt zusätzlich Gesamt-Speedup, Mittelwerte,
schlechteste Fälle und getrennte Zusammenfassungen für annähernd parallele
und stark geneigte Sensorfälle.

## Ergebnisse und Builds entfernen

```bash
./clean.sh
```

Das Skript entfernt den Buildordner sowie die bekannten Renderer- und
Benchmarkausgaben. Die wiederverwendbare Datei
`benchmark_direct_reference.bin` und versionierte Referenzbilder bleiben
bewusst erhalten.

## Typischer Arbeitsablauf

1. `SimulationConfig` beziehungsweise die Presets anpassen.
2. `WaveRendererCpp` bauen und das Einzelbild prüfen.
3. Im Benchmark zunächst nur eine kleine Presetkombination testen.
4. Direkte Referenzen einmalig exportieren.
5. Bei weiteren Messungen die Referenzen importieren.
6. Nach relevanten Änderungen an Simulation oder Geometrie neue Referenzen
   erzeugen.
