/**
 * Runtime provider registry (Node-only).
 *
 * Companion to the metadata registry in `src/shared/llm/provider-registry.ts`.
 * Each entry supplies the pieces that require Node/LangChain: the chat model
 * factory and the provider's tool-call strategy.
 *
 * Adding a provider: add a metadata entry in the shared registry, then one
 * `ProviderRuntime` entry here.
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  getProviderMetadata,
  resolveProviderModel,
  type LLMProviderType,
} from "../../shared/llm/provider-registry.js";
import { KimiChatModel } from "./kimi.js";
import { AnthropicToolStrategy } from "../tools/strategies/anthropic.js";
import { GeminiToolStrategy } from "../tools/strategies/gemini.js";
import { KimiToolStrategy } from "../tools/strategies/kimi.js";
import { OpenAIToolStrategy } from "../tools/strategies/openai.js";
import { OpenRouterToolStrategy } from "../tools/strategies/openrouter.js";
import type { ProviderToolStrategy } from "../tools/strategies/base.js";

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
}

export interface ProviderRuntime {
  /** Creates a chat model instance for a resolved model name. */
  createModel(config: LLMConfig, model: string): BaseChatModel;
  /** Provider-specific tool schema compiler / bind payload builder. */
  toolStrategy: ProviderToolStrategy;
}

function isDirectOpenAIGPT5Model(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gpt-5");
}

/**
 * GPT-5 family models reject non-default temperatures; strip the option
 * unless the caller explicitly asked for the supported value of 1.
 */
function getOpenAITemperatureConfig(
  model: string,
  temperature: number | undefined
): { temperature?: number } {
  if (!isDirectOpenAIGPT5Model(model)) {
    return { temperature: temperature ?? 0.7 };
  }
  if (temperature === 1) {
    return { temperature: 1 };
  }
  return {};
}

const PROVIDER_RUNTIMES: Record<LLMProviderType, ProviderRuntime> = {
  openai: {
    toolStrategy: new OpenAIToolStrategy(),
    createModel(config, model) {
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        ...getOpenAITemperatureConfig(model, config.temperature),
        maxTokens: config.maxTokens,
      });
    },
  },
  openrouter: {
    toolStrategy: new OpenRouterToolStrategy(),
    createModel(config, model) {
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
        configuration: {
          baseURL:
            config.baseURL || getProviderMetadata("openrouter").defaultBaseURL,
        },
      }) as BaseChatModel;
    },
  },
  openaiCompatible: {
    toolStrategy: new OpenAIToolStrategy('openaiCompatible'),
    createModel(config, model) {
      return new ChatOpenAI({
        apiKey: config.apiKey || 'not-required',
        model,
        temperature: config.temperature ?? 0.2,
        maxTokens: config.maxTokens,
        configuration: { baseURL: config.baseURL },
      }) as BaseChatModel;
    },
  },
  gemini: {
    toolStrategy: new GeminiToolStrategy(),
    createModel(config, model) {
      return new ChatGoogleGenerativeAI({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens,
      });
    },
  },
  anthropic: {
    toolStrategy: new AnthropicToolStrategy(),
    createModel(config, model) {
      return new ChatAnthropic({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
      });
    },
  },
  kimi: {
    toolStrategy: new KimiToolStrategy(),
    createModel(config, model) {
      return new KimiChatModel({
        apiKey: config.apiKey,
        model,
        temperature: config.temperature ?? 0.7,
        maxTokens: config.maxTokens,
        baseURL: config.baseURL,
      });
    },
  },
  kimiCode: {
    toolStrategy: new OpenAIToolStrategy('kimiCode'),
    createModel(config, model) {
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        maxTokens: config.maxTokens,
        modelKwargs: { reasoning_effort: 'high' },
        configuration: {
          baseURL: config.baseURL || getProviderMetadata('kimiCode').defaultBaseURL,
        },
      }) as BaseChatModel;
    },
  },
};

export function getProviderRuntime(provider: LLMProviderType): ProviderRuntime {
  const runtime = PROVIDER_RUNTIMES[provider];
  if (!runtime) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  return runtime;
}

export function createLLM(config: LLMConfig): BaseChatModel {
  const model = resolveProviderModel(config.provider, config.model);
  return getProviderRuntime(config.provider).createModel(config, model);
}
