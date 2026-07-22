import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getChapter: vi.fn(),
  getTranscriptsByChapter: vi.fn(),
}));

const llmMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
  createLLM: vi.fn(() => ({
    invoke: llmMocks.invoke,
  })),
}));

vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/agent/providers/index.js", () => providerMocks);

describe("naming service", () => {
  beforeEach(() => {
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(llmMocks).forEach((mock) => mock.mockReset());
    Object.values(providerMocks).forEach((mock) => mock.mockReset());

    providerMocks.createLLM.mockReturnValue({
      invoke: llmMocks.invoke,
    });
    databaseMocks.getChapter.mockResolvedValue({
      id: 7,
      title: "Treasure Run",
    });
    databaseMocks.getTranscriptsByChapter.mockResolvedValue([
      { text: "We found the chest right here", start_time: 12, end_time: 18 },
    ]);
  });

  it("uses OpenAI naming models for clip titles and sanitizes the result", async () => {
    llmMocks.invoke.mockResolvedValue({
      content: "\"Golden Chest Drop.\"",
    });

    const { suggestChapterClipName } = await import("../../src/electron/services/naming-service.js");
    const result = await suggestChapterClipName({
      chapterId: 7,
      inPoint: 10,
      outPoint: 20,
      model: "gpt-5-nano",
      providerConfig: {
        providers: {
          openai: "sk-openai",
        },
      },
    });

    expect(providerMocks.createLLM).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-5-nano",
      apiKey: "sk-openai",
      temperature: 0.2,
      maxTokens: 24,
    }));
    expect(result).toBe("Golden Chest Drop");
  });

  it("uses Gemini naming models for thread titles and extracts text parts", async () => {
    llmMocks.invoke.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "\"Boss Fight Plan!\"",
        },
      ],
    });

    const { suggestConversationTitle } = await import("../../src/electron/services/naming-service.js");
    const result = await suggestConversationTitle({
      message: "Let's figure out how to stage the boss fight.",
      chapterTitle: "Boss Fight",
      model: "gemini-3.5-flash-lite",
      providerConfig: {
        providers: {
          gemini: "AIza-gemini",
        },
      },
    });

    expect(providerMocks.createLLM).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      apiKey: "AIza-gemini",
      maxTokens: 20,
    }));
    expect(result).toBe("Boss Fight Plan");
  });

  it("uses Kimi naming models and returns null when the selected provider key is missing", async () => {
    llmMocks.invoke.mockResolvedValue({
      content: "Final Twist Setup",
    });

    const { suggestConversationTitle } = await import("../../src/electron/services/naming-service.js");
    const available = await suggestConversationTitle({
      message: "We need a better title for this callback thread.",
      chapterTitle: "Callbacks",
      model: "kimi-k3",
      providerConfig: {
        providers: {
          kimi: "sk-kimi",
        },
        baseURLs: {
          kimi: "https://api.moonshot.cn/v1",
        },
      },
    });

    expect(providerMocks.createLLM).toHaveBeenCalledWith(expect.objectContaining({
      provider: "kimi",
      model: "kimi-k3",
      apiKey: "sk-kimi",
      baseURL: "https://api.moonshot.cn/v1",
    }));
    expect(available).toBe("Final Twist Setup");

    providerMocks.createLLM.mockClear();
    const missing = await suggestConversationTitle({
      message: "We need a better title for this callback thread.",
      chapterTitle: "Callbacks",
      model: "kimi-k3",
      providerConfig: {
        providers: {},
      },
    });

    expect(providerMocks.createLLM).not.toHaveBeenCalled();
    expect(missing).toBeNull();
  });

  it("falls back to the provider default model when the selected naming model errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    llmMocks.invoke
      .mockRejectedValueOnce(new Error("model_not_found"))
      .mockResolvedValueOnce({
        content: "\"Treasure Thread Backup\"",
      });

    const { suggestConversationTitle } = await import("../../src/electron/services/naming-service.js");
    const result = await suggestConversationTitle({
      message: "We need a better title for this callback thread.",
      chapterTitle: "Callbacks",
      model: "gpt-5-nano",
      providerConfig: {
        providers: {
          openai: "sk-openai",
        },
      },
    });

    expect(providerMocks.createLLM).toHaveBeenCalledTimes(2);
    expect(providerMocks.createLLM).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: "openai",
      model: "gpt-5-nano",
      apiKey: "sk-openai",
      temperature: 0.2,
      maxTokens: 20,
    }));
    expect(providerMocks.createLLM).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-openai",
      temperature: 0.2,
      maxTokens: 20,
    }));
    expect(result).toBe("Treasure Thread Backup");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back to another configured naming provider after provider/model failures", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    llmMocks.invoke
      .mockRejectedValueOnce(new Error("gpt_5_unavailable"))
      .mockRejectedValueOnce(new Error("gpt_4o_unavailable"))
      .mockResolvedValueOnce({
        content: "\"Gemini Rescue Title\"",
      });

    const { suggestConversationTitle } = await import("../../src/electron/services/naming-service.js");
    const result = await suggestConversationTitle({
      message: "We need a better title for this callback thread.",
      chapterTitle: "Callbacks",
      model: "gpt-5-nano",
      providerConfig: {
        providers: {
          openai: "sk-openai",
          gemini: "AIza-gemini",
        },
      },
    });

    expect(providerMocks.createLLM).toHaveBeenCalledTimes(3);
    expect(providerMocks.createLLM).toHaveBeenNthCalledWith(3, expect.objectContaining({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      apiKey: "AIza-gemini",
      temperature: 0.2,
      maxTokens: 20,
    }));
    expect(result).toBe("Gemini Rescue Title");
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });
});
