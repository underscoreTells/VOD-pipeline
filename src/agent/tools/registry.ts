import type { LLMProviderType } from "../providers/index.js";
import { AnthropicToolStrategy } from "./strategies/anthropic.js";
import { GeminiToolStrategy } from "./strategies/gemini.js";
import { KimiToolStrategy } from "./strategies/kimi.js";
import { OpenAIToolStrategy } from "./strategies/openai.js";
import { OpenRouterToolStrategy } from "./strategies/openrouter.js";
import type { ProviderToolStrategy } from "./strategies/base.js";

const STRATEGIES: Record<LLMProviderType, ProviderToolStrategy> = {
  openai: new OpenAIToolStrategy(),
  anthropic: new AnthropicToolStrategy(),
  gemini: new GeminiToolStrategy(),
  openrouter: new OpenRouterToolStrategy(),
  kimi: new KimiToolStrategy(),
};

export function getProviderToolStrategy(provider: LLMProviderType): ProviderToolStrategy {
  return STRATEGIES[provider];
}
