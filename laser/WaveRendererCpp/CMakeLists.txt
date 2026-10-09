cmake_minimum_required(VERSION 3.25)
project(WaveRendererCpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(glm CONFIG REQUIRED)
find_package(FFTW3f CONFIG QUIET)
if (FFTW3f_FOUND)
    set(FFTW3F_TARGET FFTW3::fftw3f)
else ()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(FFTW3f REQUIRED IMPORTED_TARGET fftw3f)
    set(FFTW3F_TARGET PkgConfig::FFTW3f)
endif ()
find_package(OpenMP REQUIRED COMPONENTS CXX)

set(WAVE_RENDERER_COMMON_SOURCES
        src/app/scene.cpp
        src/app/simulation_runner.cpp
        src/core/plane.cpp
        src/core/reference_wave.cpp
        src/core/sampled_plane.cpp
        src/elements/diffuse_wall.cpp
        src/elements/lens.cpp
        src/elements/sensor.cpp
        src/io/field_debug_writer.cpp
        src/io/ppm_writer.cpp
        src/optics/focus.cpp
        src/postprocess/field_ops.cpp
        src/postprocess/resampling.cpp
        src/propagation/plane_propagator.cpp
)

add_executable(WaveRendererCpp
        src/main.cpp
        ${WAVE_RENDERER_COMMON_SOURCES}
)

add_executable(WaveRendererBenchmark
        src/benchmark_main.cpp
        ${WAVE_RENDERER_COMMON_SOURCES}
)

foreach (target WaveRendererCpp WaveRendererBenchmark)
    target_include_directories(${target}
            PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/include
    )

    target_link_libraries(${target}
            PRIVATE
            glm::glm
            ${FFTW3F_TARGET}
            OpenMP::OpenMP_CXX
    )

    target_compile_definitions(${target}
            PRIVATE
            $<$<CONFIG:Release>:NDEBUG>
    )

    target_compile_options(${target}
            PRIVATE
            $<$<AND:$<CONFIG:Release>,$<CXX_COMPILER_ID:MSVC>>:/O2 /fp:fast /GL /arch:AVX2>
            $<$<AND:$<CONFIG:Release>,$<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>>>:-O3 -march=native -ffast-math -flto>
    )

    target_link_options(${target}
            PRIVATE
            $<$<AND:$<CONFIG:Release>,$<CXX_COMPILER_ID:MSVC>>:/LTCG>
            $<$<AND:$<CONFIG:Release>,$<OR:$<CXX_COMPILER_ID:GNU>,$<CXX_COMPILER_ID:Clang>>>:-flto>
    )
endforeach ()
