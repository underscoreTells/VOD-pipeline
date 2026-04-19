import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, IPC_ERROR_CODES } from "../../src/electron/ipc/channels.js";

const registeredHandlers = vi.hoisted(() => new Map<string, Function>());

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const bridgeMocks = vi.hoisted(() => ({
  ensureStarted: vi.fn(),
  send: vi.fn(),
}));

const databaseMocks = vi.hoisted(() => ({
  createChatConversation: vi.fn(),
  createChatMessage: vi.fn(),
  createClip: vi.fn(),
  deleteChatConversation: vi.fn(),
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChatConversation: vi.fn(),
  getChatConversationsByChapter: vi.fn(),
  getChatMessagesByConversation: vi.fn(),
  getClip: vi.fn(),
  getProject: vi.fn(),
  getSuggestionsByConversation: vi.fn(),
  updateChatConversation: vi.fn(),
  updateClip: vi.fn(),
}));

const handlerSupportMocks = vi.hoisted(() => ({
  applyNearLimitTokenGuard: vi.fn(),
  buildAgentChatContext: vi.fn(),
  deriveConversationTitle: vi.fn(),
  normalizeConversationProvider: vi.fn((value: unknown) => value ?? null),
  normalizeTimelineActions: vi.fn(),
  parseAgentGraphResult: vi.fn(),
  persistAgentSuggestions: vi.fn(),
  scheduleChapterMediaPrewarm: vi.fn(async () => {}),
  toNumberOrNull: vi.fn((value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }),
}));

const devRuntimeMocks = vi.hoisted(() => ({
  getBackendRuntimeStaleness: vi.fn(),
}));

vi.mock("electron", () => electronMocks);

vi.mock("../../src/electron/agent-bridge.js", () => ({
  getAgentBridge: () => bridgeMocks,
}));

vi.mock("../../src/electron/database/index.js", () => databaseMocks);

vi.mock("../../src/electron/ipc/handler-support.js", () => handlerSupportMocks);

vi.mock("../../src/electron/dev-runtime.js", () => devRuntimeMocks);

describe("agent chat handler", () => {
  beforeEach(async () => {
    registeredHandlers.clear();
    Object.values(electronMocks.ipcMain).forEach((mock) => mock.mockClear());
    Object.values(bridgeMocks).forEach((mock) => mock.mockReset());
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(handlerSupportMocks).forEach((mock) => mock.mockReset());
    devRuntimeMocks.getBackendRuntimeStaleness.mockReset();

    databaseMocks.getProject.mockResolvedValue({ id: 1 });
    databaseMocks.getChatConversation.mockResolvedValue({
      id: 2,
      project_id: 1,
      chapter_id: 3,
      provider: "gemini",
      thread_id: "thread-1",
      title: "Existing conversation",
    });
    databaseMocks.getChapter.mockResolvedValue({
      id: 3,
      project_id: 1,
      start_time: 0,
      end_time: 120,
    });
    databaseMocks.getAssetsForChapter.mockResolvedValue([11]);
    databaseMocks.getSuggestionsByConversation.mockResolvedValue([]);
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([
      {
        id: 10,
        role: "user",
        content: "Please provide new clips for this chapter",
      },
    ]);
    databaseMocks.createChatMessage
      .mockResolvedValueOnce({ id: 100 })
      .mockResolvedValueOnce({ id: 101 });
    handlerSupportMocks.buildAgentChatContext.mockResolvedValue({
      chapter: { id: "3", startTime: 0, endTime: 120 },
      chapterAssetIds: [11],
      chapterClips: [],
      transcript: "Transcript overview",
      detailedTranscripts: [],
      assets: [],
      proxyPath: null,
    });
    handlerSupportMocks.applyNearLimitTokenGuard.mockReturnValue({
      messages: [{ role: "user", content: "Please provide new clips for this chapter" }],
      estimatedTotalTokens: 32,
      effectiveContextLimit: 1_024,
      compressed: false,
    });
    handlerSupportMocks.parseAgentGraphResult.mockReturnValue({
      message: "Drafted one new clip proposal.",
      thinkingMarkdown: null,
      suggestionDrafts: [],
      outcome: "proposal",
    });
    handlerSupportMocks.persistAgentSuggestions.mockResolvedValue([]);

    const { registerAgentHandlers } = await import("../../src/electron/ipc/handlers/agent.js");
    registerAgentHandlers();
  });

  it("returns a stale-runtime error before sending chat to the agent bridge", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue({
      runtimeSessionId: "runtime-1",
      initializedAt: "2026-04-18T00:00:00.000Z",
      startupFingerprint: 1,
      currentFingerprint: 2,
    });

    const chatHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_CHAT);
    const result = await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
    });

    expect(result).toEqual({
      success: false,
      error: "Backend code changed since this Electron session started. Restarting is required.",
      code: IPC_ERROR_CODES.STALE_DEV_RUNTIME,
    });
    expect(databaseMocks.createChatMessage).not.toHaveBeenCalled();
    expect(bridgeMocks.send).not.toHaveBeenCalled();
  });

  it("proceeds to the bridge when the runtime is fresh", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);
    bridgeMocks.send.mockResolvedValue({
      type: "turn_complete",
      requestId: "worker-1",
      threadId: "thread-1",
      result: {
        assistantResponse: "Drafted one new clip proposal.",
        outcome: "proposal",
      },
    });

    const chatHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_CHAT);
    const result = await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
    });

    expect(bridgeMocks.ensureStarted).toHaveBeenCalledTimes(1);
    expect(bridgeMocks.send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      data: {
        message: "Drafted one new clip proposal.",
        outcome: "proposal",
      },
    });
  });
});
