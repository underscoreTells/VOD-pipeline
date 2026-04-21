import { setIpcConfig, type AgentConfig } from "./config.js";
import { JSONStdinWriter, JSONStdoutReader } from "./ipc/json-message-transport.js";
import { installStdoutProtocolGuard } from "./ipc/stdout-protocol.js";
import type {
  AgentInputMessage,
  AgentInputMessageWithoutId,
  DetailedTranscriptWindow,
} from "../shared/types/agent-ipc.js";
import type { LLMProviderType } from "./providers/index.js";
import { runConversationTurn } from "./conversation/runner.js";
import {
  normalizeConversationMessages,
} from "./conversation/context-builder.js";
import type {
  ConversationContextPayload,
  ConversationTurnInput,
  ConversationWriter,
} from "./conversation/types.js";

installStdoutProtocolGuard();

const activeRequests = new Map<string, AbortController>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function normalizeProvider(value: unknown): LLMProviderType | undefined {
  if (
    value === "openai" ||
    value === "gemini" ||
    value === "anthropic" ||
    value === "openrouter" ||
    value === "kimi"
  ) {
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
  const normalized: Partial<AgentConfig> = { providers };

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

function buildConversationInput(message: Extract<AgentInputMessage, { type: "chat" }>): ConversationTurnInput {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const contextRaw = isRecord(metadata.context) ? metadata.context : {};
  const chapterRaw = isRecord(contextRaw.chapter) ? contextRaw.chapter : undefined;
  const chapter =
    chapterRaw &&
    (typeof chapterRaw.id === "string" || typeof chapterRaw.id === "number") &&
    typeof chapterRaw.startTime === "number" &&
    typeof chapterRaw.endTime === "number"
      ? {
          id: String(chapterRaw.id),
          title: typeof chapterRaw.title === "string" ? chapterRaw.title : undefined,
          startTime: chapterRaw.startTime,
          endTime: chapterRaw.endTime,
        }
      : undefined;

  const chapterClipsRaw = Array.isArray(contextRaw.chapterClips) ? contextRaw.chapterClips : [];
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
        typeof assetId !== "number" ||
        typeof trackIndex !== "number" ||
        typeof startTime !== "number" ||
        typeof inPoint !== "number" ||
        typeof outPoint !== "number"
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
    .filter(
      (clip): clip is NonNullable<typeof clip> => clip !== null
    );

  const assetsRaw = Array.isArray(contextRaw.assets) ? contextRaw.assets : [];
  const assets = assetsRaw
    .map((asset) => {
      if (!isRecord(asset) || typeof asset.id !== "number" || typeof asset.filePath !== "string") {
        return null;
      }

      return {
        id: asset.id,
        filePath: asset.filePath,
        duration:
          typeof asset.duration === "number" && Number.isFinite(asset.duration)
            ? asset.duration
            : undefined,
        fileType: typeof asset.fileType === "string" ? asset.fileType : undefined,
        audioTrackCount:
          typeof asset.audioTrackCount === "number" && Number.isFinite(asset.audioTrackCount)
            ? asset.audioTrackCount
            : undefined,
      };
    })
    .filter((asset): asset is NonNullable<typeof asset> => asset !== null);

  const context: ConversationContextPayload = {
    chapter,
    chapterAssetIds: asNumberArray(contextRaw.chapterAssetIds),
    chapterClips,
    transcript: typeof contextRaw.transcript === "string" ? contextRaw.transcript : undefined,
    detailedTranscripts: asDetailedTranscriptWindows(contextRaw.detailedTranscripts),
    proxyPath: typeof contextRaw.proxyPath === "string" ? contextRaw.proxyPath : undefined,
    assets,
    suggestionSummary:
      typeof contextRaw.suggestionSummary === "string" ? contextRaw.suggestionSummary : undefined,
  };

  return {
    messages: normalizeConversationMessages(message.messages || []),
    selectedProvider: normalizeProvider(metadata.provider),
    selectedClipIds: asNumberArray(metadata.selectedClipIds),
    playheadTime:
      typeof metadata.playheadTime === "number" && Number.isFinite(metadata.playheadTime)
        ? metadata.playheadTime
        : undefined,
    context,
  };
}

function createConversationWriter(
  requestId: string,
  writer: JSONStdinWriter
): ConversationWriter {
  return {
    writeStatus(event) {
      writer.write({
        type: "status",
        requestId,
        ...event,
      });
    },
    writeAssistantTextDelta(delta) {
      writer.write({
        type: "assistant_text_delta",
        requestId,
        delta,
        role: "assistant",
      });
    },
    writeToolState(event) {
      writer.write({
        type: "tool_state",
        requestId,
        ...event,
      });
    },
  };
}

async function main() {
  console.error("[Agent] Worker process starting...");

  try {
    const inputReader = new JSONStdoutReader(process.stdin);
    const outputWriter = new JSONStdinWriter(process.stdout);

    inputReader.on("message", async (message: AgentInputMessage) => {
      const { requestId } = message;
      console.error(`[Agent] Received message type=${message.type} requestId=${requestId}`);

      const controller = new AbortController();
      activeRequests.set(requestId, controller);

      try {
        await processMessage(message, outputWriter, controller);
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
  writer: JSONStdinWriter,
  controller: AbortController
): Promise<void> {
  const { type, requestId } = message;
  const threadId = "threadId" in message ? message.threadId : undefined;

  switch (type) {
    case "chat": {
      const metadata = isRecord(message.metadata) ? message.metadata : {};
      const ipcAgentConfig = normalizeAgentConfig(metadata.agentConfig);
      setIpcConfig(ipcAgentConfig);

      const result = await runConversationTurn(buildConversationInput(message), {
        signal: controller.signal,
        writer: createConversationWriter(requestId, writer),
      });

      writer.write({
        type: "turn_complete",
        requestId,
        result: result as unknown as Record<string, unknown>,
        threadId: threadId || "",
      });
      return;
    }

    case "stop": {
      const targetController = activeRequests.get(message.requestId);
      if (targetController) {
        targetController.abort();
      }
      return;
    }

    case "analyze-chapters":
      writer.write({
        type: "error",
        requestId,
        error: "analyze-chapters not implemented",
        code: "NOT_IMPLEMENTED",
      });
      return;

    default:
      writer.write({
        type: "error",
        requestId,
        error: `Unknown message type: ${type}`,
        code: "UNKNOWN_MESSAGE_TYPE",
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
