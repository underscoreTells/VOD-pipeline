import type { BaseMessage, AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { loadConfig, getProviderLLMConfig } from "../config.js";
import { createLLM } from "../providers/index.js";
import {
  getProviderMetadata,
  type LLMProviderType,
} from "../../shared/llm/provider-registry.js";
import type { ConversationWriter } from "./types.js";
import { IncrementalJsonStringExtractor, withLLMRetry } from "./streaming.js";

interface ToolInvoker {
  invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
  stream?(
    messages: BaseMessage[],
    options?: Record<string, unknown>
  ): Promise<AsyncIterable<AIMessageChunk>>;
}

export interface ToolCapableModel extends ToolInvoker {
  bindTools?(tools: unknown[], kwargs?: Record<string, unknown>): ToolInvoker;
}

export interface AssistantToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AssistantStepResult {
  text: string;
  toolCalls: AssistantToolCall[];
  rawMessage: AIMessage;
}

export async function createConversationModel(
  provider?: LLMProviderType
): Promise<ToolCapableModel> {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, provider);
  return createLLM(llmConfig) as ToolCapableModel;
}

export async function resolveConversationProvider(
  provider?: LLMProviderType
): Promise<LLMProviderType> {
  if (provider) {
    return provider;
  }

  const agentConfig = await loadConfig();
  return getProviderLLMConfig(agentConfig, provider).provider;
}

export interface InvokeConversationModelStepOptions {
  model: ToolCapableModel;
  messages: BaseMessage[];
  tools: unknown[];
  signal?: AbortSignal;
  /** Provider id; enables native token streaming when supported. */
  provider?: LLMProviderType;
  /** Tool whose string argument carries the user-facing reply. */
  streamedToolName?: string;
  /** Argument key on the streamed tool that holds the reply text. */
  streamedToolArgKey?: string;
  /** Receives decoded reply text deltas as the model generates them. */
  onStreamedResponseDelta?: (delta: string) => void;
}

export async function invokeConversationModelStep({
  model,
  messages,
  tools,
  signal,
  provider,
  streamedToolName,
  streamedToolArgKey = "assistantResponse",
  onStreamedResponseDelta,
}: InvokeConversationModelStepOptions): Promise<AssistantStepResult> {
  if (tools.length > 0 && typeof model.bindTools !== "function") {
    throw new Error("Selected provider does not support tool calling for conversation turns");
  }

  const invoker: ToolInvoker =
    tools.length > 0 && typeof model.bindTools === "function"
      ? model.bindTools(tools)
      : model;

  const invokeOptions = signal ? ({ signal } as Record<string, unknown>) : undefined;
  const useStreaming =
    provider !== undefined &&
    getProviderMetadata(provider).nativeStreaming &&
    typeof invoker.stream === "function";

  let deltasEmitted = false;

  const runOnce = async (): Promise<AIMessage> => {
    if (!useStreaming || typeof invoker.stream !== "function") {
      return invoker.invoke(messages, invokeOptions);
    }

    const extractor =
      streamedToolName && onStreamedResponseDelta
        ? new IncrementalJsonStringExtractor(streamedToolArgKey)
        : undefined;
    let streamedToolIndex: number | undefined;
    let aggregate: AIMessageChunk | undefined;

    const stream = await invoker.stream(messages, invokeOptions);
    for await (const chunk of stream) {
      if (signal?.aborted) {
        throw new Error("Conversation turn aborted");
      }
      aggregate = aggregate ? aggregate.concat(chunk) : chunk;

      if (!extractor || extractor.isDone) {
        continue;
      }
      for (const toolChunk of chunk.tool_call_chunks ?? []) {
        if (
          streamedToolIndex === undefined &&
          typeof toolChunk.name === "string" &&
          toolChunk.name === streamedToolName
        ) {
          streamedToolIndex = toolChunk.index ?? 0;
        }
        if (
          streamedToolIndex !== undefined &&
          (toolChunk.index ?? 0) === streamedToolIndex &&
          typeof toolChunk.args === "string" &&
          toolChunk.args.length > 0
        ) {
          const delta = extractor.push(toolChunk.args);
          if (delta) {
            deltasEmitted = true;
            onStreamedResponseDelta?.(delta);
          }
        }
      }
    }

    if (!aggregate) {
      throw new Error("Model stream produced no output");
    }
    return aggregate;
  };

  const response = await withLLMRetry(runOnce, {
    signal,
    // Never retry once reply text reached the user; the renderer draft
    // would show duplicated text until turn_complete corrects it.
    canRetry: () => !deltasEmitted,
  });

  const toolCalls = Array.isArray(response.tool_calls)
    ? response.tool_calls.map((toolCall, index) => ({
        id:
          typeof toolCall.id === "string" && toolCall.id.trim().length > 0
            ? toolCall.id
            : `tool_call_${index}`,
        name: toolCall.name,
        args: toolCall.args ?? {},
      }))
    : [];

  return {
    text: getMessageText(response.content),
    toolCalls,
    rawMessage: response,
  };
}

export function streamAssistantText(
  writer: ConversationWriter | undefined,
  text: string
): void {
  if (!writer || !text.trim()) {
    return;
  }

  for (const chunk of splitTextForStreaming(text)) {
    writer.writeAssistantTextDelta(chunk);
  }
}

function splitTextForStreaming(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized.match(/.{1,96}(\s|$)/g);
  if (!chunks || chunks.length === 0) {
    return [normalized];
  }

  return chunks.map((chunk) => chunk);
}

export function getMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content ?? "");
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }

      return "";
    })
    .join("");
}
