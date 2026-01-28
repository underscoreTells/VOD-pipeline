import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";

export type LLMProviderType = "openai" | "gemini" | "anthropic" | "openrouter";

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
}

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash-exp",
  anthropic: "claude-sonnet-4-20250514",
  openrouter: "anthropic/claude-sonnet-4-20250514"
};

export function createLLM(config: LLMConfig): BaseChatModel {
  const model = config.model ?? DEFAULT_MODELS[config.provider];

  switch (config.provider) {
    case "openai":
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
      });

    case "openrouter":
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
        configuration: {
          baseURL: config.baseURL || "https://openrouter.ai/api/v1",
        },
      }) as BaseChatModel;

    case "gemini":
      return new ChatGoogleGenerativeAI({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens,
      });

    case "anthropic":
      return new ChatAnthropic({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
      });

    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
