#include "wave/postprocess/resampling.hpp"

namespace wave {
    std::vector<float> downsampleBoxAverage(
        const std::vector<float> &highRes,
        const int highWidth,
        const int highHeight,
        const int factor
    ) {
        if (factor <= 1) {
            return highRes;
        }

        const int lowWidth = highWidth / factor;
        const int lowHeight = highHeight / factor;
        std::vector lowRes(lowWidth * lowHeight, 0.0f);
        const float scale = 1.0f / static_cast<float>(factor * factor);

        for (int lowRow = 0; lowRow < lowHeight; ++lowRow) {
            for (int lowCol = 0; lowCol < lowWidth; ++lowCol) {
                float sum = 0.0f;

                for (int dy = 0; dy < factor; ++dy) {
                    const int highRow = lowRow * factor + dy;
                    for (int dx = 0; dx < factor; ++dx) {
                        const int highCol = lowCol * factor + dx;
                        sum += highRes[highRow * highWidth + highCol];
                    }
                }

                lowRes[lowRow * lowWidth + lowCol] = sum * scale;
            }
        }

        return lowRes;
    }
} // namespace wave
