const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const KEEP_RENDER_TEMP= false;

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const renderer = process.env.RENDERER_EXE
  || path.join(root, "cmake-build-release", `renderer_2d${executableSuffix}`);
const spdPlotter = process.env.SPD_PLOTTER_EXE
  || path.join(root, "cmake-build-release", `spd_plotter${executableSuffix}`);
const rendererSource = path.join(root, "main.cpp");

// Mapping SPD-Name -> Dateipfad
const spdPresets = {
  d65: "data/illuminants/CIE_std_illum_D65.csv",
  uniform: "data/illuminants/uniform_SPD.csv",
  tungsten: "data/illuminants/approx_tungsten.csv",
  leds: "data/illuminants/CIE_illum_LEDs.csv",
  fluorescent: "data/illuminants/CIE_illum_FLs.csv",
  highPressureSodium: "data/illuminants/CIE_illum_HPs.csv",
  custom: "data/illuminants/custom_SPD.csv"
};
// Mapping Material-Name -> Dateipfad von Absorptions- und Sellmeier-Koeffizienten
const materialPresets = {
  bk7: {
    sellmeier: "data/material_sellmeier/bk7_sellmeier_coefficients.csv",
    absorption: "data/material_absorption/bk7_absorption_coefficients.csv",
  },
  fk51a: {
    sellmeier: "data/material_sellmeier/fk51a_sellmeier_coefficients.csv",
    absorption: "data/material_absorption/fk51a_absorption_coefficients.csv",
  },
  lak34: {
    sellmeier: "data/material_sellmeier/lak34_sellmeier_coefficients.csv",
    absorption: "data/material_absorption/lak34_absorption_coefficients.csv",
  },
  sf57: {
    sellmeier: "data/material_sellmeier/sf57_sellmeier_coefficients.csv",
    absorption: "data/material_absorption/sf57_absorption_coefficients.csv",
  },
};

function vector(value, name) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${name} must contain three numbers`);
  }
  return value.join(" ");
}

function planeLine(type, plane) {
  return [
    type,
    vector(plane.point, `${type}.point`),
    vector(plane.normal, `${type}.normal`),
    vector(plane.right, `${type}.right`),
    vector(plane.up, `${type}.up`),
    Number(plane.width),
    Number(plane.height),
  ].join(" ");
}

function prismLine(prism) {
  if (!prism || !Array.isArray(prism.position) || prism.position.length !== 2
      || !prism.position.every(Number.isFinite)
      || !Number.isFinite(prism.prismAngleDeg)
      || !Number.isFinite(prism.rotationDeg)
      || !Number.isFinite(prism.radius)
      || !Number.isFinite(prism.zDepth)) {
    throw new Error("prism must contain position, prismAngleDeg, rotationDeg, radius, zDepth");
  }
  if (prism.prismAngleDeg <= 0 || prism.prismAngleDeg >= 180
      || prism.radius <= 0 || prism.zDepth <= 0) {
    throw new Error("prism contains invalid values");
  }
  return [
    "prism",
    prism.position.join(" "),
    prism.prismAngleDeg,
    prism.rotationDeg,
    prism.radius,
    prism.zDepth,
  ].join(" ");
}

function spdLine(light) {
  const preset = light.spdPreset || light.spd?.preset || light.spd?.name || "d65";
  const filename = filenameForSpdPreset(preset);
  return `light_spd ${filename}`;
}

function sellmeierLine(prism) {
  const material = prism.material || "bk7";
  const filename = filenameSellmeierForMaterial(material);
  return `prism_sellmeier ${filename}`
}

function absorptionLine(prism) {
  const material = prism.material || "bk7";
  const filename = filenameAbsorptionForMaterial(material);
  return `prism_absorption ${filename}`
}

function filenameForSpdPreset(preset) {
  if (typeof preset !== "string") {
    throw new Error("light.spdPreset must be a string");
  }
  const filename = spdPresets[preset];
  if (!filename) {
    throw new Error(`light.spdPreset must be one of: ${Object.keys(spdPresets).join(", ")}`);
  }
  return filename;
}

function filenameSellmeierForMaterial(material) {
  if (typeof material !== "string") {
    throw new Error("prism.material must be a string");
  }
  const filename = materialPresets[material]["sellmeier"];
  if (!filename) {
    throw new Error(`prism.material must be one of: ${Object.keys(materialPresets).join(", ")}`);
  }
  return filename;
}

function filenameAbsorptionForMaterial(material) {
  if (typeof material !== "string") {
    throw new Error("prism.material must be a string");
  }
  const filename = materialPresets[material]["absorption"];
  if (!filename) {
    throw new Error(`prism.material must be one of: ${Object.keys(materialPresets).join(", ")}`);
  }
  return filename;
}

// Returns a textual description of the scene from the scene object
function sceneText(scene) {
  const light = scene.light;
  const render = scene.render;
  const lightType = light.type || "circle";
  const renderFields = [
    "recursionDepth", "lambdaMin", "lambdaMax", "spectrumBins", "lightPower",
    "lightSamples", "imageExposure", "imageWidth", "imageHeight",
  ];
  if (!render || !renderFields.every((field) => Number.isFinite(render[field]))) {
    throw new Error(`render must contain: ${renderFields.join(", ")}`);
  }
  if (render.rngSeedEnabled !== undefined && typeof render.rngSeedEnabled !== "boolean") {
    throw new Error("render.rngSeedEnabled must be a boolean");
  }
  const rngSeedEnabled = render.rngSeedEnabled === true;
  const rngSeed = render.rngSeed ?? 1;
  if (!Number.isInteger(rngSeed) || rngSeed < 0 || rngSeed > 0xffffffff) {
    throw new Error("render.rngSeed must be an integer between 0 and 4294967295");
  }
  if (render.lambdaMin >= render.lambdaMax
      || !Number.isInteger(render.spectrumBins) || render.spectrumBins < 2
      || render.lightPower <= 0
      || !Number.isInteger(render.lightSamples) || render.lightSamples < 1
      || render.imageExposure <= 0
      || !Number.isInteger(render.imageWidth) || render.imageWidth < 1
      || !Number.isInteger(render.imageHeight) || render.imageHeight < 1) {
    throw new Error("render contains invalid values");
  }

  let lightLine;
  if (lightType === "circle") {
    if (!Number.isFinite(light.radius)) {
      throw new Error("light.radius must be a number");
    }
    lightLine = [
      "circle_light",
      vector(light.center, "light.center"),
      vector(light.direction, "light.direction"),
      vector(light.right, "light.right"),
      vector(light.up, "light.up"),
      light.radius,
    ].join(" ");
  } else if (lightType === "area") {
    if (!Number.isFinite(light.width) || !Number.isFinite(light.height)) {
      throw new Error("area light width and height must be numbers");
    }
    lightLine = [
      "area_light",
      vector(light.center, "light.center"),
      vector(light.direction, "light.direction"),
      vector(light.right, "light.right"),
      vector(light.up, "light.up"),
      light.width,
      light.height,
    ].join(" ");
  } else {
    throw new Error('light.type must be "circle" or "area"');
  }

  return [
    planeLine("image_plane", scene.imagePlane),
    lightLine,
    prismLine(scene.prism),
    spdLine(light),
    sellmeierLine(scene.prism),
    absorptionLine(scene.prism),
    `render_config ${[
      ...renderFields.map((field) => render[field]),
      rngSeedEnabled ? 1 : 0,
      rngSeed,
    ].join(" ")}`,
    "",
  ].join("\n");
}

function corsHeaders(contentType, extraHeaders = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Render-Duration-Ms",
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...extraHeaders,
  };
}

function reply(response, status, body, contentType = "text/plain", extraHeaders = {}) {
  response.writeHead(status, {
    ...corsHeaders(contentType, extraHeaders),
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";

function spdPlotPresetFromUrl(url) {
  const match = /^\/spd-plot\/([^/?#]+)$/.exec(url ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

function pathForPlotterArgument(filename) {
  return filename.replace(/\\/g, "/");
}

async function handleSpdPlot(preset, response) {
  let directory;
  try {
    const filename = filenameForSpdPreset(preset);
    await fs.access(spdPlotter);

    directory = await fs.mkdtemp(path.join(os.tmpdir(), "spd-plot-"));
    const outputFile = path.join(directory, "plot.png");
    await run(spdPlotter, [filename, pathForPlotterArgument(outputFile)], {
      cwd: root,
      timeout: Number(process.env.SPD_PLOT_TIMEOUT_MS || 30_000),
      maxBuffer: 4 * 1024 * 1024,
    });

    const image = await fs.readFile(outputFile);
    reply(response, 200, image, "image/png", {
      "Cache-Control": "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("must be one of") ? 400 : 500;
    reply(response, status, message);
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

async function start() {
  const [executable, source] = await Promise.all([
    fs.stat(renderer),
    fs.stat(rendererSource),
  ]);
  if (executable.mtimeMs < source.mtimeMs) {
    throw new Error("Renderer is outdated. Rebuild the Release target first.");
  }

  http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    reply(response, 200, "ok");
    return;
  }

  const spdPlotPreset = request.method === "GET" ? spdPlotPresetFromUrl(request.url) : null;
  if (spdPlotPreset) {
    handleSpdPlot(spdPlotPreset, response);
    return;
  }

  if (request.method !== "POST" || request.url !== "/render") {
    reply(response, 404, "Not found");
    return;
  }

  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });

  request.on("end", async () => {
    let directory;
    try {
      const scene = JSON.parse(body);
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "renderer-"));
      const sceneFile = path.join(directory, "scene.txt");
      const imageFile = path.join(directory, "image.ppm");
      await fs.writeFile(sceneFile, sceneText(scene));
      const renderStart = process.hrtime.bigint();
      await run(renderer, [sceneFile, imageFile], { cwd: root, timeout: 300_000 });
      const renderDurationMs = Number(process.hrtime.bigint() - renderStart) / 1_000_000;
      const image = await fs.readFile(imageFile);
      reply(response, 200, image, "image/x-portable-pixmap", {
        "X-Render-Duration-Ms": renderDurationMs.toFixed(2),
      });
    } catch (error) {
      const status = error instanceof SyntaxError
        || error.message.includes("must")
        || error.message.includes("invalid") ? 400 : 500;
      reply(response, status, error.message);
    } finally {
      if (!KEEP_RENDER_TEMP && directory) await fs.rm(directory, { recursive: true, force: true });
    }
  });
  }).listen(port, host, () => {
    console.log(`Listening on http://${host}:${port}/render`);
  });
}

start().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
