cmake_minimum_required(VERSION 3.20)

project(renderer_2d LANGUAGES CXX)

if(MSVC AND NOT CMAKE_CXX_COMPILE_FEATURES)
        set(CMAKE_CXX_COMPILE_FEATURES
                cxx_std_98
                cxx_std_11
                cxx_std_14
                cxx_std_17
                cxx_std_20
        )
endif()

find_package(glm CONFIG REQUIRED)
find_package(OpenMP REQUIRED)
include(CheckLanguage)

option(BUILD_SPD_PLOTTER "Build the optional SPD plotter" ON)
if(BUILD_SPD_PLOTTER)
        find_package(Matplot++ CONFIG REQUIRED)
endif()

if(WIN32 AND NOT CMAKE_CUDA_COMPILER)
        file(GLOB CUDA_TOOLKIT_CANDIDATES LIST_DIRECTORIES true
                "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v*"
        )
        list(SORT CUDA_TOOLKIT_CANDIDATES ORDER DESCENDING)
        foreach(CUDA_TOOLKIT_CANDIDATE IN LISTS CUDA_TOOLKIT_CANDIDATES)
                if(EXISTS "${CUDA_TOOLKIT_CANDIDATE}/bin/nvcc.exe")
                        set(CMAKE_CUDA_COMPILER "${CUDA_TOOLKIT_CANDIDATE}/bin/nvcc.exe" CACHE FILEPATH "CUDA compiler")
                        set(CUDAToolkit_ROOT "${CUDA_TOOLKIT_CANDIDATE}" CACHE PATH "CUDA toolkit root")
                        break()
                endif()
        endforeach()
endif()

check_language(CUDA)

set(RENDERER_2D_CUDA_SOURCES)
if(CMAKE_CUDA_COMPILER)
        enable_language(CUDA)
        set(CMAKE_CUDA_STANDARD 17)
        set(CMAKE_CUDA_STANDARD_REQUIRED ON)
        set(CMAKE_CUDA_ARCHITECTURES 75 86)
        find_package(CUDAToolkit REQUIRED)
        list(APPEND RENDERER_2D_CUDA_SOURCES
                raytracer_cuda.h
                raytracer_cuda.cu
        )
else()
        message(WARNING "CUDA compiler not found. renderer_2d will build with the CPU raytracer only.")
endif()

add_executable(renderer_2d
        main.cpp
        geometry.cpp
        geometry.h
        optics.h
        optics.cpp
        color.h
        color.cpp
        config.h
        spectrum.h
        spectrum.cpp
        raytracer.h
        raytracer.cpp
        ${RENDERER_2D_CUDA_SOURCES}
)

target_link_libraries(renderer_2d PRIVATE
        glm::glm
        OpenMP::OpenMP_CXX
)

if(MSVC)
        target_compile_options(renderer_2d PRIVATE $<$<COMPILE_LANGUAGE:CXX>:/std:c++20>)
else()
        target_compile_options(renderer_2d PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-std=c++20>)
endif()

if(CMAKE_CUDA_COMPILER)
        target_link_libraries(renderer_2d PRIVATE CUDA::cudart)
        target_compile_definitions(renderer_2d PRIVATE RENDERER_2D_WITH_CUDA=1)
        target_compile_options(renderer_2d PRIVATE
                $<$<COMPILE_LANGUAGE:CUDA>:--use_fast_math --expt-relaxed-constexpr>
        )
        set_target_properties(renderer_2d PROPERTIES
                CUDA_SEPARABLE_COMPILATION ON
        )

        if(WIN32)
                add_custom_command(
                        TARGET renderer_2d POST_BUILD
                        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                        $<TARGET_FILE:CUDA::cudart>
                        $<TARGET_FILE_DIR:renderer_2d>
                )
        endif()
endif()

if(BUILD_SPD_PLOTTER)
        add_executable(spd_plotter
                plotter_main.cpp
                spectrum_plotter.h
                spectrum_plotter.cpp
        )

        target_link_libraries(spd_plotter PRIVATE
                Matplot++::cimg
                Matplot++::matplot
        )

        if(MSVC)
                target_compile_options(spd_plotter PRIVATE $<$<COMPILE_LANGUAGE:CXX>:/std:c++20>)
        else()
                target_compile_options(spd_plotter PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-std=c++20>)
        endif()
endif()
