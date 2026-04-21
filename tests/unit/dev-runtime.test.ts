import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock("electron", () => electronState);

function writeBuildFile(baseDir: string, relativePath: string, content: string): string {
  const absolutePath = join(baseDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
  return absolutePath;
}

describe("dev runtime fingerprinting", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    const { resetDevRuntimeStateForTests } = await import("../../src/electron/dev-runtime.js");
    resetDevRuntimeStateForTests();
    electronState.app.isPackaged = false;

    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not report staleness when backend outputs are unchanged", async () => {
    const { initializeDevRuntimeState, getBackendRuntimeStaleness } = await import(
      "../../src/electron/dev-runtime.js"
    );
    const projectRoot = mkdtempSync(join(tmpdir(), "vod-runtime-"));
    tempDirs.push(projectRoot);

    writeBuildFile(projectRoot, "dist/src/agent/index.js", "first");
    await initializeDevRuntimeState(projectRoot);

    await expect(getBackendRuntimeStaleness(projectRoot)).resolves.toBeNull();
  });

  it("reports staleness when a backend output becomes newer than startup", async () => {
    const { initializeDevRuntimeState, getBackendRuntimeStaleness } = await import(
      "../../src/electron/dev-runtime.js"
    );
    const projectRoot = mkdtempSync(join(tmpdir(), "vod-runtime-"));
    tempDirs.push(projectRoot);

    const buildFile = writeBuildFile(projectRoot, "dist/src/agent/index.js", "first");
    await initializeDevRuntimeState(projectRoot);

    const futureTime = new Date(Date.now() + 5_000);
    writeFileSync(buildFile, "second", "utf8");
    utimesSync(buildFile, futureTime, futureTime);

    await expect(getBackendRuntimeStaleness(projectRoot)).resolves.toMatchObject({
      startupFingerprint: expect.any(Number),
      currentFingerprint: expect.any(Number),
      runtimeSessionId: expect.any(String),
    });
  });

  it("disables stale-runtime detection in packaged mode", async () => {
    electronState.app.isPackaged = true;
    const { initializeDevRuntimeState, getBackendRuntimeStaleness } = await import(
      "../../src/electron/dev-runtime.js"
    );
    const projectRoot = mkdtempSync(join(tmpdir(), "vod-runtime-"));
    tempDirs.push(projectRoot);

    writeBuildFile(projectRoot, "dist/src/electron/main.js", "compiled");
    await initializeDevRuntimeState(projectRoot);

    await expect(getBackendRuntimeStaleness(projectRoot)).resolves.toBeNull();
  });

  it("handles missing backend output directories without crashing", async () => {
    const { initializeDevRuntimeState, computeBackendBuildFingerprint } = await import(
      "../../src/electron/dev-runtime.js"
    );
    const projectRoot = mkdtempSync(join(tmpdir(), "vod-runtime-"));
    tempDirs.push(projectRoot);

    await initializeDevRuntimeState(projectRoot);
    await expect(computeBackendBuildFingerprint(projectRoot)).resolves.toBe(0);
  });
});
