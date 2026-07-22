import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMConfig } from "../../src/agent/providers/index.js";

const openAIMocks = vi.hoisted(() => ({
  ChatOpenAI: vi.fn(),
}));

const geminiMocks = vi.hoisted(() => ({
  ChatGoogleGenerativeAI: vi.fn(),
}));

const anthropicMocks = vi.hoisted(() => ({
  ChatAnthropic: vi.fn(),
}));

const kimiMocks = vi.hoisted(() => ({
  KimiChatModel: vi.fn(),
}));

vi.mock("@langchain/openai", () => openAIMocks);
vi.mock("@langchain/google-genai", () => geminiMocks);
vi.mock("@langchain/anthropic", () => anthropicMocks);
vi.mock("../../src/agent/providers/kimi.js", () => kimiMocks);

describe("createLLM", () => {
  beforeEach(() => {
    openAIMocks.ChatOpenAI.mockReset();
    geminiMocks.ChatGoogleGenerativeAI.mockReset();
    anthropicMocks.ChatAnthropic.mockReset();
    kimiMocks.KimiChatModel.mockReset();

    openAIMocks.ChatOpenAI.mockImplementation((config: unknown) => ({ config }) as object);
    geminiMocks.ChatGoogleGenerativeAI.mockImplementation((config: unknown) => ({ config }) as object);
    anthropicMocks.ChatAnthropic.mockImplementation((config: unknown) => ({ config }) as object);
    kimiMocks.KimiChatModel.mockImplementation((config: unknown) => ({ config }) as object);
  });

  it("omits unsupported temperature for OpenAI GPT-5 nano when a non-default value is requested", async () => {
    const { createLLM } = await import("../../src/agent/providers/index.js");

    createLLM({
      provider: "openai",
      apiKey: "sk-openai",
      model: "gpt-5-nano",
      temperature: 0.2,
      maxTokens: 24,
    } satisfies LLMConfig);

    expect(openAIMocks.ChatOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-openai",
      model: "gpt-5-nano",
      maxTokens: 24,
    });
  });

  it("preserves temperature=1 for OpenAI GPT-5 family models", async () => {
    const { createLLM } = await import("../../src/agent/providers/index.js");

    createLLM({
      provider: "openai",
      apiKey: "sk-openai",
      model: "gpt-5-nano-2025-08-07",
      temperature: 1,
      maxTokens: 24,
    } satisfies LLMConfig);

    expect(openAIMocks.ChatOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-openai",
      model: "gpt-5-nano-2025-08-07",
      temperature: 1,
      maxTokens: 24,
    });
  });

  it("preserves explicit temperature for non-GPT-5 OpenAI models", async () => {
    const { createLLM } = await import("../../src/agent/providers/index.js");

    createLLM({
      provider: "openai",
      apiKey: "sk-openai",
      model: "gpt-4o",
      temperature: 0.2,
      maxTokens: 24,
    } satisfies LLMConfig);

    expect(openAIMocks.ChatOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-openai",
      model: "gpt-4o",
      temperature: 0.2,
      maxTokens: 24,
    });
  });

  it("keeps non-OpenAI provider temperature handling unchanged", async () => {
    const { createLLM } = await import("../../src/agent/providers/index.js");

    createLLM({
      provider: "gemini",
      apiKey: "AIza-gemini",
      model: "gemini-3.6-flash",
      temperature: 0.2,
      maxTokens: 24,
    } satisfies LLMConfig);

    expect(geminiMocks.ChatGoogleGenerativeAI).toHaveBeenCalledWith({
      apiKey: "AIza-gemini",
      model: "gemini-3.6-flash",
      temperature: 0.2,
      maxOutputTokens: 24,
    });
  });
});
