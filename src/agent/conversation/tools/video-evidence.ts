import { z } from "zod";
import { loadConfig, getProviderLLMConfig } from "../../config.js";
import { createLLM, VIDEO_CAPABLE_PROVIDERS } from "../../providers/index.js";
import {
  createVideoMessage,
  invokeGeminiVideoAnalysis,
  type VideoProvider,
} from "../../utils/video-messages.js";
import { resolveProviderModel } from '../../../shared/llm/provider-registry.js';
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
    !VIDEO_CAPABLE_PROVIDERS.includes(input.selectedProvider) ||
    input.selectedModelSupportsVideo === false
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
  const range = normalizeVideoEvidenceRange(input, request);
  const prompt = buildVideoEvidencePrompt(request.focus, range);
  const provider = input.selectedProvider as VideoProvider;
  if (provider === 'gemini') {
    const content = await invokeGeminiVideoAnalysis({
      apiKey: llmConfig.apiKey,
      model: resolveProviderModel('gemini', llmConfig.model),
      videoPath: groundedAsset.proxyPath,
      textPrompt: prompt,
      transcriptContext: input.context.transcript,
      startOffsetSeconds: range?.start,
      endOffsetSeconds: range?.end,
      fps: 2,
      signal: options?.signal,
    });
    const parsed = parseVideoEvidenceResponse(content);
    return { ...parsed, assetId: groundedAsset.assetId };
  }

  const llm = createLLM(llmConfig);
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

function buildVideoEvidencePrompt(
  focus: string,
  range: { start: number; end: number } | null
): string {
  return `You are gathering factual evidence about a chapter video for an editing assistant.

Focus:
${focus}

${range ? `Inspect only chapter-local ${range.start.toFixed(2)}-${range.end.toFixed(2)} seconds. Report all observation timestamps in chapter-local seconds.` : 'Inspect the full chapter. Report all observation timestamps in chapter-local seconds.'}

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

function normalizeVideoEvidenceRange(
  input: ConversationTurnInput,
  request: AnalyzeChapterVideoInput
): { start: number; end: number } | null {
  if (request.startLocalTime === undefined && request.endLocalTime === undefined) {
    return null;
  }
  if (request.startLocalTime === undefined || request.endLocalTime === undefined) {
    throw new Error('Both startLocalTime and endLocalTime are required for targeted video evidence.');
  }
  const chapter = input.context.chapter;
  if (!chapter) {
    throw new Error('An active chapter is required for targeted video evidence.');
  }
  const duration = Math.max(0.01, chapter.endTime - chapter.startTime);
  const start = Math.min(duration, Math.max(0, request.startLocalTime));
  const end = Math.min(duration, Math.max(start, request.endLocalTime));
  if (end <= start) {
    throw new Error('endLocalTime must be greater than startLocalTime.');
  }
  return { start, end };
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
    execute: async ({ focus, assetId, startLocalTime, endLocalTime }, options) => {
      writer?.writeStatus({
        status: "analyzing_video",
        message: "Gathering visual evidence from the chapter video...",
        progress: 50,
        nodeName: "conversation_runner",
      });

      const evidence = await analyzeChapterVideoImpl(
        input,
        { focus, assetId, startLocalTime, endLocalTime },
        options
      );
      if (
        typeof evidence.assetId === "number" &&
        Number.isFinite(evidence.assetId) &&
        input.context.videoAnalysisAssets.some((asset) => asset.assetId === evidence.assetId)
      ) {
        accumulator.hasSuccessfulVideoEvidence = true;
        accumulator.videoEvidenceAssetIds.add(evidence.assetId);
        accumulator.evidenceReferences.push(...evidence.observations.flatMap((observation, index) => {
          if (
            typeof observation.in_point !== 'number'
            || typeof observation.out_point !== 'number'
            || observation.out_point <= observation.in_point
          ) {
            return [];
          }
          return [{
            evidenceId: `video:${evidence.assetId}:${accumulator.currentStepIndex}:${index}`,
            start: observation.in_point,
            end: observation.out_point,
            source: 'video' as const,
            observedAtStep: accumulator.currentStepIndex,
            assetId: evidence.assetId,
          }];
        }));
      }
      return JSON.stringify({
        ...evidence,
        observations: evidence.observations.map((observation, index) => ({
          ...observation,
          evidenceId: typeof evidence.assetId === 'number'
            ? `video:${evidence.assetId}:${accumulator.currentStepIndex}:${index}`
            : undefined,
        })),
      });
    },
  });
}
