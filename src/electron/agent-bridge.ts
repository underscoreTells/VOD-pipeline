import { spawn, ChildProcess } from "child_process";
import path from "path";
import { EventEmitter } from "events";
import { app } from "electron";
import { JSONStdinWriter, JSONStdoutReader } from "../agent/ipc/json-message-transport.js";
import {
  type AgentInputMessage,
  type AgentOutputMessage,
  type AgentInputMessageWithoutId,
} from "../shared/types/agent-ipc.js";
import { v4 as uuidv4 } from "uuid";

const AGENT_STARTUP_TIMEOUT = 10000;
const AGENT_REQUEST_TIMEOUT = 300000;

interface PendingRequest {
  resolve: (value: AgentOutputMessage) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

export class AgentBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdinWriter: JSONStdinWriter | null = null;
  private stdoutReader: JSONStdoutReader | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readyPromise: Promise<void> | null = null;
  private restartAttempts: number = 0;
  private maxRestartAttempts: number = 3;

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("Agent process already started");
    }

    console.log("[AgentBridge] Starting agent worker process...");

    const agentPath = this.getAgentPath();

    this.process = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.stdinWriter = new JSONStdinWriter(this.process.stdin!);
    this.stdoutReader = new JSONStdoutReader(this.process.stdout!);

    this.process.stderr!.on("data", (chunk: Buffer) => {
      console.error(`[Agent] ${chunk.toString()}`);
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[AgentBridge] Agent process exited: ${code} (${signal})`);

      if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
        this.restartAttempts++;
        const backoffMs = Math.pow(2, this.restartAttempts) * 1000;
        console.log(
          `[AgentBridge] Restarting in ${backoffMs}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`
        );
        setTimeout(() => {
          this.process = null;
          this.start().catch((error) => {
            console.error("[AgentBridge] Restart failed:", error);
            this.emit("error", error);
          });
        }, backoffMs);
        return;
      }

      this.emit("exit", code, signal);
    });

    this.process.on("error", (error: Error) => {
      console.error("[AgentBridge] Agent process error:", error);
      this.emit("error", error);
    });

    this.stdoutReader.on("message", this.handleMessage.bind(this));
    this.stdoutReader.on("error", (error: Error) => {
      console.error("[AgentBridge] stdout reader error:", error);
      this.emit("error", error);
    });

    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Agent startup timeout"));
      }, AGENT_STARTUP_TIMEOUT);

      const onReady = (message: any) => {
        if (message.type === "ready") {
          clearTimeout(timeout);
          this.stdoutReader?.removeListener("message", onReady);
          console.log("[AgentBridge] Agent ready");
          resolve();
        }
      };

      this.stdoutReader?.on("message", onReady);
    });

    await this.readyPromise;
    this.restartAttempts = 0;
  }

  private getAgentPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "agent", "index.js");
    } else {
      return path.join(__dirname, "../../agent/index.js");
    }
  }

  private async handleMessage(message: AgentOutputMessage): Promise<void> {
    console.log(`[AgentBridge] Received message type=${message.type}`);

    if (message.type === "progress" || message.type === "token" || message.type === "node-complete") {
      this.emit("stream", message);
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      console.warn(
        `[AgentBridge] No pending request for requestId=${message.requestId}`
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === "graph-complete" || message.type === "error") {
      pending.resolve(message);
    } else {
      pending.reject(new Error(`Unexpected response type: ${message.type}`));
    }
  }

  async send(
    message: AgentInputMessageWithoutId,
    timeoutMs: number = AGENT_REQUEST_TIMEOUT
  ): Promise<AgentOutputMessage> {
    if (!this.stdinWriter) {
      throw new Error("Agent process not started");
    }

    const requestId = uuidv4();
    const fullMessage = {
      ...message,
      requestId,
    } as AgentInputMessage;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(
          new Error(`Agent request timeout: ${requestId} (${timeoutMs}ms)`)
        );
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject: (error) => reject(error),
        timeout,
      });

      if (!this.stdinWriter?.write(fullMessage)) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(new Error("Failed to write to agent stdin"));
      }
    });
  }

  async stop(): Promise<void> {
    console.log("[AgentBridge] Stopping agent...");

    try {
      await this.send({ type: "stop" }, 5000);
    } catch (error) {
      console.warn("[AgentBridge] Failed to send stop signal:", error);
    }

    setTimeout(() => {
      if (this.process) {
        this.process.kill();
      }
    }, 5000);

    this.stdinWriter?.end();
    this.stdoutReader?.removeAllListeners();
    this.process = null;
    this.stdinWriter = null;
    this.stdoutReader = null;

    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent shut down"));
      this.pendingRequests.delete(requestId);
    }

    console.log("[AgentBridge] Agent stopped");
  }
}

let agentBridge: AgentBridge | null = null;

export function getAgentBridge(): AgentBridge {
  if (!agentBridge) {
    agentBridge = new AgentBridge();
  }
  return agentBridge;
}

export function resetAgentBridge(): void {
  agentBridge = null;
}
