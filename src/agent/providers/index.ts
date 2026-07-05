/**
 * Provider entry point for the agent worker.
 *
 * Metadata (ids, capabilities, defaults) lives in the shared registry:
 *   src/shared/llm/provider-registry.ts
 * Runtime factories/strategies live in:
 *   src/agent/providers/registry.ts
 */
export {
  VIDEO_CAPABLE_PROVIDERS,
  isLLMProvider,
  normalizeProvider,
  providerSupportsVideo,
  type LLMProviderType,
} from "../../shared/llm/provider-registry.js";

export {
  createLLM,
  getProviderRuntime,
  type LLMConfig,
  type ProviderRuntime,
} from "./registry.js";
