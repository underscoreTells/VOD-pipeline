import { SystemMessage, ToolMessage } from "@langchain/core/messages";
import { buildConversationMessages } from "./context-builder.js";
import {
  createConversationModel,
  invokeConversationModelStep,
  resolveConversationProvider,
  streamAssistantText,
  type ToolCapableModel,
} from "./provider-adapter.js";
import {
  createConversationTools,
  isToolSchemaFailure,
  type ConversationToolDependencies,
} from "./tools/index.js";
import type { AgentToolDefinition } from "../tools/define-tool.js";
import { bindAgentToolsForProvider } from "../tools/binding.js";
import type {
  ConversationRunResult,
  ConversationTurnInput,
  ConversationWriter,
} from "./types.js";
import {
  MAX_LOOP_STEPS,
  MAX_TOOL_CALLS_PER_STEP,
  MAX_STRUCTURED_REPAIRS,
  MAX_REPEATED_TOOL_CALLS,
} from "../constants.js";

const FINALIZE_TOOL_NAME = "finalizeConversationTurn";

interface ConversationRunnerDependencies extends ConversationToolDependencies {
  createModel?: (
    input: ConversationTurnInput
  ) => Promise<ToolCapableModel>;
  createTools?: (
    input: ConversationTurnInput,
    writer: ConversationWriter | undefined,
    accumulator: {
      suggestionDrafts: ConversationRunResult["suggestionDrafts"];
      timelineActions: ConversationRunResult["timelineActions"];
      transcriptDetailRequests: ConversationRunResult["transcriptDetailRequests"];
      loadedDetailedTranscripts: ConversationTurnInput["context"]["detailedTranscripts"];
      hasSuccessfulVideoEvidence: boolean;
      videoEvidenceAssetIds: Set<number>;
      finalOutcome?: ConversationRunResult["outcome"];
      finalAssistantResponse?: string;
    },
    dependencies: ConversationToolDependencies
  ) => AgentToolDefinition[];
}

export async function runConversationTurn(
  input: ConversationTurnInput,
  options: {
    writer?: ConversationWriter;
    signal?: AbortSignal;
  } = {},
  dependencies: ConversationRunnerDependencies = {}
): Promise<ConversationRunResult> {
  const baseWriter = options.writer;
  let currentStepIndex: number | undefined;
  const writer: ConversationWriter | undefined = baseWriter
    ? {
        writeStatus(event) {
          baseWriter.writeStatus({
            ...event,
            stepIndex: event.stepIndex ?? currentStepIndex,
          });
        },
        writeAssistantTextDelta(delta) {
          baseWriter.writeAssistantTextDelta(delta);
        },
        writeToolState(event) {
          baseWriter.writeToolState({
            ...event,
            stepIndex: event.stepIndex ?? currentStepIndex,
          });
        },
      }
    : undefined;

  writer?.writeStatus({
    status: "processing_chat",
    message: "Reviewing the request and available chapter context...",
    progress: 0,
    nodeName: "conversation_runner",
  });

  const accumulator: {
    suggestionDrafts: NonNullable<ConversationRunResult["suggestionDrafts"]>;
    timelineActions: NonNullable<ConversationRunResult["timelineActions"]>;
    transcriptDetailRequests: NonNullable<ConversationRunResult["transcriptDetailRequests"]>;
    loadedDetailedTranscripts: ConversationTurnInput["context"]["detailedTranscripts"];
    hasSuccessfulVideoEvidence: boolean;
    videoEvidenceAssetIds: Set<number>;
    finalOutcome?: ConversationRunResult["outcome"];
    finalAssistantResponse?: string;
  } = {
    suggestionDrafts: [],
    timelineActions: [],
    transcriptDetailRequests: [],
    loadedDetailedTranscripts: [],
    hasSuccessfulVideoEvidence: false,
    videoEvidenceAssetIds: new Set<number>(),
  };

  const createToolsImpl = dependencies.createTools ?? createConversationTools;
  const toolDefinitions = createToolsImpl(input, writer, accumulator, dependencies);
  const resolvedProvider = await resolveConversationProvider(input.selectedProvider);
  const boundTools = bindAgentToolsForProvider(resolvedProvider, toolDefinitions);

  const model = dependencies.createModel
    ? await dependencies.createModel(input)
    : await createConversationModel(input.selectedProvider);

  const workingMessages = [...buildConversationMessages(input)];
  const toolCallCounts = new Map<string, number>();
  let finalizeRepairCount = 0;
  let protocolFailureCount = 0;
  // Reply text already streamed to the renderer from finalize tool-call
  // argument deltas. Used to avoid re-streaming the same text on finalize.
  let streamedResponseText = "";

  for (let step = 1; ; step += 1) {
    if (step > MAX_LOOP_STEPS) {
      return createControlledFailure(
        "I couldn't complete this turn within the internal tool-step limit. Please retry with a narrower request."
      );
    }

    currentStepIndex = step;
    assertNotAborted(options.signal);

    writer?.writeStatus({
      status: "processing_chat",
      message: `Working on turn step ${step}...`,
      progress: Math.min(95, step * 10),
      nodeName: "conversation_runner",
      stepIndex: step,
    });

    const response = await invokeConversationModelStep({
      model,
      messages: workingMessages,
      tools: boundTools.bindPayload,
      signal: options.signal,
      provider: resolvedProvider,
      streamedToolName: FINALIZE_TOOL_NAME,
      onStreamedResponseDelta: (delta) => {
        streamedResponseText += delta;
        writer?.writeAssistantTextDelta(delta);
      },
    });

    if (response.toolCalls.length === 0) {
      if (finalizeRepairCount < MAX_STRUCTURED_REPAIRS) {
        finalizeRepairCount += 1;
        workingMessages.push(response.rawMessage);
        workingMessages.push(
          new SystemMessage(
            "You must end every turn by calling finalizeConversationTurn exactly once. Call finalizeConversationTurn now with outcome set to discussion, proposal, or clarification, and set assistantResponse to the exact user-facing reply. Do not answer in plain text without the finalizer."
          )
        );
        continue;
      }

      return createControlledFailure(
        "I couldn't complete this turn because the response did not finalize correctly. Please retry."
      );
    }

    workingMessages.push(response.rawMessage);
    const toolCalls = response.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);

    for (const toolCall of toolCalls) {
      assertNotAborted(options.signal);

      const signature = `${toolCall.name}:${stableJson(toolCall.args)}`;
      const nextCount = (toolCallCounts.get(signature) ?? 0) + 1;
      toolCallCounts.set(signature, nextCount);

      if (nextCount >= MAX_REPEATED_TOOL_CALLS) {
        const repeatError =
          "I stopped a repeated tool call because the arguments were unchanged. Please revise the request or clarify the missing detail.";

        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "error",
          error: repeatError,
          stepIndex: step,
        });

        workingMessages.push(
          new ToolMessage({
            content: JSON.stringify({ error: repeatError }),
            tool_call_id: toolCall.id,
          })
        );

        protocolFailureCount += 1;
        if (protocolFailureCount > MAX_STRUCTURED_REPAIRS) {
          return createControlledFailure(repeatError);
        }
        continue;
      }

      const selectedTool = boundTools.executableToolMap.get(toolCall.name);
      if (!selectedTool) {
        const error = `Unknown tool requested: ${toolCall.name}`;
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "error",
          error,
          stepIndex: step,
        });
        workingMessages.push(
          new ToolMessage({
            content: JSON.stringify({ error }),
            tool_call_id: toolCall.id,
          })
        );

        protocolFailureCount += 1;
        if (protocolFailureCount > MAX_STRUCTURED_REPAIRS) {
          return createControlledFailure(
            "I hit repeated tool protocol errors while building this response. Please retry with a narrower request."
          );
        }
        continue;
      }

      writer?.writeToolState({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        state: "pending",
        input: toolCall.args,
        stepIndex: step,
      });

      let content: string;
      try {
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "running",
          input: toolCall.args,
          stepIndex: step,
        });
        content = await selectedTool.execute(toolCall.args);
        assertNotAborted(options.signal);
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "completed",
          output: content,
          stepIndex: step,
        });
      } catch (error) {
        assertNotAborted(options.signal);
        const errorMessage = error instanceof Error ? error.message : String(error);
        content = JSON.stringify({ error: errorMessage });
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "error",
          error: errorMessage,
          stepIndex: step,
        });

        if (isToolSchemaFailure(error)) {
          protocolFailureCount += 1;
          if (protocolFailureCount > MAX_STRUCTURED_REPAIRS) {
            return createControlledFailure(
              "I couldn't recover from an invalid tool call payload. Please retry with a more specific request."
            );
          }
        }
      }

      if (toolCall.name === FINALIZE_TOOL_NAME && accumulator.finalOutcome) {
        return finalizeConversationResult(writer, accumulator, streamedResponseText);
      }

      workingMessages.push(new ToolMessage({ content, tool_call_id: toolCall.id }));
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((record, key) => {
      record[key] = sortJsonValue((value as Record<string, unknown>)[key]);
      return record;
    }, {});
}

function createControlledFailure(message: string): ConversationRunResult {
  return {
    assistantResponse: message,
    thinkingMarkdown: undefined,
    outcome: "clarification",
  };
}

function finalizeConversationResult(
  writer: ConversationWriter | undefined,
  accumulator: {
    suggestionDrafts: ConversationRunResult["suggestionDrafts"];
    timelineActions: ConversationRunResult["timelineActions"];
    transcriptDetailRequests: ConversationRunResult["transcriptDetailRequests"];
    finalOutcome?: ConversationRunResult["outcome"];
    finalAssistantResponse?: string;
  },
  streamedResponseText = ""
): ConversationRunResult {
  const assistantResponse =
    typeof accumulator.finalAssistantResponse === "string"
      ? accumulator.finalAssistantResponse.trim()
      : "";

  if (!accumulator.finalOutcome || !assistantResponse) {
    return createControlledFailure(
      "I couldn't complete this turn because the response did not finalize correctly. Please retry."
    );
  }

  writer?.writeStatus({
    status: "processing_chat_complete",
    progress: 100,
    nodeName: "conversation_runner",
  });
  streamRemainingAssistantText(writer, assistantResponse, streamedResponseText);

  return {
    assistantResponse,
    thinkingMarkdown: undefined,
    outcome: accumulator.finalOutcome,
    suggestionDrafts:
      accumulator.suggestionDrafts && accumulator.suggestionDrafts.length > 0
        ? accumulator.suggestionDrafts
        : undefined,
    timelineActions:
      accumulator.timelineActions && accumulator.timelineActions.length > 0
        ? accumulator.timelineActions
        : undefined,
    transcriptDetailRequests:
      accumulator.transcriptDetailRequests && accumulator.transcriptDetailRequests.length > 0
        ? accumulator.transcriptDetailRequests
        : undefined,
  };
}

/**
 * Streams whatever part of the final reply has not already reached the
 * renderer via live tool-argument deltas. When streamed text diverges from
 * the canonical reply (e.g. a failed finalize attempt was re-tried), we
 * stream nothing extra — turn_complete replaces the draft with the
 * canonical text anyway.
 */
function streamRemainingAssistantText(
  writer: ConversationWriter | undefined,
  assistantResponse: string,
  streamedResponseText: string
): void {
  const streamed = streamedResponseText.trim();
  if (!streamed) {
    streamAssistantText(writer, assistantResponse);
    return;
  }

  if (assistantResponse.startsWith(streamed)) {
    const remainder = assistantResponse.slice(streamed.length);
    if (remainder.trim()) {
      streamAssistantText(writer, remainder);
    }
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Conversation turn aborted");
  }
}
