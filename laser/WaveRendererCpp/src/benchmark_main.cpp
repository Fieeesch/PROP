#include <algorithm>
#include <chrono>
#include <complex>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "wave/app/scene.hpp"
#include "wave/app/simulation_runner.hpp"

namespace {
    struct BenchmarkConfig {
        std::filesystem::path csvPath = "benchmark_results.csv";
        std::filesystem::path directReferenceImportPath = {};
        std::filesystem::path directReferenceExportPath = {};
        int firstLaserPreset = 1;
        int lastLaserPreset = 2;
        int firstSensorPreset = 1;
        int lastSensorPreset = 7;
    };

    struct Metrics {
        double relativeRMSE = 0.0;
        double meanAbs = 0.0;
        double maxAbs = 0.0;
        double correlation = 0.0;
    };

    struct GainMatchedMetrics {
        double gain = 1.0;
        double relativeRMSE = 0.0;
    };

    struct TimedOutput {
        wave::SimulationOutput output;
        long long elapsedMs = 0;
    };

    struct DirectReferenceData {
        long long elapsedMs = 0;
        std::vector<float> lensIntensity;
        std::vector<float> sensorFieldIntensity;
        std::vector<float> sensorImageIntensity;
    };

    struct RunRecord {
        int width = 0;
        int fftZeroPaddingFactor = 0;
        int laserPreset = 0;
        int sensorPreset = 0;
        long long directMs = 0;
        long long ffMs = 0;
        bool usedImportedReference = false;
        Metrics lensMetrics;
        Metrics sensorMetrics;
        Metrics imageMetrics;
        GainMatchedMetrics imageGainMatchedMetrics;
    };

    struct Summary {
        int successfulRuns = 0;
        int failedRuns = 0;
        double totalDirectMs = 0.0;
        double totalFfMs = 0.0;
        double totalLensRelativeRMSE = 0.0;
        double totalSensorRelativeRMSE = 0.0;
        double totalImageRelativeRMSE = 0.0;
        double totalImageCorrelation = 0.0;
        double totalImageGainMatchedRelativeRMSE = 0.0;
        double worstImageRelativeRMSE = 0.0;
        double worstImageCorrelation = 1.0;
        double worstImageGainMatchedRelativeRMSE = 0.0;
        int worstRMSELaserPreset = 0;
        int worstRMSESensorPreset = 0;
        int worstCorrelationLaserPreset = 0;
        int worstCorrelationSensorPreset = 0;
        int worstGainMatchedRMSELaserPreset = 0;
        int worstGainMatchedRMSESensorPreset = 0;
        int importedReferenceRuns = 0;
        int computedReferenceRuns = 0;
    };

    struct ReferenceFileHeader {
        std::uint32_t magic = 0;
        std::uint32_t version = 0;
        std::uint64_t recordCount = 0;
    };

    struct ReferenceRecordHeader {
        std::uint64_t configKey = 0;
        std::int64_t elapsedMs = 0;
        std::uint64_t lensCount = 0;
        std::uint64_t sensorFieldCount = 0;
        std::uint64_t sensorImageCount = 0;
    };

    constexpr std::uint32_t kReferenceFileMagic = 0x57425246u;
    constexpr std::uint32_t kReferenceFileVersion = 1u;

    template<typename T>
    void writeBinary(std::ostream &stream, const T &value) {
        stream.write(reinterpret_cast<const char *>(&value), static_cast<std::streamsize>(sizeof(T)));
    }

    template<typename T>
    [[nodiscard]] bool readBinary(std::istream &stream, T &value) {
        stream.read(reinterpret_cast<char *>(&value), static_cast<std::streamsize>(sizeof(T)));
        return static_cast<bool>(stream);
    }

    void writeFloatVector(std::ostream &stream, const std::vector<float> &values) {
        if (!values.empty()) {
            stream.write(
                reinterpret_cast<const char *>(values.data()),
                static_cast<std::streamsize>(values.size() * sizeof(float))
            );
        }
    }

    [[nodiscard]] bool readFloatVector(std::istream &stream, std::vector<float> &values, const std::uint64_t count) {
        if (count > static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
            return false;
        }

        values.resize(static_cast<std::size_t>(count));
        if (!values.empty()) {
            stream.read(
                reinterpret_cast<char *>(values.data()),
                static_cast<std::streamsize>(values.size() * sizeof(float))
            );
        }
        return static_cast<bool>(stream);
    }

    [[nodiscard]] std::uint64_t fnv1a64(const std::string &text) {
        std::uint64_t hash = 14695981039346656037ull;
        for (const unsigned char byte: text) {
            hash ^= static_cast<std::uint64_t>(byte);
            hash *= 1099511628211ull;
        }
        return hash;
    }

    void appendFloat(std::ostringstream &stream, const float value) {
        stream << value << ';';
    }

    void appendInt(std::ostringstream &stream, const int value) {
        stream << value << ';';
    }

    void appendBool(std::ostringstream &stream, const bool value) {
        stream << (value ? 1 : 0) << ';';
    }

    void appendVec3(std::ostringstream &stream, const wave::Vec3 &value) {
        appendFloat(stream, value.x);
        appendFloat(stream, value.y);
        appendFloat(stream, value.z);
    }

    void appendPlane(std::ostringstream &stream, const wave::Plane &plane) {
        appendVec3(stream, plane.center);
        appendVec3(stream, plane.normal);
        appendFloat(stream, plane.distance);
        appendVec3(stream, plane.right);
        appendVec3(stream, plane.up);
    }

    [[nodiscard]] std::uint64_t referenceConfigKey(const wave::SimulationConfig &config) {
        std::ostringstream stream;
        stream.setf(std::ios::scientific, std::ios::floatfield);
        stream.precision(9);

        appendInt(stream, config.width);
        appendInt(stream, config.height);
        appendInt(stream, config.wallFactor);
        appendInt(stream, config.lensFactor);
        appendInt(stream, config.sensorFactor);
        appendInt(stream, config.sensorSupersampleFactor);
        appendFloat(stream, config.laserRadiusMm);
        appendFloat(stream, config.lensApertureRadiusMm);
        appendFloat(stream, config.planeWidthMm);
        appendFloat(stream, config.lensFocalLengthMm);
        appendFloat(stream, config.laserWavelengthNm);
        appendFloat(stream, config.laserAmplitudeVm);
        stream << config.baseSeed << ';';
        appendInt(stream, config.laserPreset);
        appendInt(stream, config.sensorPreset);
        appendBool(stream, config.customSensorAutoFocus);
        appendPlane(stream, config.wallPlane);
        appendPlane(stream, config.lensPlane);
        appendPlane(stream, config.customLaserPlane);
        appendPlane(stream, config.customSensorPlane);
        appendPlane(stream, config.resolvedLaserPlane());
        appendPlane(stream, config.resolvedSensorPlane());
        appendBool(stream, config.resolvedSensorAutoFocus());

        return fnv1a64(stream.str());
    }

    [[nodiscard]] std::vector<float> intensityOf(const std::vector<std::complex<float> > &field) {
        std::vector<float> intensity(field.size());
        for (std::size_t index = 0; index < field.size(); ++index) {
            intensity[index] = std::norm(field[index]);
        }
        return intensity;
    }

    [[nodiscard]] DirectReferenceData makeDirectReferenceData(const TimedOutput &direct) {
        return {
            direct.elapsedMs,
            intensityOf(direct.output.propagationRun.lensInputField.samples),
            intensityOf(direct.output.propagationRun.sensorField.samples),
            direct.output.sensorIntensity
        };
    }

    void validateDirectReference(
        const DirectReferenceData &reference,
        const wave::SimulationOutput &ffOutput,
        const int laserPreset,
        const int sensorPreset
    ) {
        const auto lensCount = ffOutput.propagationRun.lensInputField.samples.size();
        const auto sensorFieldCount = ffOutput.propagationRun.sensorField.samples.size();

        if (const auto sensorImageCount = ffOutput.sensorIntensity.size(); reference.lensIntensity.size() != lensCount
                                                                           || reference.sensorFieldIntensity.size() !=
                                                                           sensorFieldCount
                                                                           || reference.sensorImageIntensity.size() !=
                                                                           sensorImageCount) {
            throw std::runtime_error(
                "direct reference shape mismatch for laser="
                + std::to_string(laserPreset)
                + ", sensor="
                + std::to_string(sensorPreset)
            );
        }
    }

    [[nodiscard]] std::map<std::uint64_t, DirectReferenceData> loadDirectReferenceFile(
        const std::filesystem::path &path
    ) {
        std::map<std::uint64_t, DirectReferenceData> references;
        if (path.empty()) {
            return references;
        }

        std::ifstream stream(path, std::ios::binary);
        if (!stream) {
            throw std::runtime_error("failed to open direct reference import file: " + path.string());
        }

        ReferenceFileHeader fileHeader;
        if (!readBinary(stream, fileHeader)
            || fileHeader.magic != kReferenceFileMagic
            || fileHeader.version != kReferenceFileVersion) {
            throw std::runtime_error("invalid direct reference file: " + path.string());
        }

        for (std::uint64_t index = 0; index < fileHeader.recordCount; ++index) {
            ReferenceRecordHeader recordHeader;
            if (!readBinary(stream, recordHeader)) {
                throw std::runtime_error("truncated direct reference file: " + path.string());
            }

            DirectReferenceData data;
            data.elapsedMs = recordHeader.elapsedMs;
            if (!readFloatVector(stream, data.lensIntensity, recordHeader.lensCount)
                || !readFloatVector(stream, data.sensorFieldIntensity, recordHeader.sensorFieldCount)
                || !readFloatVector(stream, data.sensorImageIntensity, recordHeader.sensorImageCount)) {
                throw std::runtime_error("truncated direct reference payload: " + path.string());
            }

            references[recordHeader.configKey] = std::move(data);
        }

        return references;
    }

    void writeDirectReferenceFile(
        const std::filesystem::path &path,
        const std::map<std::uint64_t, DirectReferenceData> &references
    ) {
        if (path.empty()) {
            return;
        }

        if (!path.parent_path().empty()) {
            std::filesystem::create_directories(path.parent_path());
        }

        std::ofstream stream(path, std::ios::binary);
        if (!stream) {
            throw std::runtime_error("failed to open direct reference export file: " + path.string());
        }

        writeBinary(stream, ReferenceFileHeader{
                        kReferenceFileMagic,
                        kReferenceFileVersion,
                        static_cast<std::uint64_t>(references.size())
                    });

        for (const auto &[configKey, data]: references) {
            writeBinary(stream, ReferenceRecordHeader{
                            configKey,
                            data.elapsedMs,
                            static_cast<std::uint64_t>(data.lensIntensity.size()),
                            static_cast<std::uint64_t>(data.sensorFieldIntensity.size()),
                            static_cast<std::uint64_t>(data.sensorImageIntensity.size())
                        });
            writeFloatVector(stream, data.lensIntensity);
            writeFloatVector(stream, data.sensorFieldIntensity);
            writeFloatVector(stream, data.sensorImageIntensity);
        }

        if (!stream) {
            throw std::runtime_error("failed while writing direct reference export file: " + path.string());
        }
    }

    [[nodiscard]] Metrics compareSignals(const std::vector<float> &reference, const std::vector<float> &candidate) {
        Metrics metrics;
        if (reference.empty() || reference.size() != candidate.size()) {
            return metrics;
        }

        double sumReferenceSquared = 0.0;
        double sumDiffSquared = 0.0;
        double sumAbsDiff = 0.0;
        double sumReference = 0.0;
        double sumCandidate = 0.0;

        for (std::size_t index = 0; index < reference.size(); ++index) {
            const double ref = reference[index];
            const double cdt = candidate[index];
            const double diff = cdt - ref;

            sumReferenceSquared += ref * ref;
            sumDiffSquared += diff * diff;
            sumAbsDiff += std::abs(diff);
            metrics.maxAbs = std::max(metrics.maxAbs, std::abs(diff));
            sumReference += ref;
            sumCandidate += cdt;
        }

        const auto count = static_cast<double>(reference.size());
        const double meanReference = sumReference / count;
        const double meanCandidate = sumCandidate / count;

        double covariance = 0.0;
        double referenceVariance = 0.0;
        double candidateVariance = 0.0;

        for (std::size_t index = 0; index < reference.size(); ++index) {
            const double refCentered = reference[index] - meanReference;
            const double cndCentered = candidate[index] - meanCandidate;
            covariance += refCentered * cndCentered;
            referenceVariance += refCentered * refCentered;
            candidateVariance += cndCentered * cndCentered;
        }

        metrics.relativeRMSE = sumReferenceSquared > 0.0
                                   ? std::sqrt(sumDiffSquared / sumReferenceSquared)
                                   : 0.0;
        metrics.meanAbs = sumAbsDiff / count;
        metrics.correlation = referenceVariance > 0.0 && candidateVariance > 0.0
                                  ? covariance / std::sqrt(referenceVariance * candidateVariance)
                                  : 0.0;

        return metrics;
    }

    [[nodiscard]] GainMatchedMetrics compareSignalsGainMatched(
        const std::vector<float> &reference,
        const std::vector<float> &candidate
    ) {
        GainMatchedMetrics metrics;
        if (reference.empty() || reference.size() != candidate.size()) {
            return metrics;
        }

        double numerator = 0.0;
        double denominator = 0.0;
        double referenceEnergy = 0.0;

        for (std::size_t index = 0; index < reference.size(); ++index) {
            const double ref = reference[index];
            const double cnd = candidate[index];
            numerator += ref * cnd;
            denominator += cnd * cnd;
            referenceEnergy += ref * ref;
        }

        metrics.gain = denominator > 0.0 ? numerator / denominator : 1.0;

        double sumDiffSquared = 0.0;
        for (std::size_t index = 0; index < reference.size(); ++index) {
            const double diff = metrics.gain * static_cast<double>(candidate[index]) - static_cast<double>(reference[
                                    index]);
            sumDiffSquared += diff * diff;
        }

        metrics.relativeRMSE = referenceEnergy > 0.0
                                   ? std::sqrt(sumDiffSquared / referenceEnergy)
                                   : 0.0;
        return metrics;
    }

    [[nodiscard]] TimedOutput runTimed(const wave::SimulationConfig &config, const wave::Scene &scene) {
        const wave::SimulationRunner runner(config);
        const auto start = std::chrono::steady_clock::now();
        auto output = runner.run(scene);
        const auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start
        ).count();
        return {std::move(output), elapsedMs};
    }

    [[nodiscard]] wave::SimulationConfig makeBenchmarkConfig() {
        const wave::SimulationConfig config = {};
        return config;
    }

    [[nodiscard]] BenchmarkConfig makeBenchmarkRunConfig() {
        BenchmarkConfig config;
        // Reuse a previously exported direct-reference bundle to skip the slow
        // direct integration for matching benchmark cases.
        //config.directReferenceImportPath =
        //        std::filesystem::path{"benchmark_direct_reference.bin"};

        // Export all direct references used in this run so they can be reused
        // in later benchmark runs.
        //config.directReferenceExportPath =
        //        std::filesystem::path{"benchmark_direct_reference.bin"};
        return config;
    }

    [[nodiscard]] const char *caseGroupForSensorPreset(const int sensorPreset) {
        switch (sensorPreset) {
            case 1:
            case 2:
            case 3:
            case 6:
                return "parallel_like";
            case 4:
            case 5:
            case 7:
                return "tilted_like";
            default:
                return "other";
        }
    }

    void writeCsvHeader(std::ostream &stream) {
        stream
                << "width,fft_zero_padding_factor,laser_preset,sensor_preset,case_group,"
                << "direct_reference_source,"
                << "direct_ms,ff_ms,"
                << "lens_rel_rmse,sensor_rel_rmse,image_rel_rmse,image_corr,"
                << "image_best_fit_gain,image_rel_rmse_gain_matched\n";
    }

    void writeCsvErrorRow(
        std::ostream &stream,
        const int benchmarkWidth,
        const int laserPreset,
        const int sensorPreset
    ) {
        stream
                << benchmarkWidth << ','
                << "ERROR" << ','
                << laserPreset << ','
                << sensorPreset << ','
                << caseGroupForSensorPreset(sensorPreset)
                << ",ERROR,ERROR,ERROR,ERROR,ERROR,ERROR,ERROR,ERROR,ERROR\n";
    }

    void writeCsvResultRow(std::ostream &stream, const RunRecord &record) {
        stream
                << record.width << ','
                << record.fftZeroPaddingFactor << ','
                << record.laserPreset << ','
                << record.sensorPreset << ','
                << caseGroupForSensorPreset(record.sensorPreset) << ','
                << (record.usedImportedReference ? "imported" : "computed") << ','
                << record.directMs << ','
                << record.ffMs << ','
                << record.lensMetrics.relativeRMSE << ','
                << record.sensorMetrics.relativeRMSE << ','
                << record.imageMetrics.relativeRMSE << ','
                << record.imageMetrics.correlation << ','
                << record.imageGainMatchedMetrics.gain << ','
                << record.imageGainMatchedMetrics.relativeRMSE << '\n';
    }

    void addRunToSummary(Summary &summary, const RunRecord &record) {
        ++summary.successfulRuns;
        summary.totalDirectMs += static_cast<double>(record.directMs);
        summary.totalFfMs += static_cast<double>(record.ffMs);
        summary.totalLensRelativeRMSE += record.lensMetrics.relativeRMSE;
        summary.totalSensorRelativeRMSE += record.sensorMetrics.relativeRMSE;
        summary.totalImageRelativeRMSE += record.imageMetrics.relativeRMSE;
        summary.totalImageCorrelation += record.imageMetrics.correlation;
        summary.totalImageGainMatchedRelativeRMSE += record.imageGainMatchedMetrics.relativeRMSE;
        if (record.usedImportedReference) {
            ++summary.importedReferenceRuns;
        } else {
            ++summary.computedReferenceRuns;
        }

        if (record.imageMetrics.relativeRMSE > summary.worstImageRelativeRMSE) {
            summary.worstImageRelativeRMSE = record.imageMetrics.relativeRMSE;
            summary.worstRMSELaserPreset = record.laserPreset;
            summary.worstRMSESensorPreset = record.sensorPreset;
        }

        if (record.imageMetrics.correlation < summary.worstImageCorrelation) {
            summary.worstImageCorrelation = record.imageMetrics.correlation;
            summary.worstCorrelationLaserPreset = record.laserPreset;
            summary.worstCorrelationSensorPreset = record.sensorPreset;
        }

        if (record.imageGainMatchedMetrics.relativeRMSE > summary.worstImageGainMatchedRelativeRMSE) {
            summary.worstImageGainMatchedRelativeRMSE = record.imageGainMatchedMetrics.relativeRMSE;
            summary.worstGainMatchedRMSELaserPreset = record.laserPreset;
            summary.worstGainMatchedRMSESensorPreset = record.sensorPreset;
        }
    }

    void printSummaryBlock(const Summary &summary, const std::string &label) {
        std::cout << label << '\n';
        std::cout << "successful_runs: " << summary.successfulRuns << '\n';
        std::cout << "failed_runs: " << summary.failedRuns << '\n';

        if (summary.successfulRuns == 0) {
            return;
        }

        std::cout << "direct_reference_imported_runs: " << summary.importedReferenceRuns << '\n';
        std::cout << "direct_reference_computed_runs: " << summary.computedReferenceRuns << '\n';

        const auto count = static_cast<double>(summary.successfulRuns);
        const double speedup = summary.totalFfMs > 0.0
                                   ? summary.totalDirectMs / summary.totalFfMs
                                   : std::numeric_limits<double>::infinity();

        std::cout << "total_direct_ms: " << summary.totalDirectMs << '\n';
        std::cout << "total_ff_ms: " << summary.totalFfMs << '\n';
        std::cout << "overall_speedup: " << speedup << "x\n";
        std::cout << "avg_lens_rel_rmse: " << summary.totalLensRelativeRMSE / count << '\n';
        std::cout << "avg_sensor_rel_rmse: " << summary.totalSensorRelativeRMSE / count << '\n';
        std::cout << "avg_image_rel_rmse: " << summary.totalImageRelativeRMSE / count << '\n';
        std::cout << "avg_image_rel_rmse_gain_matched: " << summary.totalImageGainMatchedRelativeRMSE / count << '\n';
        std::cout << "avg_image_corr: " << summary.totalImageCorrelation / count << '\n';
        std::cout << "worst_image_rel_rmse: " << summary.worstImageRelativeRMSE
                << " at laser=" << summary.worstRMSELaserPreset
                << ", sensor=" << summary.worstRMSESensorPreset << '\n';
        std::cout << "worst_image_rel_rmse_gain_matched: " << summary.worstImageGainMatchedRelativeRMSE
                << " at laser=" << summary.worstGainMatchedRMSELaserPreset
                << ", sensor=" << summary.worstGainMatchedRMSESensorPreset << '\n';
        std::cout << "worst_image_corr: " << summary.worstImageCorrelation
                << " at laser=" << summary.worstCorrelationLaserPreset
                << ", sensor=" << summary.worstCorrelationSensorPreset << '\n';
    }

    [[nodiscard]] std::string formatDouble(const double value, const int precision = 4) {
        std::ostringstream stream;
        stream.setf(std::ios::fixed, std::ios::floatfield);
        stream.precision(precision);
        stream << value;
        return stream.str();
    }

    [[nodiscard]] std::string lerpColor(const double t) {
        const double clamped = std::clamp(t, 0.0, 1.0);
        const auto red = static_cast<int>(std::round(217.0 * (1.0 - clamped) + 26.0 * clamped));
        const auto green = static_cast<int>(std::round(48.0 * (1.0 - clamped) + 152.0 * clamped));
        const auto blue = static_cast<int>(std::round(39.0 * (1.0 - clamped) + 80.0 * clamped));

        std::ostringstream stream;
        stream << "rgb(" << red << "," << green << "," << blue << ")";
        return stream.str();
    }

    template<typename ValueFn>
    void writeHeatmapSvg(
        const std::filesystem::path &path,
        const std::vector<RunRecord> &records,
        const std::string &title,
        const std::string &valueLabel,
        ValueFn valueFn,
        const bool lowerIsBetter
    ) {
        if (records.empty()) {
            return;
        }

        int maxLaserPreset = 0;
        int maxSensorPreset = 0;
        double minValue = std::numeric_limits<double>::infinity();
        double maxValue = -std::numeric_limits<double>::infinity();

        for (const auto &record: records) {
            maxLaserPreset = std::max(maxLaserPreset, record.laserPreset);
            maxSensorPreset = std::max(maxSensorPreset, record.sensorPreset);
            const double value = valueFn(record);
            minValue = std::min(minValue, value);
            maxValue = std::max(maxValue, value);
        }

        constexpr int cellWidth = 110;
        constexpr int cellHeight = 58;
        constexpr int leftMargin = 140;
        constexpr int topMargin = 112;
        constexpr int rightMargin = 40;
        constexpr int bottomMargin = 38;
        const int width = leftMargin + maxSensorPreset * cellWidth + rightMargin;
        const int height = topMargin + maxLaserPreset * cellHeight + bottomMargin;

        std::ofstream svg(path);
        if (!svg) {
            std::cerr << "failed to open SVG for writing: " << path.string() << '\n';
            return;
        }

        svg << R"(<svg xmlns="http://www.w3.org/2000/svg" width=")" << width
                << "\" height=\"" << height << "\" viewBox=\"0 0 " << width << ' ' << height << "\">\n";
        svg << "<rect width=\"100%\" height=\"100%\" fill=\"#fbfaf7\"/>\n";
        svg << "<text x=\"" << leftMargin <<
                R"(" y="36" font-size="24" font-family="Segoe UI, sans-serif" fill="#1f2933">)"
                << title << "</text>\n";
        svg << "<text x=\"" << leftMargin <<
                R"(" y="60" font-size="12" font-family="Segoe UI, sans-serif" fill="#52606d">)"
                << valueLabel << ", min=" << formatDouble(minValue) << ", max=" << formatDouble(maxValue) <<
                "</text>\n";

        for (int sensorPreset = 1; sensorPreset <= maxSensorPreset; ++sensorPreset) {
            const int x = leftMargin + (sensorPreset - 1) * cellWidth + cellWidth / 2;
            svg << "<text x=\"" << x << "\" y=\"" << topMargin - 18
                    << R"(" text-anchor="middle" font-size="14" font-family="Segoe UI, sans-serif" fill="#1f2933">S)"
                    << sensorPreset << "</text>\n";
        }

        for (int laserPreset = 1; laserPreset <= maxLaserPreset; ++laserPreset) {
            const int y = topMargin + (laserPreset - 1) * cellHeight + cellHeight / 2 + 5;
            svg << "<text x=\"" << leftMargin - 16 << "\" y=\"" << y
                    << R"(" text-anchor="end" font-size="14" font-family="Segoe UI, sans-serif" fill="#1f2933">L)"
                    << laserPreset << "</text>\n";
        }

        for (const auto &record: records) {
            const double value = valueFn(record);
            double normalized = maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0.5;
            if (lowerIsBetter) {
                normalized = 1.0 - normalized;
            }

            const int x = leftMargin + (record.sensorPreset - 1) * cellWidth;
            const int y = topMargin + (record.laserPreset - 1) * cellHeight;
            svg << "<rect x=\"" << x << "\" y=\"" << y << "\" width=\"" << (cellWidth - 6)
                    << "\" height=\"" << (cellHeight - 6) << R"(" rx="10" fill=")" << lerpColor(normalized)
                    << "\" stroke=\"#ffffff\" stroke-width=\"2\"/>\n";
            svg << "<text x=\"" << x + (cellWidth - 6) / 2 << "\" y=\"" << y + 24
                    << R"(" text-anchor="middle" font-size="16" font-family="Consolas, monospace" fill="#ffffff">)"
                    << formatDouble(value, 3) << "</text>\n";
            svg << "<text x=\"" << x + (cellWidth - 6) / 2 << "\" y=\"" << y + 42
                    << R"(" text-anchor="middle" font-size="10" font-family="Segoe UI, sans-serif" fill="#ecfdf3">)"
                    << caseGroupForSensorPreset(record.sensorPreset) << "</text>\n";
        }

        svg << "</svg>\n";
    }

    void writeVisualizationFiles(const std::filesystem::path &csvPath, const std::vector<RunRecord> &records) {
        if (records.empty()) {
            return;
        }

        const auto basePath = csvPath.parent_path() / csvPath.stem();
        writeHeatmapSvg(
            basePath.string() + "_image_corr.svg",
            records,
            "Image Correlation Heatmap",
            "Higher is better",
            [](const RunRecord &record) {
                return record.imageMetrics.correlation;
            },
            false
        );
        writeHeatmapSvg(
            basePath.string() + "_image_rmse.svg",
            records,
            "Image Relative RMSE Heatmap",
            "Lower is better",
            [](const RunRecord &record) {
                return record.imageMetrics.relativeRMSE;
            },
            true
        );
        writeHeatmapSvg(
            basePath.string() + "_image_rmse_gain_matched.svg",
            records,
            "Image Gain-Matched RMSE Heatmap",
            "Lower is better",
            [](const RunRecord &record) {
                return record.imageGainMatchedMetrics.relativeRMSE;
            },
            true
        );
    }

    void printSummary(
        const Summary &summary,
        const std::map<std::string, Summary> &groupSummaries,
        const std::filesystem::path &csvPath,
        const std::vector<RunRecord> &records,
        const BenchmarkConfig &benchmarkConfig
    ) {
        std::cout << "\nsummary\n";
        std::cout << "csv_file: " << csvPath.string() << '\n';
        std::cout << "fft_zero_padding_factor: "
                << (records.empty() ? 0 : records.front().fftZeroPaddingFactor) << '\n';
        if (!benchmarkConfig.directReferenceImportPath.empty()) {
            std::cout << "direct_reference_import: "
                    << benchmarkConfig.directReferenceImportPath.string() << '\n';
        }
        if (!benchmarkConfig.directReferenceExportPath.empty()) {
            std::cout << "direct_reference_export: "
                    << benchmarkConfig.directReferenceExportPath.string() << '\n';
        }
        printSummaryBlock(summary, "overall");

        for (const auto &[groupName, groupSummary]: groupSummaries) {
            std::cout << '\n';
            printSummaryBlock(groupSummary, groupName);
        }

        const auto basePath = csvPath.parent_path() / csvPath.stem();
        std::cout << "\nvisualizations\n";
        std::cout << "image_corr_heatmap: " << (basePath.string() + "_image_corr.svg") << '\n';
        std::cout << "image_rmse_heatmap: " << (basePath.string() + "_image_rmse.svg") << '\n';
        std::cout << "image_rmse_gain_matched_heatmap: "
                << (basePath.string() + "_image_rmse_gain_matched.svg") << '\n';
    }
} // namespace

int main() {
    const BenchmarkConfig benchmarkConfig = makeBenchmarkRunConfig();
    const std::filesystem::path csvPath = benchmarkConfig.csvPath;

    std::ofstream csv(csvPath);
    if (!csv) {
        std::cerr << "failed to open benchmark CSV for writing: " << csvPath.string() << '\n';
        return 1;
    }

    Summary summary;
    std::map<std::string, Summary> groupSummaries;
    std::vector<RunRecord> records;
    std::map<std::uint64_t, DirectReferenceData> importedReferences;
    std::map<std::uint64_t, DirectReferenceData> exportedReferences;

    try {
        importedReferences = loadDirectReferenceFile(benchmarkConfig.directReferenceImportPath);
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }

    writeCsvHeader(csv);

    for (int laserPreset = benchmarkConfig.firstLaserPreset;
         laserPreset <= benchmarkConfig.lastLaserPreset;
         ++laserPreset) {
        for (int sensorPreset = benchmarkConfig.firstSensorPreset;
             sensorPreset <= benchmarkConfig.lastSensorPreset;
             ++sensorPreset) {
            auto baseConfig = makeBenchmarkConfig();
            baseConfig.laserPreset = laserPreset;
            baseConfig.sensorPreset = sensorPreset;

            auto directConfig = baseConfig;
            directConfig.useFF = false;

            auto ffConfig = baseConfig;
            ffConfig.useFF = true;

            try {
                const wave::Scene scene(baseConfig);
                const std::uint64_t configKey = referenceConfigKey(baseConfig);

                std::cerr << "\nbenchmark laser=" << laserPreset
                        << " sensor=" << sensorPreset
                        << " width=" << baseConfig.width << "\n";

                auto [output, elapsedMs] = runTimed(ffConfig, scene);

                DirectReferenceData directReference;
                bool usedImportedReference = false;

                if (const auto it = importedReferences.find(configKey); it != importedReferences.end()) {
                    directReference = it->second;
                    usedImportedReference = true;
                } else {
                    auto direct = runTimed(directConfig, scene);
                    directReference = makeDirectReferenceData(direct);
                }

                validateDirectReference(directReference, output, laserPreset, sensorPreset);
                exportedReferences[configKey] = directReference;

                RunRecord record;
                record.width = baseConfig.width;
                record.fftZeroPaddingFactor = baseConfig.fftZeroPaddingFactor;
                record.laserPreset = laserPreset;
                record.sensorPreset = sensorPreset;
                record.directMs = directReference.elapsedMs;
                record.ffMs = elapsedMs;
                record.usedImportedReference = usedImportedReference;
                record.lensMetrics = compareSignals(
                    directReference.lensIntensity,
                    intensityOf(output.propagationRun.lensInputField.samples)
                );
                record.sensorMetrics = compareSignals(
                    directReference.sensorFieldIntensity,
                    intensityOf(output.propagationRun.sensorField.samples)
                );
                record.imageMetrics = compareSignals(
                    directReference.sensorImageIntensity,
                    output.sensorIntensity
                );
                record.imageGainMatchedMetrics = compareSignalsGainMatched(
                    directReference.sensorImageIntensity,
                    output.sensorIntensity
                );

                writeCsvResultRow(csv, record);
                addRunToSummary(summary, record);
                addRunToSummary(groupSummaries[caseGroupForSensorPreset(sensorPreset)], record);
                records.push_back(record);
            } catch (const std::exception &error) {
                std::cerr << "benchmark failed for laser=" << laserPreset
                        << " sensor=" << sensorPreset
                        << ": " << error.what() << '\n';
                writeCsvErrorRow(csv, baseConfig.width, laserPreset, sensorPreset);
                ++summary.failedRuns;
                ++groupSummaries[caseGroupForSensorPreset(sensorPreset)].failedRuns;
            }
        }
    }

    csv.close();
    try {
        writeDirectReferenceFile(benchmarkConfig.directReferenceExportPath, exportedReferences);
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    writeVisualizationFiles(csvPath, records);
    printSummary(summary, groupSummaries, csvPath, records, benchmarkConfig);
}
