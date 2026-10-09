const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";

const services = [
  {
    id: "2d",
    name: "2D backend",
    command: process.execPath,
    args: ["server/server.js"],
    cwd: path.join(root, "prism", "2Drenderer"),
    env: { PORT: "8080" },
  },
  {
    id: "cuda",
    name: "CUDA spectral backend",
    command: process.execPath,
    args: ["server/spectral_backend.js"],
    cwd: path.join(root, "prism", "CUDA-Spectral-Pathtracer"),
    env: { PORT: "8091" },
  },
  {
    id: "client",
    name: "Vite client",
    command: isWindows ? process.env.ComSpec || "cmd.exe" : "npm",
    args: isWindows
        ? ["/d", "/s", "/c", "npm.cmd run dev"]
        : ["run", "dev"],
    cwd: path.join(root, "Client"),
    env: {},
  },
];

const disabled = new Set(
    process.argv
        .slice(2)
        .filter((arg) => arg.startsWith("--skip="))
        .flatMap((arg) => arg.slice("--skip=".length).split(","))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
);

const children = [];
let shuttingDown = false;

function prefixLines(name, chunk, stream) {
  const text = chunk.toString();

  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      stream.write(`[${name}] ${line}\n`);
    }
  }
}

function startService(service) {
  if (disabled.has(service.id)) {
    console.log(`[launcher] Skipping ${service.name}`);
    return;
  }

  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: {
      ...process.env,
      ...service.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  children.push({ service, child });

  child.stdout.on("data", (chunk) => {
    prefixLines(service.id, chunk, process.stdout);
  });

  child.stderr.on("data", (chunk) => {
    prefixLines(service.id, chunk, process.stderr);
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const reason = signal ?? `code ${code}`;
      console.log(`[launcher] ${service.name} exited with ${reason}`);
    }
  });

  child.on("error", (error) => {
    console.error(
        `[launcher] Could not start ${service.name}: ${error.message}`,
    );
  });
}

function stopChild(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("\n[launcher] Stopping services...");

  for (const { child } of children) {
    stopChild(child);
  }

  setTimeout(() => {
    process.exit(0);
  }, 800).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("exit", () => {
  for (const { child } of children) {
    stopChild(child);
  }
});

console.log("[launcher] Starting Prism stack");
console.log("[launcher] Client: http://localhost:5173");
console.log("[launcher] 2D backend: http://localhost:8080/render");
console.log("[launcher] CUDA backend: http://localhost:8091/render");
console.log("[launcher] Use --skip=2d,cuda,client to omit services.");

for (const service of services) {
  startService(service);
}
