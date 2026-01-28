import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { JSONStdinWriter, JSONStdoutReader } from "../../src/agent/ipc/json-message-transport.js";
import type { AgentOutputMessage } from "../../src/shared/types/agent-ipc.js";

describe("Agent Chat Integration", () => {
  let agentProcess: ChildProcess | null = null;
  let stdinWriter: JSONStdinWriter | null = null;
  let stdoutReader: JSONStdoutReader | null = null;
  let messages: AgentOutputMessage[] = [];
  let pending: Map<string, { resolve: (value: any) => void; reject: (error: any) => void }>;

  const agentPath = path.resolve(__dirname, "../../build/src/agent/index.js");

  beforeEach(async () => {
    if (!require("fs").existsSync(agentPath)) {
      console.warn("Agent build not found, skipping integration test");
      throw new Error("SKIP");
    }

    messages = [];
    pending = new Map();

    agentProcess = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, GEMINI_API_KEY: "test-key" },
    });

    stdinWriter = new JSONStdinWriter(agentProcess.stdin!);
    stdoutReader = new JSONStdoutReader(agentProcess.stdout!);

    stdoutReader.on("message", (msg: AgentOutputMessage) => {
      messages.push(msg);

      if (msg.type === "token" || msg.type === "progress" || msg.type === "node-complete") {
        return;
      }

      const pendingHandler = pending.get(msg.requestId);
      if (pendingHandler) {
        if (msg.type === "graph-complete") {
          pendingHandler.resolve(msg as any);
        } else if (msg.type === "error") {
          pendingHandler.reject(new Error(msg.error));
        }
        pending.delete(msg.requestId);
      }
    });

    agentProcess.stderr!.on("data", (chunk: Buffer) => {
      console.error(`[Agent stderr] ${chunk.toString()}`);
    });

    await waitForReady();
  }, 30000);

  afterEach(async () => {
    if (stdinWriter) {
      stdinWriter.end();
    }

    if (agentProcess) {
      agentProcess.kill();
      agentProcess = null;
    }

    stdinWriter = null;
    stdoutReader = null;
    pending.clear();
  });

  function waitForReady(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error("Agent ready timeout"));
      }, timeout);

      const checkReady = () => {
        const readyMsg = messages.find((msg) => msg.type === "ready");
        if (readyMsg) {
          clearTimeout(timeoutHandle);
          resolve();
        } else if (!agentProcess || agentProcess.killed) {
          clearTimeout(timeoutHandle);
          reject(new Error("Agent process not running"));
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  function sendAndWait(message: any, timeout = 60000): Promise<AgentOutputMessage> {
    return new Promise((resolve, reject) => {
      const requestId = message.requestId;

      const timeoutHandle = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Request timeout: ${requestId}`));
      }, timeout);

      pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeoutHandle);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
      });

      stdinWriter!.write(message);
    });
  }

  it.skip("should handle basic chat message", async () => {
    const response = await sendAndWait({
      type: "chat",
      requestId: "test-1",
      messages: [{ role: "user", content: "Hello!" }],
    });

    expect(response.type).toBe("graph-complete");
    expect(response.result).toBeDefined();
  });

  it.skip("should stream tokens during chat", async () => {
    messages = [];

    const responsePromise = sendAndWait({
      type: "chat",
      requestId: "test-2",
      messages: [{ role: "user", content: "Say hello" }],
    });

    await new Promise((r) => setTimeout(r, 2000));

    const tokens = messages.filter((msg) => msg.type === "token");
    expect(tokens.length).toBeGreaterThan(0);

    const response = await responsePromise;
    expect(response.type).toBe("graph-complete");
  });

  it.skip("should handle error on invalid message type", async () => {
    await expect(
      sendAndWait({
        type: "invalid" as any,
        requestId: "test-3",
      })
    ).rejects.toThrow("Unknown message type");
  });

  it.skip("should maintain thread persistence across calls", async () => {
    const response1 = await sendAndWait({
      type: "chat",
      requestId: "test-4a",
      threadId: "persistent-thread",
      messages: [{ role: "user", content: "My name is Alice" }],
    });

    expect(response1.type).toBe("graph-complete");

    const response2 = await sendAndWait({
      type: "chat",
      requestId: "test-4b",
      threadId: "persistent-thread",
      messages: [{ role: "user", content: "What is my name?" }],
    });

    expect(response2.type).toBe("graph-complete");
    expect(response2.result).toBeDefined();
  });

  it.skip("should handle thread-less requests", async () => {
    const response = await sendAndWait({
      type: "chat",
      requestId: "test-5",
      messages: [{ role: "user", content: "Say hello without thread" }],
    });

    expect(response.type).toBe("graph-complete");
    expect(response.threadId).toBeDefined();
    expect(response.threadId.length).toBeGreaterThan(0);
  });

  it.skip("should handle multiple concurrent requests", async () => {
    const promises = [
      sendAndWait({
        type: "chat",
        requestId: "test-6a",
        messages: [{ role: "user", content: "Message A" }],
      }),
      sendAndWait({
        type: "chat",
        requestId: "test-6b",
        messages: [{ role: "user", content: "Message B" }],
      }),
      sendAndWait({
        type: "chat",
        requestId: "test-6c",
        messages: [{ role: "user", content: "Message C" }],
      }),
    ];

    const responses = await Promise.all(promises);

    expect(responses).toHaveLength(3);
    responses.forEach((response) => {
      expect(response.type).toBe("graph-complete");
    });
  });

  it.skip("should handle stop request", async () => {
    const longRunningRequest = sendAndWait({
      type: "chat",
      requestId: "test-7",
      messages: [{ role: "user", content: "Very long request..." }],
    });

    await new Promise((r) => setTimeout(r, 500));

    const stopResponse = await sendAndWait({
      type: "stop",
      requestId: "test-7",
    });

    expect(stopResponse.type).toBe("graph-complete");
  });
});
