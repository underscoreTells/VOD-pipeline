import { setIpcConfig, type AgentConfig } from "./config.js";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { createMainGraph } from "./graphs/main-orchestrator.js";
import { JSONStdinWriter, JSONStdoutReader } from "./ipc/json-message-transport.js";
import { v4 as uuidv4 } from "uuid";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import fs from "fs";
import path from "path";
import type { AgentInputMessage, DetailedTranscriptWindow } from "../shared/types/agent-ipc.js";
import type { LLMProviderType } from "./providers/index.js";

const activeRequests = new Map<string, AbortController>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function normalizeProvider(value: unknown): LLMProviderType | undefined {
  if (value === "openai" || value === "gemini" || value === "anthropic" || value === "openrouter" || value === "kimi") {
    return value;
  }
  return undefined;
}

function normalizeAgentConfig(value: unknown): Partial<AgentConfig> | null {
  if (!isRecord(value)) return null;

  const providersRaw = isRecord(value.providers) ? value.providers : {};
  const providers: NonNullable<Partial<AgentConfig>["providers"]> = {};

  for (const provider of ["gemini", "openai", "anthropic", "openrouter", "kimi"] as const) {
    const apiKey = providersRaw[provider];
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      providers[provider] = apiKey.trim();
    }
  }

  const defaultProvider = normalizeProvider(value.defaultProvider);

  const normalized: Partial<AgentConfig> = {
    providers,
  };

  if (defaultProvider) {
    normalized.defaultProvider = defaultProvider;
  }

  return normalized;
}

function asDetailedTranscriptWindows(value: unknown): DetailedTranscriptWindow[] {
  if (!Array.isArray(value)) return [];

  const windows: DetailedTranscriptWindow[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const assetId = item.assetId;
    const windowStart = item.windowStart;
    const windowEnd = item.windowEnd;
    const text = item.text;
    const reason = item.reason;
    const segmentsRaw = Array.isArray(item.segments) ? item.segments : [];

    if (
      typeof assetId !== "number" ||
      !Number.isFinite(assetId) ||
      typeof windowStart !== "number" ||
      !Number.isFinite(windowStart) ||
      typeof windowEnd !== "number" ||
      !Number.isFinite(windowEnd) ||
      windowEnd <= windowStart ||
      typeof text !== "string"
    ) {
      continue;
    }

    const segments: DetailedTranscriptWindow["segments"] = [];
    for (let index = 0; index < segmentsRaw.length; index += 1) {
      const segment = segmentsRaw[index];
      if (!isRecord(segment)) continue;

      const start = segment.start;
      const end = segment.end;
      const segmentText = segment.text;

      if (
        typeof start !== "number" ||
        !Number.isFinite(start) ||
        typeof end !== "number" ||
        !Number.isFinite(end) ||
        end <= start ||
        typeof segmentText !== "string"
      ) {
        continue;
      }

      const wordsRaw = Array.isArray(segment.words) ? segment.words : [];
      const words = wordsRaw
        .map((word) => {
          if (!isRecord(word)) return null;
          if (
            typeof word.word !== "string" ||
            typeof word.start !== "number" ||
            !Number.isFinite(word.start) ||
            typeof word.end !== "number" ||
            !Number.isFinite(word.end)
          ) {
            return null;
          }

          return {
            word: word.word,
            start: word.start,
            end: word.end,
            probability:
              typeof word.probability === "number" && Number.isFinite(word.probability)
                ? word.probability
                : undefined,
          };
        })
        .filter((word): word is NonNullable<typeof word> => word !== null);

      segments.push({
        id:
          typeof segment.id === "number" && Number.isFinite(segment.id)
            ? segment.id
            : index,
        start,
        end,
        text: segmentText,
        words: words.length > 0 ? words : undefined,
      });
    }

    windows.push({
      assetId,
      windowStart,
      windowEnd,
      reason: typeof reason === "string" ? reason : undefined,
      text,
      segments,
    });
  }

  return windows;
}

function normalizeChatMessages(messages: Array<{ role: string; content: string }>): BaseMessage[] {
  return messages.map((message) => {
    const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const role = typeof message.role === "string" ? message.role.toLowerCase() : "user";

    if (role === "assistant" || role === "ai") {
      return new AIMessage(content);
    }

    if (role === "system") {
      return new SystemMessage(content);
    }

    return new HumanMessage(content);
  });
}

function buildChatGraphInput(message: Extract<AgentInputMessage, { type: "chat" }>) {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const context = isRecord(metadata.context) ? metadata.context : null;
  const hasContext = Boolean(context);

  const chapterRecord = hasContext && context && isRecord(context.chapter) ? context.chapter : null;
  const chapterIdValue = chapterRecord?.id;
  const chapterStart = chapterRecord?.startTime;
  const chapterEnd = chapterRecord?.endTime;

  const chapterContext =
    (typeof chapterIdValue === "string" || typeof chapterIdValue === "number") &&
    typeof chapterStart === "number" &&
    Number.isFinite(chapterStart) &&
    typeof chapterEnd === "number" &&
    Number.isFinite(chapterEnd)
      ? {
          id: String(chapterIdValue),
          title: typeof chapterRecord?.title === "string" ? chapterRecord.title : undefined,
          startTime: chapterStart,
          endTime: chapterEnd,
        }
      : undefined;

  const chapterClipsRaw = hasContext && context && Array.isArray(context.chapterClips) ? context.chapterClips : [];
  const chapterClips = chapterClipsRaw
    .map((clip) => {
      if (!isRecord(clip)) return null;

      const id = clip.id;
      const assetId = clip.assetId;
      const trackIndex = clip.trackIndex;
      const startTime = clip.startTime;
      const inPoint = clip.inPoint;
      const outPoint = clip.outPoint;

      if (
        typeof id !== "number" ||
        !Number.isFinite(id) ||
        typeof assetId !== "number" ||
        !Number.isFinite(assetId) ||
        typeof trackIndex !== "number" ||
        !Number.isFinite(trackIndex) ||
        typeof startTime !== "number" ||
        !Number.isFinite(startTime) ||
        typeof inPoint !== "number" ||
        !Number.isFinite(inPoint) ||
        typeof outPoint !== "number" ||
        !Number.isFinite(outPoint)
      ) {
        return null;
      }

      return {
        id,
        assetId,
        trackIndex,
        startTime,
        inPoint,
        outPoint,
        role: typeof clip.role === "string" ? clip.role : null,
        description: typeof clip.description === "string" ? clip.description : null,
        isEssential: Boolean(clip.isEssential),
      };
    })
    .filter((clip): clip is {
      id: number;
      assetId: number;
      trackIndex: number;
      startTime: number;
      inPoint: number;
      outPoint: number;
      role: string | null;
      description: string | null;
      isEssential: boolean;
    } => clip !== null);

  const provider = normalizeProvider(metadata.provider);
  const chapterId =
    typeof metadata.chapterId === "string" || typeof metadata.chapterId === "number"
      ? String(metadata.chapterId)
      : undefined;

  const projectId =
    typeof metadata.projectId === "string" || typeof metadata.projectId === "number"
      ? String(metadata.projectId)
      : "";

  const playheadTime =
    typeof metadata.playheadTime === "number" && Number.isFinite(metadata.playheadTime)
      ? metadata.playheadTime
      : undefined;

  const detailedTranscripts = hasContext && context
    ? asDetailedTranscriptWindows(context.detailedTranscripts)
    : [];

  const graphInput: Record<string, unknown> = {
    messages: normalizeChatMessages(message.messages || []),
    projectId,
    selectedProvider: provider,
    selectedClipIds: asNumberArray(metadata.selectedClipIds),
    playheadTime,
  };

  if (chapterId) {
    graphInput.currentChapterId = chapterId;
  }

  if (hasContext && context) {
    if (typeof context.transcript === "string") {
      graphInput.transcript = context.transcript;
    }
    if (typeof context.proxyPath === "string") {
      graphInput.proxyPath = context.proxyPath;
    }
    if (chapterContext) {
      graphInput.chapterContext = chapterContext;
    }

    graphInput.chapterAssetIds = asNumberArray(context.chapterAssetIds);
    graphInput.chapterClips = chapterClips;
    graphInput.detailedTranscripts = detailedTranscripts;
  }

  return graphInput;
}

async function main() {
  console.error("[Agent] Worker process starting...");

  try {
    console.error("[Agent] Waiting for provider config from settings IPC or environment");

    const configuredCheckpointerPath = process.env.AGENT_CHECKPOINTER_DB_PATH?.trim();
    const dbPath = configuredCheckpointerPath && configuredCheckpointerPath.length > 0
      ? configuredCheckpointerPath
      : `${process.env.HOME || process.env.USERPROFILE}/.vod-pipeline/vod-pipeline.db`;
    let checkpointer: any;
    let checkpointerBackend: "sqlite" | "none" = "sqlite";

    try {
      const checkpointerDir = path.dirname(dbPath);
      fs.mkdirSync(checkpointerDir, { recursive: true });

      checkpointer = SqliteSaver.fromConnString(`file:${dbPath}`);
      console.error("[Agent] Checkpointer initialized at:", dbPath);
    } catch (error) {
      checkpointerBackend = "none";
      checkpointer = undefined;
      console.error(
        "[Agent] SQLite checkpointer unavailable, continuing without persistent checkpointer:",
        error
      );
    }

    console.error(`[Agent] Checkpointer backend: ${checkpointerBackend}`);

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

    inputReader.on("stream-error", (error: Error) => {
      console.error("[Agent] Input reader error:", error);
    });

    inputReader.on("parse-error", (error: Error) => {
      console.error("[Agent] Input parse error:", error);
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
      {
        const metadata = isRecord(message.metadata) ? message.metadata : {};
        const ipcAgentConfig = normalizeAgentConfig(metadata.agentConfig);
        setIpcConfig(ipcAgentConfig);
      }
      await streamGraph(graph, buildChatGraphInput(message), requestId, config, writer);
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
  graphInput: Record<string, unknown>,
  requestId: string,
  config: any,
  writer: JSONStdinWriter
): Promise<void> {
  let latestValues: Record<string, unknown> | undefined;

  const streamInvoker: ((input: Record<string, unknown>, options: Record<string, unknown>) => Promise<AsyncIterable<any>>) | null =
    typeof graph.stream === "function"
      ? graph.stream.bind(graph)
      : typeof graph.streamInput === "function"
        ? graph.streamInput.bind(graph)
        : null;

  if (!streamInvoker) {
    throw new Error("LangGraph compiled graph does not expose stream() or streamInput().");
  }

  const stream = await streamInvoker(graphInput, {
    ...config,
    streamMode: ["custom", "messages", "values"],
  });

  for await (const [mode, chunk] of stream) {
    if (mode === "custom") {
      writer.write({
        type: "progress",
        requestId,
        ...chunk,
      });
    } else if (mode === "messages") {
      await streamTokens(chunk, requestId, writer);
    } else if (mode === "values" && isRecord(chunk)) {
      latestValues = chunk as Record<string, unknown>;
    }
  }

  let finalValues: Record<string, unknown> = latestValues ?? {};
  try {
    const finalState = await graph.getState(config);
    if (isRecord(finalState?.values)) {
      finalValues = finalState.values as Record<string, unknown>;
    }
  } catch (error) {
    if (!latestValues) {
      console.error("[Agent] Could not read final graph state:", error);
    }
  }

  writer.write({
    type: "graph-complete",
    requestId,
    result: finalValues,
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
