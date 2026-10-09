#pragma once

#include <vector>

namespace wave {
    [[nodiscard]] std::vector<float> downsampleBoxAverage(
        const std::vector<float> &highRes,
        int highWidth,
        int highHeight,
        int factor
    );
} // namespace wave
