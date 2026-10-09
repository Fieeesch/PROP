FROM nvidia/cuda:12.6.3-devel-ubuntu22.04 AS build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        cmake \
        ninja-build \
        nlohmann-json3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY prism/CUDA-Spectral-Pathtracer/ ./
RUN cmake -S . -B /build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_TESTING=OFF \
    && cmake --build /build --target PathtracerSpectralRealtime

FROM node:22-bookworm-slim AS node-runtime

FROM nvidia/cuda:12.6.3-runtime-ubuntu22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    HOST=0.0.0.0 \
    PORT=8091 \
    CUDA_RENDERER_EXE=/app/build/PathtracerSpectralRealtime

WORKDIR /app
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=build /build/PathtracerSpectralRealtime ./build/PathtracerSpectralRealtime
COPY prism/CUDA-Spectral-Pathtracer/server/ ./server/

EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('node:http').get('http://127.0.0.1:8091/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server/spectral_backend.js"]
