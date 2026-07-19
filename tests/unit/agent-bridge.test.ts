import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentBridge } from "../../src/electron/agent-bridge.js";
import type {
  AgentOutputMessage,
  ErrorOutputMessage,
} from "../../src/shared/types/agent-ipc.js";

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

type PendingRequestView = {
  streamContext?: { clientRequestId: string };
  timeout: NodeJS.Timeout;
  resolve: (value: AgentOutputMessage) => void;
  reject: (reason: Error) => void;
};

function getPendingRequests(bridge: AgentBridge): Map<string, PendingRequestView> {
  return (bridge as unknown as {
    pendingRequests: Map<string, PendingRequestView>;
  }).pendingRequests;
}

function attachStdinWriter(bridge: AgentBridge): ReturnType<typeof vi.fn> {
  const writeAsync = vi.fn().mockResolvedValue(undefined);
  (bridge as unknown as {
    stdinWriter: { writeAsync: ReturnType<typeof vi.fn> };
  }).stdinWriter = { writeAsync };
  return writeAsync;
}

function clearPending(bridge: AgentBridge): void {
  const pendingRequests = getPendingRequests(bridge);
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
  }
  pendingRequests.clear();
}

function getHandleMessage(
  bridge: AgentBridge
): (message: AgentOutputMessage) => Promise<void> {
  return (bridge as unknown as {
    handleMessage: (message: AgentOutputMessage) => Promise<void>;
  }).handleMessage.bind(bridge);
}

describe("AgentBridge.cancelByClientRequestId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a cancel for the matching internal requestId and leaves the pending promise to settle via the worker response", async () => {
    const bridge = new AgentBridge();
    const writeAsync = attachStdinWriter(bridge);
    const clientRequestId = "client-req-123";
    const signal = bridge.registerClientRequest(clientRequestId);

    const sendPromise = bridge.send(
      { type: "chat", messages: [{ role: "user", content: "hello" }] },
      {
        timeoutMs: 5000,
        streamContext: {
          clientRequestId,
          projectId: "proj-1",
          chapterId: "chap-1",
          conversationId: 1,
        },
        signal,
      }
    );
    sendPromise.catch(() => undefined);

    const pendingRequests = getPendingRequests(bridge);
    expect(pendingRequests.size).toBe(1);

    const [internalRequestId] = [...pendingRequests.keys()];
    const pendingBefore = pendingRequests.get(internalRequestId);
    expect(pendingBefore?.streamContext?.clientRequestId).toBe(clientRequestId);
    const timeoutBefore = pendingBefore?.timeout;

    const result = bridge.cancelByClientRequestId(clientRequestId);

    expect(result).toBe(true);
    expect(writeAsync).toHaveBeenCalledTimes(2);
    expect(writeAsync.mock.calls[0]?.[0]).toMatchObject({ type: "chat" });
    expect(writeAsync.mock.calls[1]?.[0]).toMatchObject({
      type: "cancel",
      targetRequestId: internalRequestId,
    });

    expect(pendingRequests.has(internalRequestId)).toBe(true);
    expect(pendingRequests.get(internalRequestId)?.timeout).toBe(timeoutBefore);

    const handleMessage = getHandleMessage(bridge);
    const handleMessagePromise = handleMessage({
      type: "error",
      requestId: internalRequestId,
      error: "Cancelled by renderer",
    } as AgentOutputMessage);

    const settled = (await sendPromise) as ErrorOutputMessage;
    await handleMessagePromise;

    expect(settled.type).toBe("error");
    expect(settled.error).toBe("Cancelled by renderer");
    expect(pendingRequests.has(internalRequestId)).toBe(false);
  });

  it("retains cancellation before the worker request is registered", async () => {
    const bridge = new AgentBridge();
    const writeAsync = attachStdinWriter(bridge);
    const clientRequestId = "client-early-cancel";
    const signal = bridge.registerClientRequest(clientRequestId);

    expect(bridge.cancelByClientRequestId(clientRequestId)).toBe(true);
    expect(signal.aborted).toBe(true);

    await expect(bridge.send(
      { type: "chat", messages: [{ role: "user", content: "hello" }] },
      {
        streamContext: {
          clientRequestId,
          projectId: "proj-1",
          chapterId: "chap-1",
          conversationId: 1,
        },
        signal,
      }
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(writeAsync).not.toHaveBeenCalled();
  });

  it("returns false and sends no cancel when no pending request matches the clientRequestId", () => {
    const bridge = new AgentBridge();
    const writeAsync = attachStdinWriter(bridge);

    const sendPromise = bridge.send(
      { type: "chat", messages: [{ role: "user", content: "hello" }] },
      {
        timeoutMs: 5000,
        streamContext: {
          clientRequestId: "client-req-A",
          projectId: "proj-1",
          chapterId: "chap-1",
          conversationId: 1,
        },
      }
    );
    sendPromise.catch(() => undefined);

    const result = bridge.cancelByClientRequestId("client-req-unknown");

    expect(result).toBe(false);
    expect(writeAsync).toHaveBeenCalledTimes(1);
    expect(writeAsync.mock.calls[0]?.[0]).toMatchObject({ type: "chat" });

    clearPending(bridge);
  });

  it("returns false for an empty clientRequestId without dispatching a cancel", () => {
    const bridge = new AgentBridge();
    const writeAsync = attachStdinWriter(bridge);

    const sendPromise = bridge.send(
      { type: "chat", messages: [{ role: "user", content: "hello" }] },
      {
        timeoutMs: 5000,
        streamContext: {
          clientRequestId: "client-req-A",
          projectId: "proj-1",
          chapterId: "chap-1",
          conversationId: 1,
        },
      }
    );
    sendPromise.catch(() => undefined);

    const result = bridge.cancelByClientRequestId("");

    expect(result).toBe(false);
    expect(writeAsync).toHaveBeenCalledTimes(1);

    clearPending(bridge);
  });

  it("only cancels the matching request and leaves sibling in-flight requests untouched", () => {
    const bridge = new AgentBridge();
    const writeAsync = attachStdinWriter(bridge);
    const signalA = bridge.registerClientRequest("client-A");
    const signalB = bridge.registerClientRequest("client-B");

    const sendA = bridge.send(
      { type: "chat", messages: [{ role: "user", content: "a" }] },
      {
        timeoutMs: 5000,
        streamContext: {
          clientRequestId: "client-A",
          projectId: "p",
          chapterId: "c",
          conversationId: 1,
        },
        signal: signalA,
      }
    );
    sendA.catch(() => undefined);

    const sendB = bridge.send(
      { type: "chat", messages: [{ role: "user", content: "b" }] },
      {
        timeoutMs: 5000,
        streamContext: {
          clientRequestId: "client-B",
          projectId: "p",
          chapterId: "c",
          conversationId: 1,
        },
        signal: signalB,
      }
    );
    sendB.catch(() => undefined);

    const pendingRequests = getPendingRequests(bridge);
    expect(pendingRequests.size).toBe(2);

    const result = bridge.cancelByClientRequestId("client-B");

    expect(result).toBe(true);
    expect(writeAsync).toHaveBeenCalledTimes(3);
    const cancelMessage = writeAsync.mock.calls[2]?.[0] as {
      type: string;
      targetRequestId: string;
    };
    expect(cancelMessage).toMatchObject({ type: "cancel" });

    const cancelledTargetId = cancelMessage.targetRequestId;
    expect(pendingRequests.has(cancelledTargetId)).toBe(true);
    expect(pendingRequests.size).toBe(2);

    const cancelledEntry = pendingRequests.get(cancelledTargetId);
    expect(cancelledEntry?.streamContext?.clientRequestId).toBe("client-B");

    const siblingEntry = [...pendingRequests.values()].find(
      (pending) => pending.streamContext?.clientRequestId === "client-A"
    );
    expect(siblingEntry).toBeDefined();

    clearPending(bridge);
  });
});
