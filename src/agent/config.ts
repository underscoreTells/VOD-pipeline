import dotenv from "dotenv";
import type { LLMConfig, LLMProviderType } from "./providers/index.js";

export interface AgentConfig {
  defaultProvider: LLMProviderType;
  providers: {
    gemini?: string;
    openai?: string;
    anthropic?: string;
    openrouter?: string;
  };
  temperature?: number;
  maxTokens?: number;
  openrouterBaseURL?: string;
}

export let ipcConfig: Partial<AgentConfig> | null = null;

export function setIpcConfig(config: Partial<AgentConfig> | null): void {
  ipcConfig = config;
}

export async function loadConfig(): Promise<AgentConfig> {
  try {
    if (ipcConfig) {
      const config: AgentConfig = {
        defaultProvider: ipcConfig.defaultProvider || "gemini",
        providers: ipcConfig.providers || {},
      };

      if (ipcConfig.temperature !== undefined) {
        config.temperature = ipcConfig.temperature;
      }
      if (ipcConfig.maxTokens !== undefined) {
        config.maxTokens = ipcConfig.maxTokens;
      }
      if (ipcConfig.openrouterBaseURL !== undefined) {
        config.openrouterBaseURL = ipcConfig.openrouterBaseURL;
      }

      if (Object.keys(config.providers).length === 0) {
        throw new Error("No API keys found. Please set at least one provider key.");
      }

      return config;
    }
  } catch (error) {
    console.warn("[Config] Failed to load IPC config, falling back to .env");
  }

  dotenv.config();

  const defaultProvider = (process.env.DEFAULT_PROVIDER || "gemini") as LLMProviderType;

  const providers: AgentConfig["providers"] = {};
  if (process.env.GEMINI_API_KEY) {
    providers.gemini = process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    providers.openai = process.env.OPENAI_API_KEY;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    providers.openrouter = process.env.OPENROUTER_API_KEY;
  }

  if (Object.keys(providers).length === 0) {
    throw new Error(
      "No API keys found. Please set at least one of: GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY in .env"
    );
  }

  return {
    defaultProvider,
    providers,
    temperature: 0.7,
    maxTokens: undefined,
    openrouterBaseURL: process.env.OPENROUTER_BASE_URL,
  };
}

export function getProviderLLMConfig(
  agentConfig: AgentConfig,
  provider?: LLMProviderType
): LLMConfig {
  const providerType = provider ?? agentConfig.defaultProvider;

  const apiKey = agentConfig.providers[providerType];
  if (!apiKey) {
    throw new Error(`No API key found for provider: ${providerType}`);
  }

  const llmConfig: LLMConfig = {
    provider: providerType,
    apiKey,
    temperature: agentConfig.temperature,
    maxTokens: agentConfig.maxTokens,
  };

  if (providerType === "openrouter") {
    llmConfig.baseURL = agentConfig.openrouterBaseURL;
  }

  return llmConfig;
}
