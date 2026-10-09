#include "wave/io/field_debug_writer.hpp"

#include "wave/io/ppm_writer.hpp"
#include "wave/postprocess/field_ops.hpp"

namespace wave {
    void writeFieldDebugPPMs(
        const std::string &prefix,
        const std::vector<std::complex<float> > &field,
        const int width,
        const int height
    ) {
        writeAmplitudePPM(prefix + "_amplitude.ppm", resolveAmplitude(field), width, height);
        writePhasePPM(prefix + "_phase.ppm", resolvePhase(field), width, height);
    }
} // namespace wave
