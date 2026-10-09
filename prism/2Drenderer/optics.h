//
// Created by Cecilia on 02.06.2026.
//

#ifndef RENDERER_2D_OPTICS_H
#define RENDERER_2D_OPTICS_H

#include <string>
#include <glm/glm.hpp>
#include <vector>

struct SellmeierCoefficients
{
    float b1;
    float b2;
    float b3;
    float c1;
    float c2;
    float c3;
};

float ior_sellmeier(float lambda, SellmeierCoefficients cons);

struct RefractionTerms {
    glm::vec3 I;
    glm::vec3 N;
    float eta;
    float cosI;
    float sinT2;
    float cosT;
};

bool computeRefractionTerms(
    const glm::vec3& incident,
    const glm::vec3& normal,
    float n1,
    float n2,
    RefractionTerms& terms
);

glm::vec3 refractDirection(RefractionTerms& terms);

float computeSchlickTransmittance(
    float cosI,
    float n1,
    float n2
);

float computeFresnelTransmittance(
    float cosI,
    float cosT,
    float n1,
    float n2
);

glm::vec3 reflectDirection(
    const glm::vec3& incident,
    const glm::vec3& normal
);

struct AbsorptionSample {
    float wavelengthNm;
    float sigmaA_cm_inv;
};

std::vector<AbsorptionSample> readAbsorptionCsv(const std::string& filename);

SellmeierCoefficients readSellmeierCsv(const std::string& filename);

float interpolateSigmaA(
    const std::vector<AbsorptionSample>& samples,
    float wavelengthNm
);

float computeBeerLambertTransmittance(
    glm::vec3 entryPoint,
    glm::vec3 exitPoint,
    float wavelength,
    const std::vector<AbsorptionSample>& samples
);

#endif //RENDERER_2D_OPTICS_H
