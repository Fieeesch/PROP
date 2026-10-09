#ifndef RENDERER_2D_COLOR_H
#define RENDERER_2D_COLOR_H

#include "config.h"
#include "spectrum.h"

struct RGB {
    float r;
    float g;
    float b;
};

struct XYZ {
    float x;
    float y;
    float z;
};

float gaussian(float lambda, float mu, float sigma1, float sigma2);
XYZ cie1931Approx(float lambdaNm);
XYZ spectrumToXYZ(const Spectrum& spectrum, const RenderConfig& config);
RGB xyzToLinearSRGB(const XYZ& xyz);
float linearToSRGB(float c);
RGB linearToSRGB(RGB c);

#endif
