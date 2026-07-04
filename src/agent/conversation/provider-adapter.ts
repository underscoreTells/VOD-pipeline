import type { BaseMessage, AIMessage } from "@langchain/core/messages";
import { loadConfig, getProviderLLMConfig } from "../config.js";
import { createLLM } from "../providers/index.js";
import type { LLMProviderType } from "../providers/index.js";
import type { ConversationWriter } from "./types.js";

export interface ToolCapableModel {
  invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
  bindTools?(
    tools: unknown[],
    kwargs?: Record<string, unknown>
  ): {
    invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
  };
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

export async function invokeConversationModelStep({
  model,
  messages,
  tools,
  signal,
}: {
  model: ToolCapableModel;
  messages: BaseMessage[];
  tools: unknown[];
  signal?: AbortSignal;
}): Promise<AssistantStepResult> {
  if (tools.length > 0 && typeof model.bindTools !== "function") {
    throw new Error("Selected provider does not support tool calling for conversation turns");
  }

  const invoker =
    tools.length > 0 && typeof model.bindTools === "function"
      ? model.bindTools(tools)
      : model;

  const response = await invoker.invoke(messages, signal ? ({ signal } as Record<string, unknown>) : undefined);
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
