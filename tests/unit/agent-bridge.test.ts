import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBridge } from "../../src/electron/agent-bridge.js";

const electronState = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    getAppPath: vi.fn(() => "/tmp/app.asar"),
    isPackaged: false,
  },
}));

vi.mock("electron", () => electronState);

describe("AgentBridge launch and timeout behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    electronState.app.isPackaged = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("launches the worker with the current Electron runtime and DB path", () => {
    const bridge = new AgentBridge();
    const spec = (bridge as unknown as {
      getWorkerLaunchSpec: () => {
        command: string;
        args: string[];
        env: NodeJS.ProcessEnv;
      };
    }).getWorkerLaunchSpec();

    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toHaveLength(1);
    expect(spec.args[0]).toContain("agent/index.js");
    expect(spec.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(spec.env.VOD_PIPELINE_DB_PATH).toBe("/tmp/vod-pipeline.db");
  });

  it("launches the packaged worker from app.asar so dependencies remain resolvable", () => {
    electronState.app.isPackaged = true;
    const bridge = new AgentBridge();
    const spec = (bridge as unknown as {
      getWorkerLaunchSpec: () => { args: string[] };
    }).getWorkerLaunchSpec();

    expect(spec.args[0]).toBe("/tmp/app.asar/dist/src/agent/index.js");
  });

  it("sends a cancel control message when a request times out", async () => {
    const bridge = new AgentBridge();
    const writeAsync = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    (bridge as unknown as { stdinWriter: { writeAsync: typeof writeAsync } }).stdinWriter = {
      writeAsync,
    };

    const sendPromise = bridge.send(
      {
        type: "chat",
        messages: [{ role: "user", content: "hello" }],
      },
      { timeoutMs: 1000 }
    );
    const rejection = sendPromise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(1000);

    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Agent request timeout/);
    expect(writeAsync).toHaveBeenCalledTimes(2);

    const initialMessage = writeAsync.mock.calls[0]?.[0] as {
      type: string;
      requestId: string;
    };
    const cancelMessage = writeAsync.mock.calls[1]?.[0] as {
      type: string;
      targetRequestId: string;
    };

    expect(initialMessage.type).toBe("chat");
    expect(cancelMessage).toMatchObject({
      type: "cancel",
      targetRequestId: initialMessage.requestId,
    });
  });
});

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
