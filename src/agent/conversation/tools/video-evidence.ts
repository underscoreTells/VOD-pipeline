import { z } from "zod";
import { loadConfig, getProviderLLMConfig } from "../../config.js";
import { createLLM, VIDEO_CAPABLE_PROVIDERS } from "../../providers/index.js";
import { createVideoMessage, type VideoProvider } from "../../utils/video-messages.js";
import { getMessageText } from "../provider-adapter.js";
import type { ConversationTurnInput, ConversationWriter } from "../types.js";
import type { ConversationToolAccumulator } from "./create-tools.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../../tools/define-tool.js";
import { analyzeChapterVideoSchema, videoEvidenceSchema } from "./schemas.js";
import type { AnalyzeChapterVideoInput } from "./schemas.js";

export async function analyzeChapterVideoEvidence(
  input: ConversationTurnInput,
  request: AnalyzeChapterVideoInput,
  options?: { signal?: AbortSignal }
): Promise<z.infer<typeof videoEvidenceSchema>> {
  if (
    !input.selectedProvider ||
    !VIDEO_CAPABLE_PROVIDERS.includes(input.selectedProvider)
  ) {
    return {
      summary: `Video analysis is unavailable for provider ${input.selectedProvider || "undefined"}.`,
      observations: [],
    };
  }

  const groundedAsset = resolveGroundedVideoAsset(input, request.assetId);
  if (!groundedAsset) {
    return {
      summary:
        "No chapter proxy video is ready yet, so I could not inspect the visuals directly.",
      observations: [],
    };
  }

  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, input.selectedProvider);
  const llm = createLLM(llmConfig);
  const prompt = buildVideoEvidencePrompt(request.focus);
  const provider = input.selectedProvider as VideoProvider;
  const videoMessage = await createVideoMessage({
    provider,
    videoPath: groundedAsset.proxyPath,
    textPrompt: prompt,
    transcriptContext: input.context.transcript,
    signal: options?.signal,
  });

  const response = await llm.invoke([videoMessage], options?.signal ? { signal: options.signal } : undefined);
  const parsed = parseVideoEvidenceResponse(getMessageText(response.content));
  return {
    ...parsed,
    assetId: groundedAsset.assetId,
  };
}

function buildVideoEvidencePrompt(focus: string): string {
  return `You are gathering factual evidence about a chapter video for an editing assistant.

Focus:
${focus}

Inspect the visuals and dialogue as evidence for editing decisions.
Do not make edit recommendations, do not say what should be cut or kept, and do not propose timeline changes.
When relevant, surface concrete observations about:
- momentum drops, dead air, repeated actions or explanations, and reset moments
- payoff landings, reactions, reveals, transitions, and visually important beats
- whether humor escalates the sequence or stalls it

Keep every note factual, specific, and anchored to what is visibly or audibly present on screen.

Return exactly one JSON object with this shape:
{
  "summary": "Short factual summary of what matters for this focus",
  "observations": [
    {
      "in_point": 12.5,
      "out_point": 18.2,
      "note": "Concrete visual or dialogue observation"
    }
  ]
}`;
}

function parseVideoEvidenceResponse(content: string): z.infer<typeof videoEvidenceSchema> {
  const jsonObject = extractJsonObject(content);
  if (jsonObject) {
    try {
      return videoEvidenceSchema.parse(JSON.parse(jsonObject));
    } catch {
      // Fall through to the text fallback.
    }
  }

  return {
    summary: content.trim() || "The video evidence response could not be parsed cleanly.",
    observations: [],
  };
}

function extractJsonObject(content: string): string | null {
  const objectStart = content.indexOf("{");
  if (objectStart === -1) return null;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let index = objectStart; index < content.length; index += 1) {
    const char = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

function resolveGroundedVideoAsset(
  input: ConversationTurnInput,
  requestedAssetId?: number
): { assetId: number; proxyPath: string } | null {
  const groundedAssets = input.context.videoAnalysisAssets;
  if (groundedAssets.length === 0) {
    return null;
  }

  if (requestedAssetId === undefined) {
    if (groundedAssets.length > 1) {
      throw new Error("assetId is required when multiple grounded video assets are available.");
    }

    return groundedAssets[0] ?? null;
  }

  const selectedAsset = groundedAssets.find((asset) => asset.assetId === requestedAssetId);
  if (!selectedAsset) {
    throw new Error(`No grounded video asset is available for assetId ${requestedAssetId}.`);
  }

  return selectedAsset;
}

export function createAnalyzeChapterVideoTool(
  input: ConversationTurnInput,
  writer: ConversationWriter | undefined,
  accumulator: ConversationToolAccumulator,
  analyzeChapterVideoImpl: (
    input: ConversationTurnInput,
    request: AnalyzeChapterVideoInput,
    options?: { signal?: AbortSignal }
  ) => Promise<{
    assetId?: number;
    summary: string;
    observations: Array<{
      in_point?: number;
      out_point?: number;
      note: string;
    }>;
  }>
): AgentToolDefinition {
  return defineAgentTool<AnalyzeChapterVideoInput>({
    name: "analyzeChapterVideo",
    description:
      "Inspect the current chapter video for factual visual evidence only. Use this when you need to verify what happens on screen before answering. This tool never makes recommendations.",
    schema: analyzeChapterVideoSchema,
    execute: async ({ focus, assetId }, options) => {
      writer?.writeStatus({
        status: "analyzing_video",
        message: "Gathering visual evidence from the chapter video...",
        progress: 50,
        nodeName: "conversation_runner",
      });

      const evidence = await analyzeChapterVideoImpl(input, { focus, assetId }, options);
      if (
        typeof evidence.assetId === "number" &&
        Number.isFinite(evidence.assetId) &&
        input.context.videoAnalysisAssets.some((asset) => asset.assetId === evidence.assetId)
      ) {
        accumulator.hasSuccessfulVideoEvidence = true;
        accumulator.videoEvidenceAssetIds.add(evidence.assetId);
      }
      return JSON.stringify(evidence);
    },
  });
}
