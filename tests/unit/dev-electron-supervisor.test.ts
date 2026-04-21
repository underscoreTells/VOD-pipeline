import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedRestart,
  stopManagedChild,
  waitForRequiredFiles,
} from "../../scripts/dev-electron-supervisor.js";

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  kill = vi.fn((signal?: string) => {
    this.killed = true;
    this.exitCode = signal === "SIGKILL" ? 137 : 0;
    this.emit("exit", this.exitCode, signal ?? null);
    return true;
  });
}

describe("dev electron supervisor helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits until all required backend outputs exist", async () => {
    const existing = new Set<string>();
    let pollCount = 0;

    await waitForRequiredFiles(["dist/src/electron/main.js", "dist/src/agent/index.js"], {
      exists: async (filePath) => existing.has(filePath),
      sleep: async () => {
        pollCount += 1;
        if (pollCount === 1) {
          existing.add("dist/src/electron/main.js");
        }
        if (pollCount === 2) {
          existing.add("dist/src/agent/index.js");
        }
      },
      timeoutMs: 1_000,
    });

    expect(pollCount).toBe(2);
  });

  it("debounces rapid restart requests into a single restart", async () => {
    vi.useFakeTimers();
    const restart = vi.fn();
    const scheduleRestart = createDebouncedRestart(restart, 300);

    scheduleRestart();
    scheduleRestart();
    scheduleRestart();

    await vi.advanceTimersByTimeAsync(299);
    expect(restart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("kills managed child processes during shutdown", async () => {
    const child = new MockChildProcess();

    await stopManagedChild(child, { timeoutMs: 100 });

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
