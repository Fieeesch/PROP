FROM ubuntu:24.04 AS build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        build-essential \
        cmake \
        libglm-dev \
        ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY prism/2Drenderer/ ./
RUN cmake -S . -B /build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SPD_PLOTTER=OFF \
    && cmake --build /build --target renderer_2d

FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    HOST=0.0.0.0 \
    PORT=8080 \
    RENDERER_EXE=/app/cmake-build-release/renderer_2d \
    SPD_PLOTTER_EXE=/app/bin/spd_plotter
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libgomp1 \
        nodejs \
        python3-matplotlib \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /build/renderer_2d ./cmake-build-release/renderer_2d
COPY prism/2Drenderer/server/ ./server/
COPY prism/2Drenderer/data/ ./data/
COPY prism/2Drenderer/main.cpp ./main.cpp
COPY docker/spd_plotter.py ./bin/spd_plotter
RUN chmod 755 ./bin/spd_plotter

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
