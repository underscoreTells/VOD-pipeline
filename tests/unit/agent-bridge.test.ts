import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBridge } from "../../src/electron/agent-bridge.js";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
  },
}));

describe("AgentBridge.stop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects pending requests and terminates the worker locally", async () => {
    const bridge = new AgentBridge();
    const reject = vi.fn();
    const fakeProcess = {
      kill: vi.fn(),
      killed: false,
    };
    const fakeWriter = {
      end: vi.fn(),
    };

    (bridge as unknown as {
      process: typeof fakeProcess;
      stdinWriter: typeof fakeWriter;
      pendingRequests: Map<string, unknown>;
    }).process = fakeProcess;
    (bridge as unknown as {
      process: typeof fakeProcess;
      stdinWriter: typeof fakeWriter;
      pendingRequests: Map<string, unknown>;
    }).stdinWriter = fakeWriter;
    (bridge as unknown as {
      pendingRequests: Map<string, unknown>;
    }).pendingRequests = new Map([
      [
        "req-1",
        {
          resolve: vi.fn(),
          reject,
          timeout: setTimeout(() => undefined, 1000),
        },
      ],
    ]);

    await bridge.stop();

    expect(fakeWriter.end).toHaveBeenCalledTimes(1);
    expect(fakeProcess.kill).toHaveBeenCalledWith("SIGTERM");
    expect(reject).toHaveBeenCalledTimes(1);
    expect((reject.mock.calls[0]?.[0] as Error).message).toBe("Agent shut down");

    await vi.advanceTimersByTimeAsync(5000);

    expect(fakeProcess.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
