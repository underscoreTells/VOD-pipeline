import dotenv from "dotenv";
import type { LLMConfig, LLMProviderType } from "./providers/index.js";
import { PROVIDER_IDS, PROVIDER_METADATA } from "../shared/llm/provider-registry.js";

export interface AgentConfig {
  defaultProvider: LLMProviderType;
  providers: Partial<Record<LLMProviderType, string>>;
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
      // Align with the .env path: temperature defaults to 0.7 and openrouterBaseURL falls back to env.
      const config: AgentConfig = {
        defaultProvider: ipcConfig.defaultProvider || "gemini",
        providers: ipcConfig.providers || {},
        temperature: ipcConfig.temperature ?? 0.7,
        maxTokens: ipcConfig.maxTokens,
        openrouterBaseURL:
          ipcConfig.openrouterBaseURL ??
          process.env[PROVIDER_METADATA.openrouter.baseURLEnvVar ?? ""],
      };

      if (Object.keys(config.providers).length === 0) {
        throw new Error("No API keys found. Please set at least one provider key.");
      }

      return config;
    }
  } catch (error) {
    console.warn("[Config] Failed to load IPC config, falling back to .env:", error);
  }

  dotenv.config({ quiet: true });

  const defaultProvider = (process.env.DEFAULT_PROVIDER || "gemini") as LLMProviderType;

  const providers: AgentConfig["providers"] = {};
  for (const id of PROVIDER_IDS) {
    const envValue = process.env[PROVIDER_METADATA[id].envVar];
    if (envValue) {
      providers[id] = envValue;
    }
  }

  if (Object.keys(providers).length === 0) {
    const envVars = PROVIDER_IDS.map((id) => PROVIDER_METADATA[id].envVar).join(", ");
    throw new Error(
      `No API keys found. Please set at least one of: ${envVars} in .env`
    );
  }

  return {
    defaultProvider,
    providers,
    temperature: 0.7,
    maxTokens: undefined,
    openrouterBaseURL: process.env[PROVIDER_METADATA.openrouter.baseURLEnvVar ?? ""],
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
