import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { app } from "electron";
import { JSONStdinWriter, JSONStdoutReader } from "../agent/ipc/json-message-transport.js";
import {
  type AgentInputMessage,
  type AgentOutputMessage,
  type AgentInputMessageWithoutId,
  type AgentStreamContext,
} from "../shared/types/agent-ipc.js";
import { v4 as uuidv4 } from "uuid";
import { enrichAgentStreamEvent } from "./agent-stream-events.js";

const AGENT_STARTUP_TIMEOUT = 10000;
const AGENT_REQUEST_TIMEOUT = 300000;

interface PendingRequest {
  resolve: (value: AgentOutputMessage) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
  streamContext?: AgentStreamContext;
  onStreamEvent?: (message: AgentOutputMessage) => void;
}

interface SendOptions {
  timeoutMs?: number;
  streamContext?: AgentStreamContext;
  onStreamEvent?: (message: AgentOutputMessage) => void;
}

export class AgentBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdinWriter: JSONStdinWriter | null = null;
  private stdoutReader: JSONStdoutReader | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private readyPromise: Promise<void> | null = null;
  private restartAttempts: number = 0;
  private maxRestartAttempts: number = 3;

  private emitBridgeError(error: Error): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error);
      return;
    }

    console.error("[AgentBridge] Unhandled bridge error:", error);
  }

  async ensureStarted(): Promise<void> {
    if (this.process) {
      if (this.readyPromise) {
        await this.readyPromise;
      }
      return;
    }

    await this.start();
  }

  private rejectPendingRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(requestId);
    }
  }

  private clearProcessReferences(): void {
    this.stdinWriter = null;
    this.stdoutReader?.removeAllListeners();
    this.stdoutReader = null;
    this.process = null;
    this.readyPromise = null;
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("Agent process already started");
    }

    console.log("[AgentBridge] Starting agent worker process...");

    const agentPath = this.getAgentPath();

    const checkpointerDbPath = path.join(app.getPath("userData"), "agent-checkpoints.db");

    this.process = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_CHECKPOINTER_DB_PATH: checkpointerDbPath,
      },
    });

    this.stdinWriter = new JSONStdinWriter(this.process.stdin!);
    this.stdoutReader = new JSONStdoutReader(this.process.stdout!);

    this.process.stderr!.on("data", (chunk: Buffer) => {
      console.error(`[Agent] ${chunk.toString()}`);
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[AgentBridge] Agent process exited: ${code} (${signal})`);

      this.clearProcessReferences();
      this.rejectPendingRequests(
        `Agent process exited: ${code ?? "unknown"} (${signal ?? "unknown"})`
      );

      this.emit("exit", code, signal);

      if (code !== 0 && this.restartAttempts < this.maxRestartAttempts) {
        this.restartAttempts++;
        const backoffMs = Math.pow(2, this.restartAttempts) * 1000;
        console.log(
          `[AgentBridge] Restarting in ${backoffMs}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`
        );
        setTimeout(() => {
          this.start().catch((error) => {
            console.error("[AgentBridge] Restart failed:", error);
            this.emitBridgeError(error);
          });
        }, backoffMs);
        return;
      }
    });

    this.process.on("error", (error: Error) => {
      console.error("[AgentBridge] Agent process error:", error);
      this.clearProcessReferences();
      this.rejectPendingRequests(`Agent process error: ${error.message}`);
      this.emitBridgeError(error);
    });

    this.stdoutReader.on("message", this.handleMessage.bind(this));
    this.stdoutReader.on("stream-error", (error: Error) => {
      console.error("[AgentBridge] stdout reader error:", error);
      this.emitBridgeError(error);
    });

    this.stdoutReader.on("parse-error", (error: Error) => {
      console.warn("[AgentBridge] stdout parse error:", error);
    });

    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stdoutReader?.removeListener("message", onReady);
        this.stdoutReader?.removeListener("close", onClose);
        reject(new Error("Agent startup timeout"));
      }, AGENT_STARTUP_TIMEOUT);

      const onReady = (message: any) => {
        if (message.type === "ready") {
          clearTimeout(timeout);
          this.stdoutReader?.removeListener("message", onReady);
          this.stdoutReader?.removeListener("close", onClose);
          console.log("[AgentBridge] Agent ready");
          resolve();
        }
      };

      const onClose = () => {
        clearTimeout(timeout);
        this.stdoutReader?.removeListener("message", onReady);
        reject(new Error("Agent process closed before ready"));
      };

      this.stdoutReader?.on("message", onReady);
      this.stdoutReader?.once("close", onClose);
    });

    await this.readyPromise;
    this.restartAttempts = 0;
  }

  private getAgentPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "agent", "index.js");
    } else {
      // ES module compatible __dirname replacement
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      return path.join(__dirname, "../agent/index.js");
    }
  }

  private async handleMessage(message: AgentOutputMessage): Promise<void> {
    console.log(`[AgentBridge] Received message type=${message.type}`);

    const pending = this.pendingRequests.get(message.requestId);

    if (message.type === "progress" || message.type === "token") {
      if (!pending) {
        console.warn(
          `[AgentBridge] No pending request for stream requestId=${message.requestId}`
        );
        return;
      }

      pending.onStreamEvent?.(message);
      const streamEvent = enrichAgentStreamEvent(message, pending.streamContext);
      if (streamEvent) {
        this.emit("stream", streamEvent);
      }
      return;
    }

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
    options: SendOptions = {}
  ): Promise<AgentOutputMessage> {
    const stdinWriter = this.stdinWriter;
    if (!stdinWriter) {
      throw new Error("Agent process not started");
    }

    const { timeoutMs = AGENT_REQUEST_TIMEOUT, streamContext, onStreamEvent } = options;

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
        streamContext,
        onStreamEvent,
      });

      stdinWriter
        .writeAsync(fullMessage)
        .catch((error) => {
          clearTimeout(timeout);
          this.pendingRequests.delete(requestId);
          const message =
            error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to write to agent stdin: ${message}`));
        });
    });
  }

  async stop(): Promise<void> {
    console.log("[AgentBridge] Stopping agent...");

    try {
      await this.send({ type: "stop" }, { timeoutMs: 5000 });
    } catch (error) {
      console.warn("[AgentBridge] Failed to send stop signal:", error);
    }

    setTimeout(() => {
      if (this.process) {
        this.process.kill();
      }
    }, 5000);

    this.stdinWriter?.end();
    this.clearProcessReferences();
    this.rejectPendingRequests("Agent shut down");

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
