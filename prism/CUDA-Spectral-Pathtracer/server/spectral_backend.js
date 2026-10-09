const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
const defaultExecutable = process.platform === "win32"
  ? path.join(root, "out", "build", "x64-release", "PathtracerSpectralRealtime.exe")
  : path.join(root, "build", "PathtracerSpectralRealtime");
const renderers = new Map([
  ["cuda", process.env.CUDA_RENDERER_EXE || defaultExecutable],
]);
const port = Number(process.env.PORT || 8091);
const host = process.env.HOST || "127.0.0.1";

function reply(response, status, body, contentType = "text/plain", extraHeaders = {}) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Render-Duration-Ms",
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function jsonError(response, status, message) {
  reply(response, status, JSON.stringify({ error: message }), "application/json");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 12_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function assertSceneShape(scene) {
  if (!scene || typeof scene !== "object" || !Array.isArray(scene.objects)) {
    throw new Error("Scene must be an object with an objects array.");
  }
  if (!scene.objects.some((object) => object.objectType === "Camera")) {
    throw new Error("Scene must contain one Camera object.");
  }
  if (!scene.objects.some((object) => ["Sphere", "Rectangle", "TriangularPrism", "Box", "ObjMesh"].includes(object.objectType))) {
    throw new Error("Scene must contain at least one renderable object.");
  }
}

function findSpectralRenderSettings(scene) {
  return scene.objects.find((object) =>
    object
    && typeof object === "object"
    && object.objectType === "SpectralRenderSettings"
    && object.properties
    && typeof object.properties === "object"
  );
}

function requestedBackend(scene) {
  const settings = findSpectralRenderSettings(scene);
  const value = scene.backend
    ?? scene.renderer
    ?? settings?.properties?.backend
    ?? settings?.properties?.renderer;

  if (value === undefined || value === null || value === "") {
    return "cuda";
  }
  if (typeof value !== "string") {
    throw new Error("Renderer backend must be a string.");
  }
  return value.trim().toLowerCase();
}

function selectRenderer(scene) {
  const backend = requestedBackend(scene);
  const executable = renderers.get(backend);
  if (!executable) {
    throw new Error(`Unknown renderer backend "${backend}". Available backends: ${[...renderers.keys()].join(", ")}.`);
  }
  return { backend, executable };
}

async function handleRender(request, response) {
  let directory;
  try {
    const body = await readBody(request);
    const scene = JSON.parse(body);
    assertSceneShape(scene);
    const selectedRenderer = selectRenderer(scene);

    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cuda-spectral-"));
    const sceneFile = path.join(directory, "scene.json");
    const outputFile = path.join(directory, "render.ppm");
    await fs.writeFile(sceneFile, JSON.stringify(scene, null, 2));

    const renderStart = process.hrtime.bigint();
    await fs.access(selectedRenderer.executable);
    await run(selectedRenderer.executable, ["--scene-file", sceneFile, "--output", outputFile], {
      cwd: root,
      timeout: Number(process.env.CUDA_RENDER_TIMEOUT_MS || 600_000),
      maxBuffer: 16 * 1024 * 1024,
    });
    const renderDurationMs = Number(process.hrtime.bigint() - renderStart) / 1_000_000;

    const image = await fs.readFile(outputFile);
    await fs.writeFile(path.join(root, "recentRendering.ppm"), image);
    reply(response, 200, image, "image/x-portable-pixmap", {
      "X-Render-Duration-Ms": renderDurationMs.toFixed(2),
      "X-Renderer-Backend": selectedRenderer.backend,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("must") || message.includes("invalid") || message.includes("Unknown renderer backend") || error instanceof SyntaxError ? 400 : 500;
    jsonError(response, status, message);
  } finally {
    if (directory) {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

async function start() {
  await fs.access(renderers.get("cuda"));
  http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      reply(response, 204, "");
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      reply(response, 200, "ok");
      return;
    }
    if (request.method !== "POST" || request.url !== "/render") {
      reply(response, 404, "Not found");
      return;
    }
    handleRender(request, response);
  }).listen(port, host, () => {
    console.log(`CUDA spectral backend listening on http://${host}:${port}/render`);
    for (const [backend, executable] of renderers) {
      console.log(`Renderer backend "${backend}": ${executable}`);
    }
  });
}

start().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
