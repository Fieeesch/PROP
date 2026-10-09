#include <algorithm>
#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <glm/glm.hpp>

#include "color.h"
#include "config.h"
#include "geometry.h"
#include "optics.h"
#include "raytracer.h"
#include "spectrum.h"

// Rechtshändiges Koordinatensystem:
//    y ↑
//         → x
//  z ↙

struct Scene {
    enum class LightType { Circle, Area };

    Plane imagePlane;
    LightType lightType;
    CircleLight circleLight;
    AreaLight areaLight;
    std::string spdFilename;
    Prism2D prismDescription;
    std::string sellmeierFilename;
    std::string absorptionFilename;
    RenderConfig renderConfig;
};

static Scene defaultScene() {
    return {
        {
            {1.808f, -0.57f, 0.0f},
            {-1.0f, 0.0f, 0.0f},
            {0.0f, 0.0f, 1.0f},
            {0.0f, 1.0f, 0.0f},
            0.1f, 0.1f
        },
        Scene::LightType::Area,
        {
            {-1.808f, -1.0f, 0.0f},
            glm::normalize(glm::vec3{0.94f, 0.342f, 0.0f}),
            {0.0f, 0.0f, -1.0f},
            glm::normalize(glm::vec3{-0.342f, 0.94f, 0.0f}),
            0.01f
        },
        {
            {-1.808f, -1.0f, 0.0f},
            glm::normalize(glm::vec3{0.94f, 0.342f, 0.0f}),
            glm::vec3{0.0f, 0.0f, -1.0f},
            glm::normalize(glm::vec3{-0.342f, 0.94f, 0.0f}),
            0.02f,
            0.01f
        },
        SPD_FILENAME,
        {
            {0.0f, 0.0f},
            45.0f,
            0.0f,
            1.0f,
            1.0f,
        },
        SELLMEIER_FILENAME,
        ABSORP_FILENAME,
        {}, // RenderConfig: use default values from config.h
    };
}

static glm::vec3 readVec3(std::istream& input) {
    glm::vec3 value;
    if (!(input >> value.x >> value.y >> value.z)) {
        throw std::runtime_error("Invalid 3D vector in scene file");
    }
    return value;
}

static glm::vec2 readVec2(std::istream& input) {
    glm::vec2 value;
    if (!(input >> value.x >> value.y)) {
        throw std::runtime_error("Invalid 2D vector in scene file");
    }
    return value;
}

// Szene aus txt-Datei einlesen
static Scene loadScene(const std::string& filename) {
    std::ifstream input(filename);
    if (!input) {
        throw std::runtime_error("Could not open scene file: " + filename);
    }

    Scene scene{};
    scene.spdFilename = SPD_FILENAME;
    std::string type;
    while (input >> type) {
        if (type == "image_plane") {
            scene.imagePlane.point = readVec3(input);
            scene.imagePlane.normal = readVec3(input);
            scene.imagePlane.right = readVec3(input);
            scene.imagePlane.up = readVec3(input);
            if (!(input >> scene.imagePlane.width >> scene.imagePlane.height)) {
                throw std::runtime_error("Invalid plane in scene file");
            }
        } else if (type == "circle_light") {
            scene.lightType = Scene::LightType::Circle;
            scene.circleLight.center = readVec3(input);
            scene.circleLight.direction = readVec3(input);
            scene.circleLight.right = readVec3(input);
            scene.circleLight.up = readVec3(input);
            if (!(input >> scene.circleLight.radius)) {
                throw std::runtime_error("Invalid circle light");
            }
        } else if (type == "area_light") {
            scene.lightType = Scene::LightType::Area;
            scene.areaLight.center = readVec3(input);
            scene.areaLight.direction = readVec3(input);
            scene.areaLight.right = readVec3(input);
            scene.areaLight.up = readVec3(input);
            if (!(input >> scene.areaLight.width >> scene.areaLight.height)) {
                throw std::runtime_error("Invalid area light");
            }
        } else if (type == "light_spd") {
            if (!(input >> scene.spdFilename)) {
                throw std::runtime_error("Invalid Light SPD Filename");
            }
        } else if (type == "prism") {
            scene.prismDescription.position = readVec2(input);
            if (!(input >> scene.prismDescription.prismAngleDeg
                        >> scene.prismDescription.rotationDeg
                        >> scene.prismDescription.radius
                        >> scene.prismDescription.zDepth)) {
                throw std::runtime_error("Invalid prism description");
            }
        } else if (type == "prism_sellmeier") {
            if (!(input >> scene.sellmeierFilename)) {
                throw std::runtime_error("Invalid Sellmeier Coefficients Filename");
            }
        } else if (type == "prism_absorption") {
            if (!(input >> scene.absorptionFilename)) {
                throw std::runtime_error("Invalid Absorption Coefficients Filename");
            }
        } else if (type == "render_config") {
            if (!(input >> scene.renderConfig.recursionDepth
                        >> scene.renderConfig.lambdaMin >> scene.renderConfig.lambdaMax
                        >> scene.renderConfig.spectrumBins >> scene.renderConfig.lightPower
                        >> scene.renderConfig.lightSamples >> scene.renderConfig.imageExposure
                        >> scene.renderConfig.imageWidth >> scene.renderConfig.imageHeight)) {
                throw std::runtime_error("Invalid render configuration");
            }

            // reading seed
            std::string remainingLine;
            std::getline(input, remainingLine);
            std::stringstream remaining(remainingLine);
            int rngSeedEnabled = 0;
            if (remaining >> rngSeedEnabled) {
                if (rngSeedEnabled != 0 && rngSeedEnabled != 1) {
                    throw std::runtime_error("Invalid render configuration");
                }
                scene.renderConfig.rngSeedEnabled = rngSeedEnabled == 1;
                if (!(remaining >> scene.renderConfig.rngSeed)) {
                    throw std::runtime_error("Invalid render configuration");
                }
            }
        } else {
            throw std::runtime_error("Unknown scene entry: " + type);
        }
    }

    if (scene.renderConfig.lambdaMin >= scene.renderConfig.lambdaMax
        || scene.renderConfig.spectrumBins < 2
        || scene.renderConfig.lightPower <= 0.0f
        || scene.renderConfig.lightSamples < 1
        || scene.renderConfig.imageExposure <= 0.0f
        || scene.renderConfig.imageWidth < 1
        || scene.renderConfig.imageHeight < 1) {
        throw std::runtime_error("Render configuration contains invalid values");
    }
    return scene;
}

static void writePPM(
    const std::string& filename,
    const std::vector<RGB>& pixels,
    int width,
    int height
) {
    std::ofstream out(filename);
    if (!out) {
        throw std::runtime_error("Could not write image: " + filename);
    }

    out << "P3\n" << width << ' ' << height << "\n255\n";
    for (const RGB& color : pixels) {
        out << static_cast<int>(255.0f * std::clamp(color.r, 0.0f, 1.0f)) << ' '
            << static_cast<int>(255.0f * std::clamp(color.g, 0.0f, 1.0f)) << ' '
            << static_cast<int>(255.0f * std::clamp(color.b, 0.0f, 1.0f)) << '\n';
    }
}

int main(int argc, char* argv[]) {
    try {
        // Szene aus temp txt-Datei laden (bei Aufruf durch Server) oder Default Szene nehmen
        Scene scene = argc >= 2 ? loadScene(argv[1]) : defaultScene();
        // Output ist temp Datei (bei Aufruf durch Server) oder Default Path
        const std::string output = argc >= 3 ? argv[2] : "results/output.ppm";

        std::cout << "Szene geladen\n";

        // Bild als Vektor initialisieren
        const RenderConfig& config = scene.renderConfig;
        const int pixelCount = config.imageWidth * config.imageHeight;
        std::vector<Spectrum> spectralImage(
            pixelCount,
            Spectrum(config.spectrumBins)
        );
        // Spectral Power Distribution laden
        SpectralPowerDistribution lightSPD =
            loadSPDFromCSV(scene.spdFilename, config);
        // Absorptionskoeffizienten des Materials laden
        std::vector<AbsorptionSample> absorption = readAbsorptionCsv(scene.absorptionFilename);
        // Sellmeier-Koeffizienten des Materials laden
        SellmeierCoefficients sellmeier = readSellmeierCsv(scene.sellmeierFilename);

        // Prisma-Ebenen aus Beschreibung berechnen
        std::vector<Plane> prismPlanes = buildPrismPlanes(scene.prismDescription);

        // Zeitmessung Start
        const auto start = std::chrono::high_resolution_clock::now();

        // Bild generieren
        if (scene.lightType == Scene::LightType::Area) {
            generateSpectralImage(
                scene.imagePlane, scene.areaLight, lightSPD, prismPlanes,
                sellmeier, absorption, spectralImage, config
            );
        } else {
            generateSpectralImage(
                scene.imagePlane, scene.circleLight, lightSPD, prismPlanes,
                sellmeier, absorption, spectralImage, config
            );
        }

        std::vector<RGB> rgbImage(pixelCount);
        const float referencePixelCount = 512.0f * 512.0f;
        const float exposureScale =
            static_cast<float>(config.imageWidth * config.imageHeight) / referencePixelCount;
        const float exposure = config.imageExposure * exposureScale;

        #pragma omp parallel for
        for (int i = 0; i < pixelCount; ++i) {
            RGB rgb = xyzToLinearSRGB(spectrumToXYZ(spectralImage[i], config));
            rgb.r *= exposure;
            rgb.g *= exposure;
            rgb.b *= exposure;
            rgbImage[i] = linearToSRGB(rgb);
        }

        writePPM(output, rgbImage, config.imageWidth, config.imageHeight);

        // Zeitmessung Ende
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::high_resolution_clock::now() - start
        );
        std::cout << "Dauer: " << elapsed.count() << " ms\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
