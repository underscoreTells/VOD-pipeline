import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { JSONStdinWriter, JSONStdoutReader } from "../../src/agent/ipc/json-message-transport.js";
import type { AgentOutputMessage } from "../../src/shared/types/agent-ipc.js";

describe("Agent Spawn Integration", () => {
  let agentProcess: ChildProcess | null = null;
  let stdinWriter: JSONStdinWriter | null = null;
  let stdoutReader: JSONStdoutReader | null = null;
  let messages: AgentOutputMessage[] = [];

  const agentPath = path.resolve(__dirname, "../../build/src/agent/index.js");

  beforeEach(async () => {
    messages = [];

    if (!require("fs").existsSync(agentPath)) {
      console.warn("Agent build not found, skipping integration test");
      throw new Error("SKIP");
    }

    agentProcess = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    stdinWriter = new JSONStdinWriter(agentProcess.stdin!);
    stdoutReader = new JSONStdoutReader(agentProcess.stdout!);

    stdoutReader.on("message", (msg: AgentOutputMessage) => {
      messages.push(msg);
    });

    agentProcess.stderr!.on("data", (chunk: Buffer) => {
      console.error(`[Agent stderr] ${chunk.toString()}`);
    });

    await waitForReady();
  }, 15000);

  afterEach(async () => {
    if (stdinWriter) {
      stdinWriter.write({ type: "stop", requestId: "cleanup" });
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (agentProcess) {
      agentProcess.kill();
      agentProcess = null;
    }

    stdinWriter = null;
    stdoutReader = null;
    messages = [];
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

  it("should spawn agent process successfully", () => {
    expect(agentProcess).toBeDefined();
    expect(agentProcess?.pid).toBeGreaterThan(0);
  });

  it("should send ready signal on startup", () => {
    const readyMsg = messages.find((msg) => msg.type === "ready");
    expect(readyMsg).toBeDefined();
    expect(readyMsg?.requestId).toBe("init");
  });

  it("should be ready within timeout", async () => {
    const startTime = Date.now();
    await waitForReady();
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(10000);
  });

  it("should handle multiple spawn attempts", async () => {
    const agent2Process = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const agent2Reader = new JSONStdoutReader(agent2Process.stdout!);
    let readyReceived = false;

    agent2Reader.on("message", (msg: AgentOutputMessage) => {
      if (msg.type === "ready") {
        readyReceived = true;
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));
    expect(readyReceived).toBe(true);

    agent2Process.kill();
  });
});

describe("Agent Spawn Error Handling", () => {
  it("should handle invalid agent path", () => {
    const agentPath = "/invalid/path/to/agent.js";

    expect(() => {
      const agent = spawn("node", [agentPath]);
      agent.kill();
    }).not.toThrow();
  });

  it("should handle agent process crash", () => {
    const crashPath = path.resolve(__dirname, "../../build/src/agent/crash.js");
    if (require("fs").existsSync(crashPath)) {
      const agent = spawn("node", [crashPath]);
      agent.on("exit", (code) => {
        expect(code).not.toBe(0);
      });
      agent.kill();
    } else {
      console.warn("Crash agent not found, skipping test");
    }
  });
});
