import type { LLMProviderType } from "../../shared/llm/provider-registry.js";
import { getProviderRuntime } from "../providers/registry.js";
import type { ProviderToolStrategy } from "./strategies/base.js";

export function getProviderToolStrategy(provider: LLMProviderType): ProviderToolStrategy {
  return getProviderRuntime(provider).toolStrategy;
}
