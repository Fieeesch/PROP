#include "wave/propagation/plane_propagator.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <iostream>
#include <new>
#include <stdexcept>
#include <vector>

#include <fftw3.h>

#include "wave/core/math.hpp"

namespace wave {
    namespace {
        [[nodiscard]] std::complex<float> sampleComplexBilinear(
            const fftwf_complex *samples,
            const int width,
            const int height,
            const double col,
            const double row
        ) {
            if (col < 0.0 || row < 0.0 || col > static_cast<double>(width - 1) ||
                row > static_cast<double>(height - 1)) {
                return {0.0f, 0.0f};
            }

            const int col0 = static_cast<int>(std::floor(col));
            const int row0 = static_cast<int>(std::floor(row));
            const int col1 = std::min(col0 + 1, width - 1);
            const int row1 = std::min(row0 + 1, height - 1);

            const auto tx = static_cast<float>(col - static_cast<double>(col0));
            const auto ty = static_cast<float>(row - static_cast<double>(row0));

            const auto read = [&](const int sampleRow, const int sampleCol) {
                const int idx = sampleRow * width + sampleCol;
                return std::complex<float>(samples[idx][0], samples[idx][1]);
            };

            const std::complex<float> a = read(row0, col0);
            const std::complex<float> b = read(row0, col1);
            const std::complex<float> c = read(row1, col0);
            const std::complex<float> d = read(row1, col1);

            const std::complex<float> top = a * (1.0f - tx) + b * tx;
            const std::complex<float> bottom = c * (1.0f - tx) + d * tx;
            return top * (1.0f - ty) + bottom * ty;
        }
    } // namespace

    EnvelopeField propagateBetweenPlanes(
        const SampledPlane &srcPlane,
        const SampledPlane &dstPlane,
        const float wavelengthNm,
        const EnvelopeField &sourceField,
        const ReferenceWave &dstReferenceWave,
        const std::vector<uint8_t> *dstMask
    ) {
        std::vector<std::complex<float> > result(dstPlane.width() * dstPlane.height());

        const double wavelengthMm = wavelengthNm * 1e-6;
        const double waveNumber = 2.0 * kPi / wavelengthMm;
        const double deltaArea = srcPlane.pixelSizeMm() * srcPlane.pixelSizeMm();
        const std::complex rayleighSommerfeldPrefactor(0.0, -1.0 / wavelengthMm);

        float maxNormSource = 0.0f;
        for (const auto &sample: sourceField.samples) {
            maxNormSource = std::max(maxNormSource, std::norm(sample));
        }
        const float epsilon = 1e-6f * maxNormSource;

        const auto &dstSamplePositions = dstPlane.samplePositions();
        const auto &srcSamplePositions = srcPlane.samplePositions();

        std::vector<int> activeSourceIndices;
        std::vector<double> activeSourceReferencePathsMm;
        activeSourceIndices.reserve(sourceField.samples.size());
        activeSourceReferencePathsMm.reserve(sourceField.samples.size());

        for (int index = 0; index < static_cast<int>(sourceField.samples.size()); ++index) {
            if (std::norm(sourceField.samples[index]) > epsilon) {
                activeSourceIndices.push_back(index);
                activeSourceReferencePathsMm.push_back(
                    referenceOpticalPathMm(sourceField.referenceWave, srcSamplePositions[index])
                );
            }
        }

        std::vector<int> activeDestinationIndices;
        if (dstMask != nullptr) {
            activeDestinationIndices.reserve(result.size());
            for (int index = 0; index < static_cast<int>(result.size()); ++index) {
                if ((*dstMask)[index] != 0) {
                    activeDestinationIndices.push_back(index);
                }
            }
        } else {
            activeDestinationIndices.resize(result.size());
            for (int index = 0; index < static_cast<int>(result.size()); ++index) {
                activeDestinationIndices[index] = index;
            }
        }

        if (activeDestinationIndices.empty() || activeSourceIndices.empty()) {
            return {std::move(result), dstReferenceWave};
        }

        std::atomic done{0};
        const int total = static_cast<int>(activeDestinationIndices.size());
        const auto progressStart = std::chrono::steady_clock::now();
        auto lastPrint = progressStart;

#pragma omp parallel
        {
            int localDone = 0;

#pragma omp for schedule(static)
            for (int destinationIdx = 0; destinationIdx < total; ++destinationIdx) {
                const int dstIndex = activeDestinationIndices[destinationIdx];
                const Vec3 position = dstSamplePositions[dstIndex];
                std::complex field(0.0, 0.0);
                const double dstReferencePathMm = referenceOpticalPathMm(dstReferenceWave, position);

                for (size_t sourceOffset = 0; sourceOffset < activeSourceIndices.size(); ++sourceOffset) {
                    const int srcIndex = activeSourceIndices[sourceOffset];
                    const Vec3 srcPosition = srcSamplePositions[srcIndex];
                    const Vec3 ray = position - srcPosition;
                    const double distance = glm::length(ray);
                    if (distance <= 0.0) {
                        continue;
                    }

                    const Vec3 direction = ray / static_cast<float>(distance);
                    const double cosTheta = std::max(
                        0.0,
                        static_cast<double>(glm::dot(srcPlane.basePlane().normal, direction))
                    );

                    const double phase = waveNumber * (
                                             distance
                                             + activeSourceReferencePathsMm[sourceOffset]
                                             - dstReferencePathMm
                                         );
                    const std::complex propagation(std::cos(phase), std::sin(phase));

                    field += static_cast<std::complex<double>>(sourceField.samples[srcIndex])
                            * rayleighSommerfeldPrefactor
                            * (propagation / distance)
                            * cosTheta
                            * deltaArea;
                }

                result[dstIndex] = static_cast<std::complex<float>>(field);

                ++localDone;
                if (constexpr int progressBatch = 256; localDone >= progressBatch) {
                    const int current = done.fetch_add(localDone) + localDone;
                    localDone = 0;

                    if (current % 4096 == 0 || current >= total) {
#pragma omp critical
                        {
                            if (const auto now = std::chrono::steady_clock::now();
                                now - lastPrint > std::chrono::seconds(1) || current >= total) {
                                const double elapsed = std::chrono::duration<double>(now - progressStart).count();
                                const double percent =
                                        100.0 * static_cast<double>(current) / static_cast<double>(total);
                                const double rate = current / elapsed;
                                const double remaining = rate > 0.0 ? (total - current) / rate : 0.0;

                                std::cerr << "\rProgress: "
                                        << current << "/" << total
                                        << " (" << percent << "%)"
                                        << " ETA: " << remaining << "s"
                                        << std::flush;

                                lastPrint = now;
                            }
                        }
                    }
                }
            }

            if (localDone > 0) {
                done.fetch_add(localDone);
            }
        }

        std::cerr << "\n";

        return {std::move(result), dstReferenceWave};
    }

    EnvelopeField propagateBetweenPlanes(
        const SampledPlane &srcPlane,
        const SampledPlane &dstPlane,
        const float wavelengthNm,
        const EnvelopeField &sourceField,
        const ReferenceWave &dstReferenceWave,
        const std::vector<uint8_t> *dstMask,
        const int zeroPaddingFactor,
        const int spectralPaddingFactor
    ) {
        return propagateBetweenPlanes(
            srcPlane,
            dstPlane,
            wavelengthNm,
            sourceField,
            dstReferenceWave,
            dstMask
        );
    }

    EnvelopeField propagateFFBetweenPlanes(
        const SampledPlane &srcPlane,
        const SampledPlane &dstPlane,
        const float wavelengthNm,
        const EnvelopeField &sourceField,
        const ReferenceWave &dstReferenceWave,
        const std::vector<uint8_t> *dstMask,
        const int zeroPaddingFactor,
        const int spectralPaddingFactor
    ) {
        std::vector<std::complex<float> > result(dstPlane.width() * dstPlane.height());

        const double wavelengthMm = wavelengthNm * 1e-6;
        const double waveNumber = 2.0 * kPi / wavelengthMm;
        // const double deltaArea = srcPlane.pixelSizeMm() * srcPlane.pixelSizeMm();

        float maxNormSource = 0.0f;
        for (const auto &sample: sourceField.samples) {
            maxNormSource = std::max(maxNormSource, std::norm(sample));
        }
        // const float epsilon = 1e-6f * maxNormSource;

        // hier muss die magie passieren

        const int srcWidth = srcPlane.width();
        const int srcHeight = srcPlane.height();
        const int dstWidth = dstPlane.width();
        const int dstHeight = dstPlane.height();
        const int paddingFactor = std::max(1, zeroPaddingFactor);
        const int fftWidth = srcWidth * paddingFactor;
        const int fftHeight = srcHeight * paddingFactor;
        const int fftSampleCount = fftWidth * fftHeight;
        const int srcColOffset = (fftWidth - srcWidth) / 2;
        const int srcRowOffset = (fftHeight - srcHeight) / 2;
        const int spectralFactor = std::max(1, spectralPaddingFactor);

        fftwf_complex *fftIn = fftwf_alloc_complex(fftSampleCount);
        fftwf_complex *fftOut = fftwf_alloc_complex(fftSampleCount);

        if (fftIn == nullptr || fftOut == nullptr) {
            fftwf_free(fftIn);
            fftwf_free(fftOut);
            throw std::bad_alloc();
        }

        for (int idx = 0; idx < fftSampleCount; ++idx) {
            fftIn[idx][0] = 0.0f;
            fftIn[idx][1] = 0.0f;
        }

        for (int row = 0; row < srcHeight; ++row) {
            for (int col = 0; col < srcWidth; ++col) {
                const int srcIdx = row * srcWidth + col;
                const int fftIdx = (row + srcRowOffset) * fftWidth + (col + srcColOffset);

                const double lRefSrc = referenceOpticalPathMm(
                    sourceField.referenceWave,
                    srcPlane.samplePosition(row, col)
                );

                const auto phi = static_cast<float>(waveNumber * lRefSrc);
                const std::complex refPhase(std::cos(phi), std::sin(phi));
                const std::complex uSrc = sourceField.samples[srcIdx] * refPhase;

                fftIn[fftIdx][0] = uSrc.real();
                fftIn[fftIdx][1] = uSrc.imag();
            }
        }

        const auto magie = fftwf_plan_dft_2d(
            fftHeight,
            fftWidth,
            fftIn,
            fftOut,
            FFTW_FORWARD,
            FFTW_ESTIMATE
        );

        fftwf_execute(magie);
        fftwf_destroy_plan(magie);

        const int Nx = fftWidth;
        const int Ny = fftHeight;
        const float dx = srcPlane.pixelSizeMm();
        const float dy = srcPlane.pixelSizeMm();

        const double z = glm::dot(
            glm::dvec3(dstPlane.basePlane().center - srcPlane.basePlane().center),
            glm::dvec3(srcPlane.basePlane().normal)
        );

        for (int row = 0; row < Ny; ++row) {
            const int my = (row <= Ny / 2) ? row : row - Ny;
            const float fy = static_cast<float>(my) / (static_cast<float>(Ny) * dy);
            const double ky = 2.0 * kPi * fy;

            for (int col = 0; col < Nx; ++col) {
                const int mx = (col <= Nx / 2) ? col : col - Nx;
                const float fx = static_cast<float>(mx) / (static_cast<float>(Nx) * dx);
                const double kx = 2.0 * kPi * fx;
                const double kz2 = waveNumber * waveNumber - kx * kx - ky * ky;

                const int idx = row * fftWidth + col;
                std::complex A(fftOut[idx][0], fftOut[idx][1]);

                if (kz2 > 0.0) {
                    const double kz = std::sqrt(kz2);
                    const auto phi = static_cast<float>(kz * z);
                    const std::complex H(std::cos(phi), std::sin(phi));
                    std::complex PropagatedA = A * H;
                    fftIn[idx][0] = PropagatedA.real();
                    fftIn[idx][1] = PropagatedA.imag();
                } else {
                    fftIn[idx][0] = 0.0;
                    fftIn[idx][1] = 0.0;
                }
            }
        }

        // Inverse FFT input/output, normally reuse existing buffers.
        fftwf_complex *i_fftIn = fftIn;
        fftwf_complex *i_fftOut = fftOut;
        fftwf_complex *fftPaddedIn = nullptr;
        fftwf_complex *fftPaddedOut = nullptr;

        int i_fftWidth = fftWidth;
        int i_fftHeight = fftHeight;

        // Spectral Padding
        if (spectralFactor > 1) {
            i_fftWidth = fftWidth * spectralFactor;
            i_fftHeight = fftHeight * spectralFactor;
            int i_fftSampleCount = i_fftWidth * i_fftHeight;

            fftPaddedIn = fftwf_alloc_complex(i_fftSampleCount);
            fftPaddedOut = fftwf_alloc_complex(i_fftSampleCount);

            if (fftPaddedIn == nullptr || fftPaddedOut == nullptr) {
                fftwf_free(fftPaddedIn);
                fftwf_free(fftPaddedOut);
                fftwf_free(fftIn);
                fftwf_free(fftOut);
                throw std::bad_alloc();
            }

            for (int idx = 0; idx < i_fftSampleCount; ++idx) {
                fftPaddedIn[idx][0] = 0.0f;
                fftPaddedIn[idx][1] = 0.0f;
            }

            for (int row = 0; row < fftHeight; ++row) {
                const int my = row <= fftHeight / 2 ? row : row - fftHeight;
                const int paddedRow = my >= 0 ? my : i_fftHeight + my;

                for (int col = 0; col < fftWidth; ++col) {
                    const int mx = col <= fftWidth / 2 ? col : col - fftWidth;
                    const int paddedCol = mx >= 0 ? mx : i_fftWidth + mx;

                    const int srcIdx = row * fftWidth + col;
                    const int paddedIdx = paddedRow * i_fftWidth + paddedCol;

                    fftPaddedIn[paddedIdx][0] = fftIn[srcIdx][0];
                    fftPaddedIn[paddedIdx][1] = fftIn[srcIdx][1];
                }
            }

            i_fftIn = fftPaddedIn;
            i_fftOut = fftPaddedOut;
        }

        if (dstWidth > i_fftWidth || dstHeight > i_fftHeight) {
            fftwf_free(fftPaddedIn);
            fftwf_free(fftPaddedOut);
            fftwf_free(fftIn);
            fftwf_free(fftOut);
            throw std::invalid_argument("FFT propagation target plane does not fit into the padded FFT window.");
        }

        const auto inversMagie = fftwf_plan_dft_2d(
            i_fftHeight,
            i_fftWidth,
            i_fftIn,
            i_fftOut,
            FFTW_BACKWARD,
            FFTW_ESTIMATE
        );

        fftwf_execute(inversMagie);
        fftwf_destroy_plan(inversMagie);

        const float invFftSampleCount = 1.0f / static_cast<float>(fftSampleCount);
        const float outputPixelSizeMm = srcPlane.pixelSizeMm() / static_cast<float>(spectralFactor);
        const Vec3 outputCenter = srcPlane.basePlane().center + static_cast<float>(z) * srcPlane.basePlane().normal;
        const double outputCenterCol = static_cast<double>(i_fftWidth - 1) * 0.5;
        const double outputCenterRow = static_cast<double>(i_fftHeight - 1) * 0.5;

        for (int row = 0; row < dstHeight; ++row) {
            for (int col = 0; col < dstWidth; ++col) {
                const int idx = row * dstWidth + col;

                if (dstMask != nullptr && (*dstMask)[idx] == 0) {
                    result[idx] = {0.0f, 0.0f};
                    continue;
                }

                const Vec3 dstPosition = dstPlane.samplePosition(row, col);
                const auto relative = glm::dvec3(dstPosition - outputCenter);
                const double sampleCol = glm::dot(relative, glm::dvec3(srcPlane.basePlane().right)) /
                                         static_cast<double>(outputPixelSizeMm) + outputCenterCol;
                const double sampleRow = glm::dot(relative, glm::dvec3(srcPlane.basePlane().up)) /
                                         static_cast<double>(outputPixelSizeMm) + outputCenterRow;

                const std::complex<float> uDst = sampleComplexBilinear(
                                                     i_fftOut,
                                                     i_fftWidth,
                                                     i_fftHeight,
                                                     sampleCol,
                                                     sampleRow
                                                 ) * invFftSampleCount;
                const double lRefDest = referenceOpticalPathMm(dstReferenceWave, dstPosition);
                const auto phiDst = static_cast<float>(waveNumber * lRefDest);
                result[idx] = uDst * std::exp(-kI * phiDst);
            }
        }

        fftwf_free(fftPaddedIn);
        fftwf_free(fftPaddedOut);
        fftwf_free(fftIn);
        fftwf_free(fftOut);

        return {std::move(result), dstReferenceWave};
    }
} // namespace wave
