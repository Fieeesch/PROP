@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "BUILD_TYPE=Release"
set "SKIP_CLIENT=0"
set "SKIP_2D=0"
set "SKIP_CUDA=0"
set "START_AFTER_BUILD=0"
set "INSTALL_CLIENT=auto"

:parse_args
if "%~1"=="" goto after_args
if /I "%~1"=="--help" goto help
if /I "%~1"=="-h" goto help
if /I "%~1"=="--skip-client" set "SKIP_CLIENT=1" & shift & goto parse_args
if /I "%~1"=="--skip-2d" set "SKIP_2D=1" & shift & goto parse_args
if /I "%~1"=="--skip-cuda" set "SKIP_CUDA=1" & shift & goto parse_args
if /I "%~1"=="--no-client-install" set "INSTALL_CLIENT=never" & shift & goto parse_args
if /I "%~1"=="--start" set "START_AFTER_BUILD=1" & shift & goto parse_args
if /I "%~1"=="--debug" set "BUILD_TYPE=Debug" & shift & goto parse_args
echo [build] Unknown argument: %~1
echo [build] Use --help for usage.
exit /b 2

:after_args
call :find_tools || exit /b 1

echo [build] Root: %ROOT%
echo [build] Build type: %BUILD_TYPE%
echo [build] VC environment: %VS_VCVARS%
echo [build] Ninja: %NINJA_EXE%
echo [build] vcpkg toolchain: %VCPKG_TOOLCHAIN%
echo.

call "%VS_VCVARS%" || exit /b 1

if "%SKIP_CLIENT%"=="0" call :build_client || exit /b 1
if "%SKIP_2D%"=="0" call :build_2d || exit /b 1
if "%SKIP_CUDA%"=="0" call :build_cuda || exit /b 1

echo.
echo [build] All requested targets built successfully.

if "%START_AFTER_BUILD%"=="1" (
  echo [build] Starting project stack...
  call "%ROOT%start_all.cmd"
)

exit /b 0

:help
echo Usage: build_all.cmd [options]
echo.
echo Options:
echo   --skip-client        Do not build the Vue/Vite client
echo   --skip-2d            Do not build prism\2Drenderer
echo   --skip-cuda          Do not build prism\CUDA-Spectral-Pathtracer
echo   --no-client-install  Do not run npm ci/install when node_modules is missing
echo   --debug              Build native CMake targets as Debug instead of Release
echo   --start              Run start_all.cmd after a successful build
echo   --help               Show this help
echo.
echo Environment overrides:
echo   VS_VCVARS            Path to vcvars64.bat
echo   NINJA_EXE            Path to ninja.exe
echo   VCPKG_ROOT           Path to a normal vcpkg checkout
echo   VCPKG_TOOLCHAIN      Path to vcpkg.cmake
exit /b 0

:find_tools
if not defined VS_VCVARS (
  if exist "%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
  if exist "%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not defined VS_VCVARS (
  if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" (
    for /f "usebackq delims=" %%I in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
      if exist "%%I\VC\Auxiliary\Build\vcvars64.bat" set "VS_VCVARS=%%I\VC\Auxiliary\Build\vcvars64.bat"
    )
  )
)
if not defined VS_VCVARS (
  echo [build] Could not find vcvars64.bat.
  echo [build] Install Visual Studio C++ Build Tools or set VS_VCVARS.
  exit /b 1
)

if not defined NINJA_EXE (
  if exist "%ProgramFiles%\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe" set "NINJA_EXE=%ProgramFiles%\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
)
if not defined NINJA_EXE (
  if exist "%ProgramFiles%\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe" set "NINJA_EXE=%ProgramFiles%\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
)
if not defined NINJA_EXE (
  for /f "delims=" %%I in ('where ninja.exe 2^>nul') do if not defined NINJA_EXE set "NINJA_EXE=%%I"
)
if not defined NINJA_EXE (
  echo [build] Could not find ninja.exe.
  echo [build] Install Ninja or set NINJA_EXE.
  exit /b 1
)

if not defined VCPKG_TOOLCHAIN (
  if defined VCPKG_ROOT if exist "%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" set "VCPKG_TOOLCHAIN=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
)
if not defined VCPKG_TOOLCHAIN (
  if exist "%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\vcpkg\scripts\buildsystems\vcpkg.cmake" set "VCPKG_TOOLCHAIN=%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\vcpkg\scripts\buildsystems\vcpkg.cmake"
)
if not defined VCPKG_TOOLCHAIN (
  if exist "%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\vcpkg\scripts\buildsystems\vcpkg.cmake" set "VCPKG_TOOLCHAIN=%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\vcpkg\scripts\buildsystems\vcpkg.cmake"
)
if not defined VCPKG_TOOLCHAIN (
  echo [build] Could not find vcpkg.cmake.
  echo [build] Install vcpkg and set VCPKG_ROOT or VCPKG_TOOLCHAIN.
  exit /b 1
)

exit /b 0

:build_client
echo.
echo [build] Building client...
pushd "%ROOT%Client" || exit /b 1
if not exist node_modules (
  if "%INSTALL_CLIENT%"=="never" (
    echo [build] Client node_modules is missing. Run npm.cmd ci or remove --no-client-install.
    popd
    exit /b 1
  )
  if exist package-lock.json (
    call npm.cmd ci || (popd & exit /b 1)
  ) else (
    call npm.cmd install || (popd & exit /b 1)
  )
)
call npm.cmd run build || (popd & exit /b 1)
popd
exit /b 0

:build_2d
echo.
echo [build] Building 2D renderer...
pushd "%ROOT%prism\2Drenderer" || exit /b 1
call :prepare_cmake_build_dir "cmake-build-release" || (popd & exit /b 1)
cmake -S . -B cmake-build-release -G Ninja -DCMAKE_BUILD_TYPE=%BUILD_TYPE% -DCMAKE_C_COMPILER=cl.exe -DCMAKE_CXX_COMPILER=cl.exe -DCMAKE_MAKE_PROGRAM="%NINJA_EXE%" -DCMAKE_TOOLCHAIN_FILE="%VCPKG_TOOLCHAIN%" || (popd & exit /b 1)
cmake --build cmake-build-release --config %BUILD_TYPE% || (popd & exit /b 1)
popd
exit /b 0

:build_cuda
echo.
echo [build] Building CUDA spectral pathtracer...
pushd "%ROOT%prism\CUDA-Spectral-Pathtracer" || exit /b 1
call :prepare_cmake_build_dir "out\build\x64-release" || (popd & exit /b 1)
cmake -S . -B out\build\x64-release -G Ninja -DCMAKE_BUILD_TYPE=%BUILD_TYPE% -DCMAKE_C_COMPILER=cl.exe -DCMAKE_CXX_COMPILER=cl.exe -DCMAKE_MAKE_PROGRAM="%NINJA_EXE%" -DCMAKE_TOOLCHAIN_FILE="%VCPKG_TOOLCHAIN%" -DBUILD_TESTING=OFF || (popd & exit /b 1)
cmake --build out\build\x64-release --config %BUILD_TYPE% || (popd & exit /b 1)
popd
exit /b 0

:prepare_cmake_build_dir
set "BUILD_DIR=%~1"
if not exist "%BUILD_DIR%\CMakeCache.txt" exit /b 0
findstr /C:"CMAKE_TOOLCHAIN_FILE:FILEPATH=" "%BUILD_DIR%\CMakeCache.txt" >nul 2>nul
if errorlevel 1 (
  echo [build] Existing CMake cache in %BUILD_DIR% was not configured with the vcpkg toolchain.
  echo [build] Recreating generated build directory %BUILD_DIR%.
  rmdir /s /q "%BUILD_DIR%" || exit /b 1
)
exit /b 0
