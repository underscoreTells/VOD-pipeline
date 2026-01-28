# LangGraph Streaming via child_process

## Overview

Running LangGraph as a separate Node.js child process provides several benefits for Electron/desktop applications:

1. **Process isolation**: Agent failures don't crash the main Electron process
2. **Resource management**: Easy to monitor and restart agent workers
3. **Memory cleanup**: Agent state and large language model contexts are isolated
4. **Scalability**: Can spawn multiple agent workers for parallel processing

This document covers the complete implementation of streaming LangGraph outputs through child_process using JSON-based communication over stdin/stdout.

---

## Table of Contents

1. [LangGraph Streaming Modes](#1-langgraph-streaming-modes)
2. [Child Process JSON Communication Pattern](#2-child-process-json-communication-pattern)
3. [Streaming to Parent Process](#3-streaming-to-parent-process)
4. [Error Handling and Robustness](#4-error-handling-and-robustness)
5. [LangGraph-Specific Considerations](#5-langgraph-specific-considerations)
6. [Complete Code Examples](#6-complete-code-examples)

---

## 1. LangGraph Streaming Modes

### 1.1 Available Stream Modes

LangGraph supports multiple streaming modes for different use cases:

| Mode | Purpose | Output Format |
|------|---------|---------------|
| `"updates"` | Full state after each node | `{ nodeName: stateUpdate }` |
| `"values"` | Complete state after each node | `{ fullState }` |
| `"messages"` | LLM token stream | `MessageChunk[]` |
| `"custom"` | Custom events from `config.writer` | `any[]` |
| `"debug"` | Maximum information | Mixed types |

### 1.2 Using Multiple Stream Modes

To capture both progress updates and LLM tokens, use an array of stream modes:

```typescript
// Streaming both custom progress and LLM tokens
for await (const [mode, chunk] of await graph.stream(input, {
  streamMode: ["custom", "messages"],
})) {
  if (mode === "custom") {
    // Progress updates from config.writer
    handleProgressEvent(chunk);
  } else if (mode === "messages") {
    // LLM token chunks
    handleTokenChunk(chunk);
  }
}
```

### 1.3 Custom Progress Events

Nodes can emit custom events using `config.writer`:

```typescript
import type { GraphNode, LangGraphRunnableConfig } from "@langchain/langgraph";

const analysisNode: GraphNode<typeof State> = async (
  state,
  config: LangGraphRunnableConfig
) => {
  // Emit progress before heavy work
  config.writer?.({
    type: "progress",
    status: "analyzing",
    chapterId: state.chapterId,
    progress: 0,
  });

  // Perform work...
  const result = await someAsyncOperation();

  // Emit completion
  config.writer?.({
    type: "progress",
    status: "complete",
    chapterId: state.chapterId,
    progress: 100,
  });

  return result;
};
```

### 1.4 Streaming LLM Tokens

LLM tokens stream as arrays of message chunks with metadata:

```typescript
for await (const chunk of await graph.stream(input, {
  streamMode: "messages",
})) {
  // chunk format:
  // [
  //   MessageChunk { content: "Hello", role: "assistant", ... },
  //   { langgraph_node: "agent", langgraph_step: 3, ... }
  // ]
  
  const [messageChunk, metadata] = chunk as [MessageChunk, Metadata];
  
  // Identify which node sent this
  const nodeName = metadata.langgraph_node;
  const step = metadata.langgraph_step;
  
  // Accumulate content for display
  const content = messageChunk.content;
  appendToChat(content, nodeName);
}
```

---

## 2. Child Process JSON Communication Pattern

### 2.1 Basic Spawn Configuration

Use `child_process.spawn()` with pipe stdin/stdout:

```typescript
import { spawn } from "node:child_process";

// Spawn the agent worker process
const agentProcess = spawn("node", ["./dist/agent/index.js"], {
  stdio: ["pipe", "pipe", "pipe"], // [stdin, stdout, stderr]
  cwd: process.cwd(),
  env: {
    ...process.env,
    // Pass any required environment variables
    AGENT_MODE: "worker",
  },
  detached: false, // Keep child process attached
  shell: false,    // Direct execution (faster, more secure)
});
```

### 2.2 JSON Message Schema

Define strict schemas for parent-to-child and child-to-parent messages:

#### Parent → Child

```typescript
// Input message schema
export type AgentInputMessage =
  | {
      type: "chat";
      requestId: string;
      threadId?: string;
      projectId: string;
      messages: Array<{ role: string; content: string }>;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "analyze-chapters";
      requestId: string;
      threadId?: string;
      projectId: string;
      chapters: Array<{
        id: string;
        transcript: string;
        videoPath?: string;
      }>;
      instructions: string;
    }
  | {
      type: "pause";
      requestId: string;
    }
  | {
      type: "resume";
      requestId: string;
      threadId: string;
    }
  | {
      type: "stop";
      requestId: string;
    };
```

#### Child → Parent

```typescript
// Output message schema
export type AgentOutputMessage =
  | {
      type: "progress";
      requestId: string;
      chapterId?: string;
      status: string;
      progress: number;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "token";
      requestId: string;
      content: string;
      role: string;
      nodeName: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "node-complete";
      requestId: string;
      nodeName: string;
      output: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "graph-complete";
      requestId: string;
      result: Record<string, unknown>;
      threadId: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
      code?: string;
      details?: Record<string, unknown>;
    };
```

### 2.3 Sending JSON Messages via stdin

Use newline-delimited JSON (NDJSON) for reliable framing:

```typescript
import { Readable } from "node:stream";

class JSONStdinWriter {
  private readonly stdin: Writable;

  constructor(stdin: Writable) {
    this.stdin = stdin;
  }

  write(message: Record<string, unknown>): boolean {
    try {
      // Serialize to JSON
      const json = JSON.stringify(message);
      // Add newline delimiter
      const data = Buffer.from(json + "\n");
      
      return this.stdin.write(data);
    } catch (error) {
      console.error("Failed to write JSON to stdin:", error);
      return false;
    }
  }

  end(): void {
    this.stdin.end();
  }
}
```

### 2.4 Reading JSON Messages from stdout

Handle partial reads and chunk accumulation:

```typescript
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";

class JSONStdoutReader extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private readonly decoder = new TextDecoder();

  constructor(stdout: Readable) {
    super();
    stdout.on("data", this.handleData.bind(this));
    stdout.on("end", this.handleEnd.bind(this));
    stdout.on("error", this.handleError.bind(this));
  }

  private handleData(chunk: Buffer): void {
    // Append to buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Try to extract complete messages
    while (this.buffer.length > 0) {
      // Find newline delimiter
      const newlineIndex = this.buffer.indexOf("\n");

      if (newlineIndex === -1) {
        // No complete message yet
        break;
      }

      // Extract message
      const messageBytes = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);

      // Decode and parse
      const json = this.decoder.decode(messageBytes, { stream: true });
      try {
        const message = JSON.parse(json);
        this.emit("message", message);
      } catch (error) {
        this.emit("error", new Error(`Invalid JSON: ${json}`));
      }
    }
  }

  private handleEnd(): void {
    if (this.buffer.length > 0) {
      // Handle remaining data
      const json = this.decoder.decode(this.buffer);
      try {
        const message = JSON.parse(json);
        this.emit("message", message);
      } catch (error) {
        this.emit("error", new Error(`Invalid JSON on stream end: ${json}`));
      }
    }
    this.emit("close");
  }

  private handleError(error: Error): void {
    this.emit("error", error);
  }
}
```

### 2.5 Message Delimiter Strategy

#### Option 1: Newline-Delimited JSON (NDJSON) - Recommended

```typescript
// Simple, human-readable, works with most tools
const message = { type: "progress", data: "..." };
stdout.write(JSON.stringify(message) + "\n");
```

**Pros:**
- Simple to implement
- Human-readable for debugging
- Works with standard Unix tools (`jq`, etc.)

**Cons:**
- Messages cannot contain newlines
- Slightly larger overhead

#### Option 2: Length-Prefixed Binary

```typescript
// More efficient, handles any binary content
const message = { type: "progress", data: "..." };
const json = JSON.stringify(message);
const length = Buffer.byteLength(json);
const header = Buffer.alloc(4);
header.writeUInt32BE(length); // 32-bit length prefix

stdout.write(Buffer.concat([header, Buffer.from(json)]));
```

**Pros:**
- Explicit length, no parsing ambiguity
- Can handle any content including newlines
- More efficient for large messages

**Cons:**
- More complex implementation
- Binary format not human-readable

#### Option 3: Custom Delimiter

```typescript
// Use a delimiter unlikely to appear in JSON
const DELIMITER = "\u0000\u0000"; // Double null byte

const message = { type: "progress", data: "..." };
stdout.write(JSON.stringify(message) + DELIMITER);
```

---

## 3. Streaming to Parent Process

### 3.1 Graph Stream Multiplexer

Wrap LangGraph stream to send events over stdout:

```typescript
import { StateGraph } from "@langchain/langgraph";
import { Readable, Writable } from "node:stream";

class GraphStreamMultiplexer {
  private readonly requestId: string;
  private readonly stdout: Writable;

  constructor(requestId: string, stdout: Writable) {
    this.requestId = requestId;
    this.stdout = stdout;
  }

  async streamGraph(
    graph: CompiledGraph<any, any, any, any>,
    input: Record<string, unknown>,
    options: {
      threadId?: string;
      streamMode?: Array<string>;
    } = {}
  ): Promise<void> {
    const { threadId, streamMode = ["custom", "messages"] } = options;

    try {
      // Stream the graph
      const stream = await graph.stream(input, {
        configurable: threadId ? { thread_id: threadId } : undefined,
        streamMode,
      });

      // Process stream chunks
      for await (const [mode, chunk] of stream) {
        if (mode === "custom") {
          this.sendCustomEvent(chunk);
        } else if (mode === "messages") {
          await this.sendMessageChunk(chunk);
        } else if (mode === "updates") {
          this.sendNodeUpdate(chunk);
        }
      }

      // Get final state
      const finalState = await graph.getState({
        configurable: threadId ? { thread_id: threadId } : undefined,
      });

      // Send completion
      this.sendMessage({
        type: "graph-complete",
        requestId: this.requestId,
        result: finalState.values,
        threadId: threadId ?? "",
      });
    } catch (error) {
      this.sendError(error as Error);
    }
  }

  private sendCustomEvent(data: unknown): void {
    this.sendMessage({
      type: "progress",
      requestId: this.requestId,
      ...(data as Record<string, unknown>),
    });
  }

  private async sendMessageChunk(
    chunk: [MessageChunk, Metadata]
  ): Promise<void> {
    const [messageChunk, metadata] = chunk;
    this.sendMessage({
      type: "token",
      requestId: this.requestId,
      content: messageChunk.content as string,
      role: messageChunk.role,
      nodeName: metadata.langgraph_node,
      metadata: {
        step: metadata.langgraph_step,
        tags: metadata.tags,
      },
    });
  }

  private sendNodeUpdate(chunk: Record<string, unknown>): void {
    const nodeName = Object.keys(chunk)[0];
    const output = chunk[nodeName];

    this.sendMessage({
      type: "node-complete",
      requestId: this.requestId,
      nodeName,
      output,
    });
  }

  private sendError(error: Error): void {
    this.sendMessage({
      type: "error",
      requestId: this.requestId,
      error: error.message,
      code: error.name,
      details: { stack: error.stack },
    });
  }

  private sendMessage(message: AgentOutputMessage): boolean {
    try {
      const json = JSON.stringify(message);
      return this.stdout.write(json + "\n");
    } catch (error) {
      console.error("Failed to send message:", error);
      return false;
    }
  }
}
```

### 3.2 Child Process LangGraph Wrapper

Complete child process entry point:

```typescript
// ./src/agent/index.ts
import { createGraph } from "./graphs/main-orchestrator";
import { JSONStdinReader } from "./ipc/json-stdin-reader";
import { GraphStreamMultiplexer } from "./ipc/graph-stream-multiplexer";

const graph = createGraph();
const stdinReader = new JSONStdinReader(process.stdin);

interface RequestTracker {
  [requestId: string]: {
    active: boolean;
    threadId?: string;
  };
}

const activeRequests: RequestTracker = {};

stdinReader.on("message", async (message: AgentInputMessage) => {
  const { type, requestId } = message;

  console.error(`[Agent] Received ${type} request: ${requestId}`);

  if (type === "pause" || type === "stop") {
    // Handle cancellation (would require AbortSignal support)
    const request = activeRequests[requestId];
    if (request?.active) {
      request.active = false;
      sendMessage({
        type: "graph-complete",
        requestId,
        result: { status: "cancelled" },
        threadId: request.threadId ?? "",
      });
    }
    return;
  }

  if (type === "resume") {
    // Resume from thread
    const multiplexer = new GraphStreamMultiplexer(
      requestId,
      process.stdout
    );
    await multiplexer.streamGraph(graph, {}, { threadId: message.threadId });
    return;
  }

  // Track request
  activeRequests[requestId] = {
    active: true,
    threadId: message.threadId,
  };

  // Create stream multiplexer
  const multiplexer = new GraphStreamMultiplexer(requestId, process.stdout);

  try {
    // Execute based on message type
    switch (type) {
      case "chat":
        await multiplexer.streamGraph(
          graph,
          { messages: message.messages },
          { threadId: message.threadId }
        );
        break;

      case "analyze-chapters":
        await multiplexer.streamGraph(
          graph,
          {
            projectId: message.projectId,
            chapters: message.chapters,
            instructions: message.instructions,
          },
          { threadId: message.threadId }
        );
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } finally {
    delete activeRequests[requestId];
  }
});

stdinReader.on("error", (error: Error) => {
  console.error("[Agent] stdin error:", error);
  process.exit(1);
});

// Keep process alive
console.error("[Agent] Worker process started");
```

---

## 4. Error Handling and Robustness

### 4.1 Process Crash Detection

Monitor child process for unexpected termination:

```typescript
class AgentProcessManager extends EventEmitter {
  private process?: ChildProcess;
  private restartAttempts = 0;
  private readonly maxRestarts = 3;
  private restartDelay = 1000; // ms, exponential backoff

  async spawn(): Promise<void> {
    this.process = spawn("node", ["./dist/agent/index.js"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.on("exit", (code, signal) => {
      console.error(
        `[Agent] Process exited with code ${code}, signal ${signal}`
      );

      if (!this.isShuttingDown && code !== 0) {
        this.handleCrash();
      }
    });

    this.process.on("error", (error) => {
      console.error("[Agent] Process error:", error);
      this.emit("error", error);
    });

    // Wait for ready signal
    await this.waitForReady();
  }

  private async handleCrash(): Promise<void> {
    if (this.restartAttempts >= this.maxRestarts) {
      this.emit("error", new Error("Max restart attempts exceeded"));
      return;
    }

    this.restartAttempts++;
    this.restartDelay *= 2; // Exponential backoff

    console.log(
      `[Agent] Restarting process (attempt ${this.restartAttempts})`
    );

    await new Promise((resolve) => setTimeout(resolve, this.restartDelay));
    await this.spawn();
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Agent process failed to start"));
      }, 10000);

      // Assume process sends ready message
      this.stdoutReader.once("message", (message) => {
        if (message.type === "ready") {
          clearTimeout(timeout);
          resolve(undefined);
        }
      });
    });
  }

  kill(): void {
    this.isShuttingDown = true;
    this.process?.kill("SIGTERM");
  }
}
```

### 4.2 Timeout Handling

Implement per-request timeouts:

```typescript
class AgentClient {
  private readonly process: ChildProcess;
  private pendingRequests = new Map<
    string,
    {
      timeout: NodeJS.Timeout;
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  >;

  async sendRequest(
    message: AgentInputMessage,
    timeoutMs = 300000 // 5 minutes default
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const { requestId } = message;

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${requestId}`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(requestId, { timeout, resolve, reject });

      // Send message
      this.stdinWriter.write(message);
    });
  }

  handleResponse(message: AgentOutputMessage): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);

    if (message.type === "error") {
      pending.reject(new Error(message.error));
    } else if (message.type === "graph-complete") {
      pending.resolve(message);
    }
    // Other types are stream events, not final responses
  }
}
```

### 4.3 Backpressure Management

Handle cases where child process produces output faster than parent can process:

```typescript
class BackpressureAwareWriter {
  private readonly stdout: Writable;
  private writeQueue: Array<Buffer> = [];
  private writing = false;
  private highWaterMark = 64 * 1024; // 64KB

  constructor(stdout: Writable) {
    this.stdout = stdout;

    // Handle drain event when buffer is cleared
    this.stdout.on("drain", () => {
      this.processQueue();
    });
  }

  write(data: Buffer): void {
    this.writeQueue.push(data);
    this.processQueue();
  }

  private processQueue(): void {
    if (this.writing || this.writeQueue.length === 0) {
      return;
    }

    if (this.stdout.writableLength >= this.highWaterMark) {
      // Backpressure: wait for drain
      return;
    }

    const data = this.writeQueue[0];
    this.writeQueue.shift();

    this.writing = true;
    const written = this.stdout.write(data, () => {
      this.writing = false;
      this.processQueue();
    });

    if (!written) {
      // Backpressured, drain event will trigger next write
    }
  }
}
```

### 4.4 Graceful Shutdown

Handle SIGTERM and cleanup:

```typescript
// In child process
process.on("SIGTERM", async () => {
  console.error("[Agent] Received SIGTERM, shutting down...");

  // Cancel all active requests
  for (const [requestId, request] of Object.entries(activeRequests)) {
    if (request.active) {
      sendMessage({
        type: "error",
        requestId,
        error: "Process shutting down",
        code: "SHUTDOWN",
      });
    }
  }

  // Close stdin to signal no more input
  process.stdin.end();

  // Give time for pending writes to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[Agent] Received SIGINT, shutting down...");
  process.exit(0);
});

// In parent process
async function shutdownAgent(process: ChildProcess): Promise<void> {
  console.log("[Main] Shutting down agent...");

  // Send graceful shutdown signal
  stdinWriter.write({ type: "stop", requestId: "shutdown" });

  // Wait for graceful exit
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error("Force kill after timeout"));
      }, 5000);

      process.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } catch (error) {
    console.error("[Main] Agent did not exit gracefully:", error);
  }
}
```

---

## 5. LangGraph-Specific Considerations

### 5.1 State Management Across Process Boundaries

#### Thread ID for Checkpointer Persistence

Pass thread ID in requests to maintain conversation history:

```typescript
// Parent process sends thread ID
const response = await agent.sendRequest({
  type: "chat",
  requestId: generateId(),
  threadId: project.threadId, // Persisted conversation ID
  messages: [{ role: "user", content: "Continue analysis" }],
});

// Child process uses thread ID in config
const result = await graph.stream(input, {
  configurable: { thread_id: message.threadId },
  streamMode: ["custom", "messages"],
});
```

#### State Snapshots

Send state snapshots for manual inspection or recovery:

```typescript
// In child process, after each completion
const state = await graph.getState({
  configurable: { thread_id: threadId },
});

sendMessage({
  type: "state-snapshot",
  requestId,
  threadId,
  state: state.values,
  checkpoint: state.next,
});

// Parent process can stash this for recovery
stateSnapshots[threadId] = snapshot;
```

### 5.2 Subgraph Output Streaming

Handle subgraph events with namespace information:

```typescript
for await (const [mode, chunk] of await graph.stream(input, {
  streamMode: ["custom", "messages"],
  subgraphs: true,
})) {
  if (mode === "custom") {
    // chunk format: [namespace, data]
    // namespace: ["chapter_agent:123", "narrative_node:456"]
    const [namespace, data] = chunk as [string[], any];

    const subgraphPath = namespace.join("/");
    const subgraphName = namespace[0] ?? "";

    sendMessage({
      type: "progress",
      requestId,
      subgraphName,
      subgraphPath,
      ...(data as Record<string, unknown>),
    });
  }
}
```

### 5.3 Context Window Management

Send large data (transcripts) by reference, not value:

```typescript
// Don't do this (large payload):
{
  "type": "analyze-chapters",
  "chapters": [
    {
      "id": "1",
      "transcript": "<<< 2MB of text >>>" // Too large for IPC!
    }
  ]
}

// Do this (reference):
{
  "type": "analyze-chapters",
  "projectId": "123",
  "chapterIds": ["chapter-1", "chapter-2"]
}

// Child process loads transcripts from shared database:
const transcript = await db.getTranscript(chapterId);
```

### 5.4 AbortSignal for Cancellation

LangGraph supports cancellation via AbortSignal:

```typescript
// In child process
const abortControllers = new Map<string, AbortController>();

stdinReader.on("message", async (message) => {
  if (message.type === "stop" || message.type === "pause") {
    const controller = abortControllers.get(message.requestId);
    controller?.abort();
    abortControllers.delete(message.requestId);
    return;
  }

  // Create new abort controller for request
  const controller = new AbortController();
  abortControllers.set(message.requestId, controller);

  try {
    const result = await graph.stream(input, {
      configurable: { thread_id: message.threadId },
      streamMode: ["custom", "messages"],
      signal: controller.signal,
    });
    // Process stream...
  } finally {
    abortControllers.delete(message.requestId);
  }
});
```

---

## 6. Complete Code Examples

### 6.1 Parent Process Code

```typescript
// ./src/electron/ipc/agent-bridge.ts
import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { 
  AgentInputMessage, 
  AgentOutputMessage 
} from "$shared/types/agent-ipc";
import {
  JSONStdinWriter,
  JSONStdoutReader,
} from "./ipc/json-message-transport";
import { app } from "electron";

export class AgentBridge extends EventEmitter {
  private process?: ChildProcess;
  private stdinWriter?: JSONStdinWriter;
  private stdoutReader?: JSONStdoutReader;
  private pendingRequests = new Map<
    string,
    {
      timeout: NodeJS.Timeout;
      resolve: (value: AgentOutputMessage) => void;
      reject: (reason: unknown) => void;
    }
  >();

  async start(): Promise<void> {
    const agentPath = app.isPackaged
      ? path.join(process.resourcesPath, "agent", "index.js")
      : path.join(__dirname, "../../agent/index.js");

    this.process = spawn("node", [agentPath], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "development",
      },
    });

    // Set up stdin writer
    this.stdinWriter = new JSONStdinWriter(this.process.stdin!);

    // Set up stdout reader
    this.stdoutReader = new JSONStdoutReader(this.process.stdout!);
    this.stdoutReader.on("message", this.handleMessage.bind(this));
    this.stdoutReader.on("error", (error) => {
      console.error("[AgentBridge] stdout error:", error);
      this.emit("error", error);
    });

    // Handle stderr
    this.process.stderr.on("data", (data) => {
      console.error(`[Agent] stderr: ${data}`);
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      console.log(`[AgentBridge] Process exited: ${code} (${signal})`);
      this.emit("exit", code, signal);
    });

    this.process.on("error", (error) => {
      console.error("[AgentBridge] Process error:", error);
      this.emit("error", error);
    });

    // Wait for ready signal
    await this.waitForReady();
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Agent process failed to start within 10s"));
      }, 10000);

      const handler = (message: AgentOutputMessage) => {
        if (message.type === "ready") {
          clearTimeout(timeout);
          this.stdoutReader?.off("message", handler);
          resolve(undefined);
        }
      };

      this.stdoutReader?.on("message", handler);
    });
  }

  async send(
    message: Omit<AgentInputMessage, "requestId">,
    timeoutMs = 300_000
  ): Promise<AgentOutputMessage> {
    const requestId = uuidv4();
    const fullMessage = { ...message, requestId } as AgentInputMessage;

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Agent request timeout: ${requestId}`));
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(requestId, {
        timeout,
        resolve: (value) => {
          resolve(value);
        },
        reject: (reason) => {
          reject(reason);
        },
      });

      // Send message
      const written = this.stdinWriter?.write(fullMessage);
      if (!written) {
        // Handle backpressure
        this.stdinWriter?.drain(() => {
          // Retry after drain
        });
      }
    });
  }

  private handleMessage(message: AgentOutputMessage): void {
    const { requestId } = message;
    const pending = this.pendingRequests.get(requestId);

    // Stream events don't have pending responses
    if (
      message.type === "progress" ||
      message.type === "token" ||
      message.type === "node-complete"
    ) {
      this.emit("stream", message);
      return;
    }

    // Resolve/reject pending request
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      if (message.type === "error") {
        pending.reject(
          new Error(`Agent error (${message.code}): ${message.error}`)
        );
      } else {
        pending.resolve(message);
      }
    } else {
      // Orphaned response (no pending request)
      console.warn(`[AgentBridge] Orphaned response: ${requestId}`);
    }
  }

  async stop(): Promise<void> {
    // Send graceful shutdown
    try {
      await this.send({ type: "stop" }, 5000);
    } catch (error) {
      // Ignore errors during shutdown
    }

    // Force kill after timeout
    setTimeout(() => {
      this.process?.kill("SIGKILL");
    }, 1000);
  }

  onStream(callback: (message: AgentOutputMessage) => void): void {
    this.on("stream", callback);
  }

  onError(callback: (error: Error) => void): void {
    this.on("error", callback);
  }

  onExit(callback: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.on("exit", callback);
  }
}

// Singleton instance
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
```

### 6.2 Child Process Code

```typescript
// ./src/agent/index.ts
import process from "node:process";
import { createOrchestratorGraph } from "./graphs/main-orchestrator";
import {
  JSONStdinWriter,
  JSONStdoutReader,
} from "./ipc/json-message-transport";
import type {
  AgentInputMessage,
  AgentOutputMessage,
} from "$shared/types/agent-ipc";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "node:path";

// Initialize checkpointer
const checkpointer = SqliteSaver.fromConnString("file:./.data/checkpoints.db");
await checkpointer.setup();

// Create graph
const graph = createOrchestratorGraph({ checkpointer });

// Set up IPC
const stdin = new JSONStdoutReader(process.stdin);
const stdout = new JSONStdinWriter(process.stdout);

// Active requests with abort controllers
const activeRequests = new Map<
  string,
  AbortController
>();

// Send ready signal
stdout.write({
  type: "ready",
  requestId: "init",
});

// Handle incoming messages
stdin.on("message", async (message: AgentInputMessage) => {
  const { type, requestId, threadId } = message;

  console.error(`[Agent] ${type} ${requestId}`);

  // Handle control messages
  if (type === "stop" || type === "pause") {
    const controller = activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      activeRequests.delete(requestId);
      
      stdout.write({
        type: "graph-complete",
        requestId,
        result: { status: "cancelled" },
        threadId: threadId ?? "",
      });
    }
    return;
  }

  if (type === "resume") {
    // Resume from checkpoint
    await processRequest(message, { threadId });
    return;
  }

  // Process request
  await processRequest(message, { threadId });
});

async function processRequest(
  message: AgentInputMessage,
  options: { threadId?: string }
): Promise<void> {
  const { type, requestId } = message;

  // Create abort controller
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    let input: Record<string, unknown> = {};

    // Convert message to graph input
    switch (type) {
      case "chat":
        input = { messages: message.messages };
        break;

      case "analyze-chapters":
        input = {
          projectId: message.projectId,
          chapterIds: message.chapters.map((c) => c.id),
          instructions: message.instructions,
        };
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    // Stream graph execution
    await streamGraph(graph, input, requestId, options.threadId);
  } catch (error) {
    sendError(requestId, error as Error);
  } finally {
    activeRequests.delete(requestId);
  }
}

async function streamGraph(
  graph: CompiledGraph<any, any, any, any>,
  input: Record<string, unknown>,
  requestId: string,
  threadId?: string
): Promise<void> {
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    // Start stream
    const stream = await graph.stream(input, {
      configurable: threadId ? { thread_id: threadId } : undefined,
      streamMode: ["custom", "messages"],
      signal: controller.signal,
    });

    // Process chunks
    for await (const [mode, chunk] of stream) {
      if (mode === "custom") {
        // Progress events
        stdout.write({
          type: "progress",
          requestId,
          ...(chunk as Record<string, unknown>),
        } as AgentOutputMessage);
      } else if (mode === "messages") {
        // LLM token events
        const [messageChunk, metadata] = chunk as [
          MessageChunk,
          Record<string, unknown>
        ];
        stdout.write({
          type: "token",
          requestId,
          content: messageChunk.content as string,
          role: messageChunk.role,
          nodeName: metadata.langgraph_node as string,
        } as AgentOutputMessage);
      }
    }

    // Get final state
    const finalState = await graph.getState({
      configurable: threadId ? { thread_id: threadId } : undefined,
    });

    // Send completion
    stdout.write({
      type: "graph-complete",
      requestId,
      result: finalState.values,
      threadId: threadId ?? "",
    } as AgentOutputMessage);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      // Cancelled by user
      console.error(`[Agent] Request cancelled: ${requestId}`);
    } else {
      sendError(requestId, error as Error);
    }
  } finally {
    activeRequests.delete(requestId);
  }
}

function sendError(requestId: string, error: Error): void {
  console.error(`[Agent] Error: ${error.message}`);
  stdout.write({
    type: "error",
    requestId,
    error: error.message,
    code: error.name,
    details: { stack: error.stack },
  } as AgentOutputMessage);
}

// Handle shutdown
process.on("SIGTERM", async () => {
  console.error("[Agent] SIGTERM received");

  // Cancel all active requests
  for (const [requestId, controller] of activeRequests.entries()) {
    controller.abort();
    stdout.write({
      type: "error",
      requestId,
      error: "Process shutting down",
      code: "SHUTDOWN",
    });
  }

  // Shutdown stdin
  process.stdin.end();

  // Wait briefly for pending writes
  await new Promise((resolve) => setTimeout(resolve, 500));

  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[Agent] SIGINT received");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("[Agent] Uncaught exception:", error);
  process.exit(1);
});
```

### 6.3 Shared Type Definitions

```typescript
// ./src/shared/types/agent-ipc.ts
import type { MessageChunk } from "@langchain/core/messages";

// ============ Parent -> Child ============

export type AgentInputMessage =
  | ChatInputMessage
  | AnalyzeChaptersInputMessage
  | PauseInputMessage
  | ResumeInputMessage
  | StopInputMessage;

export interface ChatInputMessage {
  type: "chat";
  requestId: string;
  threadId?: string;
  messages: Array<{ role: string; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeChaptersInputMessage {
  type: "analyze-chapters";
  requestId: string;
  threadId?: string;
  projectId: string;
  chapters: Array<{
    id: string;
    transcript: string;
    videoPath?: string;
  }>;
  instructions: string;
}

export interface PauseInputMessage {
  type: "pause";
  requestId: string;
}

export interface ResumeInputMessage {
  type: "resume";
  requestId: string;
  threadId: string;
}

export interface StopInputMessage {
  type: "stop";
  requestId: string;
}

// ============ Child -> Parent ============

export type AgentOutputMessage =
  | ProgressOutputMessage
  | TokenOutputMessage
  | NodeCompleteOutputMessage
  | GraphCompleteOutputMessage
  | ErrorOutputMessage
  | ReadyOutputMessage;

export interface ProgressOutputMessage {
  type: "progress";
  requestId: string;
  status: string;
  progress: number;
  chapterId?: string;
  subgraphName?: string;
  subgraphPath?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenOutputMessage {
  type: "token";
  requestId: string;
  content: string;
  role: string;
  nodeName: string;
  metadata?: Record<string, unknown>;
}

export interface NodeCompleteOutputMessage {
  type: "node-complete";
  requestId: string;
  nodeName: string;
  output: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GraphCompleteOutputMessage {
  type: "graph-complete";
  requestId: string;
  result: Record<string, unknown>;
  threadId: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorOutputMessage {
  type: "error";
  requestId: string;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface ReadyOutputMessage {
  type: "ready";
  requestId: string;
}
```

### 6.4 JSON Message Transport Utilities

```typescript
// ./src/electron/ipc/json-message-transport.ts
import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";

// ============ Stdin Reader ============

export class JSONStdoutReader extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private decoder = new TextDecoder();

  constructor(stdout: Readable) {
    super();
    stdout.on("data", this.handleData.bind(this));
    stdout.on("end", this.handleEnd.bind(this));
    stdout.on("error", this.handleError.bind(this));
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      const newlineIndex = this.buffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const messageBytes = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);

      const json = this.decoder.decode(messageBytes, { stream: true });
      try {
        const message = JSON.parse(json);
        this.emit("message", message);
      } catch (error) {
        this.emit(
          "error",
          new Error(`Invalid JSON: ${json}\nOriginal error: ${error}`)
        );
      }
    }
  }

  private handleEnd(): void {
    if (this.buffer.length > 0) {
      const json = this.decoder.decode(this.buffer);
      try {
        const message = JSON.parse(json);
        this.emit("message", message);
      } catch (error) {
        this.emit(
          "error",
          new Error(`Invalid JSON on end: ${json}\nOriginal error: ${error}`)
        );
      }
    }
    this.emit("close");
  }

  private handleError(error: Error): void {
    this.emit("error", error);
  }
}

// ============ Stdout Writer ============

export class JSONStdinWriter {
  private readonly stdout: Writable;

  constructor(stdout: Writable) {
    this.stdout = stdout;
  }

  write(message: Record<string, unknown>): boolean {
    try {
      const json = JSON.stringify(message);
      const data = Buffer.from(json + "\n");
      return this.stdout.write(data);
    } catch (error) {
      console.error("Failed to write JSON to stdin:", error);
      return false;
    }
  }

  writeSync(message: Record<string, unknown>): void {
    const json = JSON.stringify(message);
    const data = Buffer.from(json + "\n");
    this.stdout.writeSync(data);
  }

  end(): void {
    this.stdout.end();
  }
}
```

---

## Best Practices Summary

### JSON Communication

1. **Use NDJSON (newline-delimited JSON)** for simplicity and debuggability
2. **Always include a `requestId`** to track request-response pairs
3. **Validate message schemas** on both ends to catch errors early
4. **Set timeouts on requests** to handle hung processes
5. **Implement backpressure handling** for high-throughput scenarios

### LangGraph Integration

1. **Use both `custom` and `messages` stream modes** for progress and tokens
2. **Emit progress events via `config.writer`** from nodes
3. **Pass thread IDs** for conversation persistence across calls
4. **Use AbortSignal** for cancellation support
5. **Stream subgraph outputs** when using multi-agent patterns

### Error Handling

1. **Monitor process exit codes** and implement restart logic
2. **Implement exponential backoff** for restart attempts
3. **Send explicit error messages** with codes and details
4. **Handle orphaned responses** (responses after timeout)
5. **Implement graceful shutdown** with SIGTERM handling

### Resource Management

1. **Limit concurrent requests** to prevent memory exhaustion
2. **Clean up pending requests** on process exit
3. **Use reference-based payloads** for large data (transcripts)
4. **Monitor memory usage** and implement safeguards
5. **Use database for persistence** rather than IPC for large state

### Debugging

1. **Log all IPC messages** in development mode
2. **Include process IDs** in all log messages
3. **Use `console.error` for child process logging** (visible via stderr)
4. **Implement health check pings** for process monitoring
5. **Capture stack traces** in error messages

---

## References

- [Node.js child_process documentation](https://nodejs.org/api/child_process.html)
- [LangGraph streaming docs](https://js.langchain.com/docs/langgraph/streaming)
- [LangGraph.js GitHub repository](https://github.com/langchain-ai/langgraphjs)
- [IPC patterns for Node.js](https://nodejs.org/en/docs/guides/simple-profiling/)
- [Stream API in Node.js](https://nodejs.org/api/stream.html)
