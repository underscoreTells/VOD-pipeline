import { loadConfig } from "./config.js";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createMainGraph } from "./graphs/main-orchestrator.js";
import { JSONStdinWriter, JSONStdoutReader } from "./ipc/json-message-transport.js";
import { v4 as uuidv4 } from "uuid";
import type { AgentInputMessage } from "../shared/types/agent-ipc.js";

const activeRequests = new Map<string, AbortController>();

async function main() {
  console.error("[Agent] Worker process starting...");

  try {
    const config = await loadConfig();
    console.error("[Agent] Config loaded, default provider:", config.defaultProvider);

    const dbPath = `${process.env.HOME || process.env.USERPROFILE}/.vod-pipeline/vod-pipeline.db`;
    const checkpointer = SqliteSaver.fromConnString(`file:${dbPath}`);
    console.error("[Agent] Checkpointer initialized at:", dbPath);

    const mainGraph = await createMainGraph({ checkpointer });
    console.error("[Agent] Main graph created");

    const inputReader = new JSONStdoutReader(process.stdin);
    const outputWriter = new JSONStdinWriter(process.stdout);

    inputReader.on("message", async (message: AgentInputMessage) => {
      const { type, requestId } = message;
      const threadId = "threadId" in message ? message.threadId : undefined;

      console.error(`[Agent] Received message type=${type} requestId=${requestId}`);

      const controller = new AbortController();
      activeRequests.set(requestId, controller);

      try {
        await processMessage(message, mainGraph, outputWriter, controller);
      } catch (error) {
        console.error(`[Agent] Error processing request ${requestId}:`, error);
        outputWriter.write({
          type: "error",
          requestId,
          error: String(error),
          code: "PROCESSING_ERROR",
        });
      } finally {
        activeRequests.delete(requestId);
      }
    });

    inputReader.on("error", (error: Error) => {
      console.error("[Agent] Input reader error:", error);
    });

    inputReader.on("close", () => {
      console.error("[Agent] Input closed, shutting down...");
    });

    process.stdin.resume();

    outputWriter.write({ type: "ready", requestId: "init" });
    console.error("[Agent] Ready signal sent");

  } catch (error) {
    console.error("[Agent] Fatal error during initialization:", error);
    process.exit(1);
  }
}

async function processMessage(
  message: AgentInputMessage,
  graph: any,
  writer: JSONStdinWriter,
  controller: AbortController
): Promise<void> {
  const { type, requestId } = message;
  const threadId = "threadId" in message ? message.threadId : undefined;

  const config: any = {};
  if (threadId) {
    config.configurable = { thread_id: threadId };
  }
  config.signal = controller.signal;

  switch (type) {
    case "chat":
      await streamGraph(graph, message.messages || [], requestId, config, writer);
      break;

    case "stop":
      const targetController = activeRequests.get(message.requestId);
      if (targetController) {
        targetController.abort();
      }
      break;

    case "analyze-chapters":
      console.error("[Agent] analyze-chapters not implemented yet in Phase 2");
      writer.write({
        type: "error",
        requestId,
        error: "analyze-chapters not implemented",
        code: "NOT_IMPLEMENTED",
      });
      break;

    default:
      writer.write({
        type: "error",
        requestId,
        error: `Unknown message type: ${type}`,
        code: "UNKNOWN_MESSAGE_TYPE",
      });
  }
}

async function streamGraph(
  graph: any,
  messages: any[],
  requestId: string,
  config: any,
  writer: JSONStdinWriter
): Promise<void> {
  const stream = await graph.streamInput(
    { messages },
    {
      ...config,
      streamMode: ["custom", "messages"],
    }
  );

  for await (const [mode, chunk] of stream) {
    if (mode === "custom") {
      writer.write({
        type: "progress",
        requestId,
        ...chunk,
      });
    } else if (mode === "messages") {
      await streamTokens(chunk, requestId, writer);
    }
  }

  const finalState = await graph.getState(config);
  writer.write({
    type: "graph-complete",
    requestId,
    result: finalState.values,
    threadId: config.configurable?.thread_id || "",
  });
}

async function streamTokens(
  chunk: any,
  requestId: string,
  writer: JSONStdinWriter
): Promise<void> {
  const [messageChunk, metadata] = Array.isArray(chunk) ? chunk : [chunk, {}];

  if (messageChunk?.content && typeof messageChunk.content === "string") {
    writer.write({
      type: "token",
      requestId,
      content: messageChunk.content,
      role: messageChunk.role || "assistant",
      nodeName: metadata?.nodeName || "unknown",
    });
  }
}

process.on("SIGTERM", async () => {
  console.error("[Agent] Received SIGTERM, shutting down...");
  for (const controller of activeRequests.values()) {
    controller.abort();
  }
  setTimeout(() => process.exit(0), 500);
});

process.on("SIGINT", () => {
  console.error("[Agent] Received SIGINT, exiting...");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("[Agent] Uncaught exception:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("[Agent] Fatal error:", error);
  process.exit(1);
});
