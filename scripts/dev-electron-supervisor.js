import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import chokidar from "chokidar";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const RESTART_DEBOUNCE_MS = 300;
export const INITIAL_BUILD_TIMEOUT_MS = 30_000;
export const MANAGED_EXIT_TIMEOUT_MS = 5_000;
export const TSC_WATCH_READY_PATTERN = /Watching for file changes\./;
export const BACKEND_READY_FILES = [
  "dist/src/electron/main.js",
  "dist/src/electron/preload.cjs",
  "dist/src/agent/index.js",
];
export const BACKEND_WATCH_TARGETS = [
  "dist/src/electron",
  "dist/src/agent",
  "dist/src/shared",
  "dist/src/pipeline",
  "src/electron/preload.ts",
];

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeToAbsolute(projectRoot, entry) {
  return path.isAbsolute(entry) ? entry : path.resolve(projectRoot, entry);
}

export async function waitForRequiredFiles(
  filePaths,
  {
    exists = pathExists,
    sleep = defaultSleep,
    intervalMs = 100,
    timeoutMs = INITIAL_BUILD_TIMEOUT_MS,
  } = {}
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const checks = await Promise.all(filePaths.map((filePath) => exists(filePath)));
    if (checks.every(Boolean)) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for backend build outputs: ${filePaths.join(", ")}`);
}

export function createDebouncedRestart(
  callback,
  delayMs = RESTART_DEBOUNCE_MS,
  timerApi = { setTimeout, clearTimeout }
) {
  let pendingTimer = null;

  const schedule = () => {
    if (pendingTimer) {
      timerApi.clearTimeout(pendingTimer);
    }

    pendingTimer = timerApi.setTimeout(() => {
      pendingTimer = null;
      void callback();
    }, delayMs);
  };

  schedule.cancel = () => {
    if (pendingTimer) {
      timerApi.clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  return schedule;
}

export async function stopManagedChild(
  child,
  {
    signal = "SIGTERM",
    timeoutMs = MANAGED_EXIT_TIMEOUT_MS,
    timerApi = { setTimeout, clearTimeout },
  } = {}
) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once("exit", () => resolve());
  });

  child.kill(signal);

  let timeoutHandle = null;
  const timedOut = new Promise((resolve) => {
    timeoutHandle = timerApi.setTimeout(resolve, timeoutMs);
  });

  await Promise.race([exited, timedOut]);

  if (timeoutHandle) {
    timerApi.clearTimeout(timeoutHandle);
  }

  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

export function waitForTypeScriptWatchReady(
  child,
  {
    timeoutMs = INITIAL_BUILD_TIMEOUT_MS,
    timerApi = { setTimeout, clearTimeout },
    readyPattern = TSC_WATCH_READY_PATTERN,
  } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;

    const cleanup = () => {
      if (timeoutHandle) {
        timerApi.clearTimeout(timeoutHandle);
      }
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    const finish = (fn, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fn(value);
    };

    const onData = (chunk) => {
      const text = String(chunk);
      if (readyPattern.test(text)) {
        finish(resolve);
      }
    };

    const onExit = (code, signal) => {
      finish(
        reject,
        new Error(
          `TypeScript watch exited before the initial build completed: ${code ?? "unknown"} (${signal ?? "unknown"})`
        )
      );
    };

    timeoutHandle = timerApi.setTimeout(() => {
      finish(reject, new Error("Timed out waiting for TypeScript watch to become ready"));
    }, timeoutMs);

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

function isDirectExecution(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }

  return pathToFileURL(process.argv[1]).href === metaUrl;
}

function pipeChildOutput(stream, target) {
  stream?.on("data", (chunk) => {
    target.write(chunk);
  });
}

export class ElectronDevSupervisor {
  constructor({
    projectRoot = PROJECT_ROOT,
    env = process.env,
    spawnProcess = spawn,
    createWatcher = (targets, options) => chokidar.watch(targets, options),
    exitProcess = (code) => process.exit(code),
    sleep = defaultSleep,
  } = {}) {
    this.projectRoot = projectRoot;
    this.env = env;
    this.spawnProcess = spawnProcess;
    this.createWatcher = createWatcher;
    this.exitProcess = exitProcess;
    this.sleep = sleep;
    this.tscProcess = null;
    this.electronProcess = null;
    this.watcher = null;
    this.shuttingDown = false;
    this.restartingElectron = false;
    this.backendReadyPromise = null;
    this.scheduleRestart = createDebouncedRestart(
      async () => {
        await this.restartElectron();
      },
      RESTART_DEBOUNCE_MS
    );
  }

  async start() {
    await this.runPreloadBuild();
    this.startTypeScriptWatch();
    await this.waitForInitialBackendBuild();
    this.startWatcher();
    await this.launchElectron();
  }

  async stop() {
    this.shuttingDown = true;
    this.scheduleRestart.cancel?.();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    await stopManagedChild(this.electronProcess);
    await stopManagedChild(this.tscProcess);

    this.electronProcess = null;
    this.tscProcess = null;
  }

  startTypeScriptWatch() {
    this.tscProcess = this.spawnProcess(
      "pnpm",
      ["exec", "tsc", "-p", "tsconfig.electron.json", "--watch", "--preserveWatchOutput"],
      {
        cwd: this.projectRoot,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    pipeChildOutput(this.tscProcess.stdout, process.stdout);
    pipeChildOutput(this.tscProcess.stderr, process.stderr);

    this.backendReadyPromise = waitForTypeScriptWatchReady(this.tscProcess);

    this.tscProcess.on("error", (error) => {
      void this.handleFatalExit(error instanceof Error ? error : new Error(String(error)));
    });

    this.tscProcess.on("exit", (code, signal) => {
      if (this.shuttingDown) {
        return;
      }

      void this.handleFatalExit(
        new Error(`TypeScript watch exited unexpectedly: ${code ?? "unknown"} (${signal ?? "unknown"})`)
      );
    });
  }

  async waitForInitialBackendBuild() {
    const readyFiles = BACKEND_READY_FILES.map((entry) => normalizeToAbsolute(this.projectRoot, entry));
    await Promise.all([
      this.backendReadyPromise,
      waitForRequiredFiles(readyFiles, { sleep: this.sleep }),
    ]);
  }

  startWatcher() {
    if (this.watcher) {
      return;
    }

    const watchTargets = BACKEND_WATCH_TARGETS.map((entry) =>
      normalizeToAbsolute(this.projectRoot, entry)
    );

    this.watcher = this.createWatcher(watchTargets, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on("all", (_eventName, changedPath) => {
      void this.handleWatchedPathChange(changedPath);
    });

    this.watcher.on("error", (error) => {
      void this.handleFatalExit(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async handleWatchedPathChange(changedPath) {
    if (this.shuttingDown) {
      return;
    }

    const preloadSource = normalizeToAbsolute(this.projectRoot, "src/electron/preload.ts");
    if (path.resolve(changedPath) === preloadSource) {
      await this.runPreloadBuild();
    }

    this.scheduleRestart();
  }

  async runPreloadBuild() {
    await this.runCommand("node", ["./scripts/copy-preload.js"]);
  }

  async runCommand(command, args) {
    await new Promise((resolve, reject) => {
      const child = this.spawnProcess(command, args, {
        cwd: this.projectRoot,
        env: this.env,
        stdio: "inherit",
      });

      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (signal) {
          reject(new Error(`${command} ${args.join(" ")} exited with signal ${signal}`));
          return;
        }

        if ((code ?? 0) === 0) {
          resolve();
          return;
        }

        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 0}`));
      });
    });
  }

  async launchElectron() {
    if (this.shuttingDown) {
      return;
    }

    this.electronProcess = this.spawnProcess(
      "node",
      ["./scripts/run-electron.js", "dist/src/electron/main.js"],
      {
        cwd: this.projectRoot,
        env: this.env,
        stdio: "inherit",
      }
    );

    this.electronProcess.on("error", (error) => {
      void this.handleFatalExit(error instanceof Error ? error : new Error(String(error)));
    });

    this.electronProcess.on("exit", (code, signal) => {
      if (this.shuttingDown || this.restartingElectron) {
        return;
      }

      const normalizedCode = code ?? 0;
      if (signal || normalizedCode !== 0) {
        void this.handleFatalExit(
          new Error(`Electron exited unexpectedly: ${normalizedCode} (${signal ?? "unknown"})`)
        );
        return;
      }

      void this.stop().finally(() => {
        this.exitProcess(0);
      });
    });
  }

  async restartElectron() {
    if (this.shuttingDown || this.restartingElectron) {
      return;
    }

    this.restartingElectron = true;
    try {
      await stopManagedChild(this.electronProcess);
      this.electronProcess = null;
      await this.launchElectron();
    } finally {
      this.restartingElectron = false;
    }
  }

  async handleFatalExit(error) {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    console.error("[dev-electron-supervisor]", error);
    await this.stop();
    this.exitProcess(1);
  }
}

async function main() {
  const supervisor = new ElectronDevSupervisor();

  const shutdown = async () => {
    if (supervisor.shuttingDown) {
      return;
    }

    await supervisor.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGHUP", () => {
    void shutdown();
  });

  await supervisor.start();
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    console.error("[dev-electron-supervisor] Fatal error:", error);
    process.exit(1);
  });
}
