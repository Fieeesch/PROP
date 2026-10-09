#pragma once

#include <complex>
#include <string>
#include <vector>

namespace wave {
    void writeFieldDebugPPMs(
        const std::string &prefix,
        const std::vector<std::complex<float> > &field,
        int width,
        int height
    );
} // namespace wave
