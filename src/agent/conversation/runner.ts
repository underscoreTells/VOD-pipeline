import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { buildConversationMessages } from "./context-builder.js";
import {
  buildAmbiguousClarificationMessage,
  routeTurnIntent,
} from "./intent-router.js";
import {
  createConversationModel,
  invokeConversationModelStep,
  resolveConversationProvider,
  streamAssistantText,
} from "./provider-adapter.js";
import {
  createConversationTools,
  isToolSchemaFailure,
  type ConversationToolDependencies,
} from "./tools.js";
import type { AgentToolDefinition } from "../tools/define-tool.js";
import { bindAgentToolsForProvider } from "../tools/binding.js";
import type {
  ConversationRunResult,
  ConversationTurnInput,
  ConversationWriter,
} from "./types.js";

const MAX_LOOP_STEPS = 8;
const MAX_TOOL_CALLS_PER_STEP = 4;
const MAX_STRUCTURED_REPAIRS = 1;
const MAX_REPEATED_TOOL_CALLS = 2;

interface ToolCapableModel {
  invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
  bindTools?(
    tools: unknown[],
    kwargs?: Record<string, unknown>
  ): {
    invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
  };
}

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
      clarificationQuestion?: string;
    },
    dependencies: ConversationToolDependencies,
    options: { includeProposalTools: boolean }
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
  const writer = options.writer;
  const latestUserMessage = getLatestUserMessage(input.messages);
  const route = routeTurnIntent({
    latestUserMessage,
    selectedClipIds: input.selectedClipIds,
    playheadTime: input.playheadTime,
  });

  if (route.intent === "ambiguous") {
    const clarification = buildAmbiguousClarificationMessage();
    writer?.writeStatus({
      status: "requesting_clarification",
      message: route.reason,
      progress: 100,
      nodeName: "conversation_runner",
    });
    streamAssistantText(writer, clarification);
    return {
      assistantResponse: clarification,
      thinkingMarkdown: undefined,
      outcome: "clarification",
    };
  }

  writer?.writeStatus({
    status: "processing_chat",
    message: route.reason,
    progress: 0,
    nodeName: "conversation_runner",
  });

  const accumulator: Required<
    Pick<ConversationRunResult, "suggestionDrafts" | "timelineActions" | "transcriptDetailRequests">
  > & { clarificationQuestion?: string } = {
    suggestionDrafts: [],
    timelineActions: [],
    transcriptDetailRequests: [],
  };

  const createToolsImpl = dependencies.createTools ?? createConversationTools;
  const toolDefinitions = createToolsImpl(
    input,
    writer,
    accumulator,
    dependencies,
    { includeProposalTools: route.intent === "proposal" }
  );
  const resolvedProvider = await resolveConversationProvider(input.selectedProvider);
  const boundTools = bindAgentToolsForProvider(resolvedProvider, toolDefinitions);

  const model = dependencies.createModel
    ? await dependencies.createModel(input)
    : await createConversationModel(input.selectedProvider);

  const workingMessages = [...buildConversationMessages(input, route.intent)];
  const toolCallCounts = new Map<string, number>();
  let structuredRepairCount = 0;
  let protocolFailureCount = 0;

  for (let step = 1; step <= MAX_LOOP_STEPS; step += 1) {
    assertNotAborted(options.signal);

    writer?.writeStatus({
      status: "processing_chat",
      message: `Working on turn step ${step}...`,
      progress: Math.min(95, step * 10),
      nodeName: "conversation_runner",
    });

    const response = await invokeConversationModelStep({
      model,
      messages: workingMessages,
      tools: boundTools.bindPayload,
      signal: options.signal,
    });

    if (response.toolCalls.length === 0) {
      const finalText = response.text.trim() || getDefaultTerminalMessage(route.intent);

      if (route.intent === "proposal") {
        const hasDrafts =
          accumulator.suggestionDrafts.length > 0 || accumulator.timelineActions.length > 0;
        if (!hasDrafts) {
          if (structuredRepairCount < MAX_STRUCTURED_REPAIRS) {
            structuredRepairCount += 1;
            workingMessages.push(response.rawMessage);
            workingMessages.push(
              new SystemMessage(
                "This is a proposal turn. Before finishing, you must either call draftRoughCutProposals with actionable edits or call requestClarification if the request is too unclear."
              )
            );
            continue;
          }

          return createControlledFailure(
            "I couldn't turn that into reliable rough-cut proposals this turn. Please be more specific about the edit you want."
          );
        }
      }

      writer?.writeStatus({
        status: "processing_chat_complete",
        progress: 100,
        nodeName: "conversation_runner",
      });
      streamAssistantText(writer, finalText);
      return {
        assistantResponse: finalText,
        thinkingMarkdown: undefined,
        outcome: route.intent === "proposal" ? "proposal" : "discussion",
        suggestionDrafts:
          accumulator.suggestionDrafts.length > 0 ? accumulator.suggestionDrafts : undefined,
        timelineActions:
          accumulator.timelineActions.length > 0 ? accumulator.timelineActions : undefined,
        transcriptDetailRequests:
          accumulator.transcriptDetailRequests.length > 0
            ? accumulator.transcriptDetailRequests
            : undefined,
      };
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
      });

      let content: string;
      try {
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "running",
          input: toolCall.args,
        });
        content = await selectedTool.execute(toolCall.args);
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "completed",
          output: content,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        content = JSON.stringify({ error: errorMessage });
        writer?.writeToolState({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          state: "error",
          error: errorMessage,
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

      if (toolCall.name === "requestClarification" && accumulator.clarificationQuestion) {
        writer?.writeStatus({
          status: "requesting_clarification",
          progress: 100,
          nodeName: "conversation_runner",
        });
        streamAssistantText(writer, accumulator.clarificationQuestion);
        return {
          assistantResponse: accumulator.clarificationQuestion,
          thinkingMarkdown: undefined,
          outcome: "clarification",
          transcriptDetailRequests:
            accumulator.transcriptDetailRequests.length > 0
              ? accumulator.transcriptDetailRequests
              : undefined,
        };
      }

      workingMessages.push(
        new ToolMessage({
          content,
          tool_call_id: toolCall.id,
        })
      );
    }
  }

  return createControlledFailure(
    "I couldn't finish the tool loop for this turn. Please retry with a more specific request."
  );
}

function getLatestUserMessage(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message._getType() === "human") {
      const content = message.content;
      return typeof content === "string" ? content : JSON.stringify(content ?? "");
    }
  }

  return "";
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

function getDefaultTerminalMessage(intent: "discussion" | "proposal"): string {
  if (intent === "proposal") {
    return "I drafted a rough-cut response for this section.";
  }

  return "I reviewed the chapter and put together an answer.";
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Conversation turn aborted");
  }
}
