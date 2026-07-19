import {
  generateDetailedTranscriptsForRequests,
  normalizeTranscriptDetailRequests,
} from "../../../shared/utils/detailed-transcript-tools.js";
import type {
  DetailedTranscriptWindow,
  TranscriptDetailRequest,
} from "../../../shared/types/agent-ipc.js";
import type { ConversationTurnInput, ConversationWriter } from "../types.js";
import type { ConversationToolAccumulator } from "./create-tools.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../../tools/define-tool.js";
import { loadDetailedTranscriptWindowsSchema } from "./schemas.js";
import type { LoadDetailedTranscriptWindowsInput } from "./schemas.js";

export async function loadDetailedTranscriptToolEvidence(
  input: ConversationTurnInput,
  requests: TranscriptDetailRequest[],
  options?: { signal?: AbortSignal }
): Promise<DetailedTranscriptWindow[]> {
  const chapter = input.context.chapter;
  if (!chapter) {
    return [];
  }

  return await generateDetailedTranscriptsForRequests(
    {
      id: Number(chapter.id),
      start_time: chapter.startTime,
      end_time: chapter.endTime,
    },
    input.context.chapterAssetIds,
    requests,
    options
  );
}

function normalizeDetailedTranscriptRequestsForInput(
  input: ConversationTurnInput,
  requests: TranscriptDetailRequest[]
): TranscriptDetailRequest[] {
  const chapter = input.context.chapter;
  if (!chapter) {
    return [];
  }

  const chapterDuration = Math.max(0.01, chapter.endTime - chapter.startTime);
  return normalizeTranscriptDetailRequests(
    requests,
    chapterDuration,
    input.context.chapterAssetIds
  );
}

export function createLoadDetailedTranscriptWindowsTool(
  input: ConversationTurnInput,
  writer: ConversationWriter | undefined,
  accumulator: ConversationToolAccumulator,
  loadDetailedTranscriptWindowsImpl: (
    input: ConversationTurnInput,
    requests: TranscriptDetailRequest[],
    options?: { signal?: AbortSignal }
  ) => Promise<DetailedTranscriptWindow[]>
): AgentToolDefinition {
  return defineAgentTool<LoadDetailedTranscriptWindowsInput>({
    name: "loadDetailedTranscriptWindows",
    description:
      "Load precise transcript windows for the current chapter when the overview transcript is insufficient for exact timing. This tool only provides evidence and never creates recommendations by itself.",
    schema: loadDetailedTranscriptWindowsSchema,
    execute: async ({ requests }, options) => {
      writer?.writeStatus({
        status: "loading_detailed_transcript_context",
        message: "Fetching detailed transcript windows for exact timing...",
        progress: 50,
        nodeName: "conversation_runner",
      });

      const normalizedRequests = normalizeDetailedTranscriptRequestsForInput(input, requests);
      accumulator.transcriptDetailRequests.push(...normalizedRequests);
      const windows = await loadDetailedTranscriptWindowsImpl(input, normalizedRequests, options);
      accumulator.loadedDetailedTranscripts.push(...windows);

      return JSON.stringify({
        windows: windows.map((window) => ({
          assetId: window.assetId,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          reason: window.reason,
          text: window.text,
          segments: window.segments.slice(0, 80),
        })),
      });
    },
  });
}
