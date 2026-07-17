import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS, IPC_ERROR_CODES } from "../../src/electron/ipc/channels.js";

type MockIpcHandler = (...args: unknown[]) => unknown;

const registeredHandlers = vi.hoisted(() => new Map<string, MockIpcHandler>());

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: MockIpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const bridgeMocks = vi.hoisted(() => ({
  ensureStarted: vi.fn(),
  send: vi.fn(),
}));

const databaseMocks = vi.hoisted(() => ({
  cloneChatMessagesThrough: vi.fn(),
  createChatConversation: vi.fn(),
  createChatMessage: vi.fn(),
  createClip: vi.fn(),
  deleteChatMessagesAfter: vi.fn(),
  deleteChatConversation: vi.fn(),
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChatConversation: vi.fn(),
  getChatConversationsByChapter: vi.fn(),
  getChatMessageByConversation: vi.fn(),
  getChatMessagesByConversation: vi.fn(),
  getClip: vi.fn(),
  getProject: vi.fn(),
  getSuggestionsByConversation: vi.fn(),
  updateUserChatMessageContent: vi.fn(),
  updateChatConversation: vi.fn(),
  updateClip: vi.fn(),
}));

const handlerSupportMocks = vi.hoisted(() => ({
  applyNearLimitTokenGuard: vi.fn(),
  buildAgentChatContext: vi.fn(),
  getAgentGroundingStatus: vi.fn(),
  normalizeConversationProvider: vi.fn((value: unknown) => value ?? null),
  normalizeTimelineActions: vi.fn(),
  parseConversationTurnResult: vi.fn(),
  persistAgentSuggestions: vi.fn(),
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

const namingServiceMocks = vi.hoisted(() => ({
  suggestConversationTitle: vi.fn(),
}));

const conversationTitleMocks = vi.hoisted(() => ({
  DEFAULT_CONVERSATION_TITLE: "New conversation",
  deriveConversationTitle: vi.fn(),
}));

vi.mock("electron", () => electronMocks);

vi.mock("../../src/electron/agent-bridge.js", () => ({
  getAgentBridge: () => bridgeMocks,
}));

vi.mock("../../src/electron/database/index.js", () => databaseMocks);

vi.mock("../../src/electron/ipc/handler-support.js", () => handlerSupportMocks);

vi.mock("../../src/electron/dev-runtime.js", () => devRuntimeMocks);

vi.mock("../../src/electron/services/naming-service.js", () => namingServiceMocks);

vi.mock("../../src/shared/utils/conversation-title.js", () => conversationTitleMocks);

describe("agent chat handler", () => {
  beforeEach(async () => {
    registeredHandlers.clear();
    Object.values(electronMocks.ipcMain).forEach((mock) => mock.mockClear());
    Object.values(bridgeMocks).forEach((mock) => mock.mockReset());
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(handlerSupportMocks).forEach((mock) => mock.mockReset());
    devRuntimeMocks.getBackendRuntimeStaleness.mockReset();
    Object.values(namingServiceMocks).forEach((mock) => mock.mockReset());
    Object.values(conversationTitleMocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) {
        mock.mockReset();
      }
    });

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
    databaseMocks.updateChatConversation.mockResolvedValue(true);
    databaseMocks.updateUserChatMessageContent.mockResolvedValue(true);
    databaseMocks.deleteChatMessagesAfter.mockResolvedValue(1);
    databaseMocks.cloneChatMessagesThrough.mockResolvedValue(1);
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([
      {
        id: 10,
        conversation_id: 2,
        role: "user",
        content: "Please provide new clips for this chapter",
        created_at: "2026-04-18T12:00:00.000Z",
      },
    ]);
    databaseMocks.getChatMessageByConversation.mockResolvedValue({
      id: 10,
      conversation_id: 2,
      role: "user",
      content: "Please provide new clips for this chapter",
      created_at: "2026-04-18T12:00:00.000Z",
    });
    databaseMocks.createChatMessage
      .mockResolvedValueOnce({ id: 100, created_at: "2026-04-18T12:00:00.000Z" })
      .mockResolvedValueOnce({ id: 101, created_at: "2026-04-18T12:00:05.000Z" });
    handlerSupportMocks.buildAgentChatContext.mockResolvedValue({
      chapter: { id: "3", startTime: 0, endTime: 120 },
      chapterAssetIds: [11],
      chapterClips: [],
      transcript: "Transcript overview",
      detailedTranscripts: [],
      videoAnalysisAssets: [{ assetId: 11, proxyPath: "/tmp/chapter-proxy.mp4" }],
    });
    handlerSupportMocks.getAgentGroundingStatus.mockResolvedValue({
      status: "ready",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 1,
      assets: [{ assetId: 11, status: "ready" }],
      message: "Video grounding is ready.",
    });
    handlerSupportMocks.applyNearLimitTokenGuard.mockReturnValue({
      messages: [{ role: "user", content: "Please provide new clips for this chapter" }],
      estimatedTotalTokens: 32,
      effectiveContextLimit: 1_024,
      compressed: false,
    });
    handlerSupportMocks.parseConversationTurnResult.mockReturnValue({
      message: "Drafted one new clip proposal.",
      thinkingMarkdown: null,
      suggestionDrafts: [],
      outcome: "proposal",
    });
    handlerSupportMocks.persistAgentSuggestions.mockResolvedValue([]);
    namingServiceMocks.suggestConversationTitle.mockResolvedValue(null);
    conversationTitleMocks.deriveConversationTitle.mockReturnValue("Fallback title");
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);

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

  it("returns a proxy-not-ready error before persisting the chat message", async () => {
    handlerSupportMocks.getAgentGroundingStatus.mockResolvedValue({
      status: "generating",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 0,
      assets: [{ assetId: 11, status: "generating" }],
      message: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
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
      error: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
      code: IPC_ERROR_CODES.AGENT_PROXY_NOT_READY,
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
    expect(bridgeMocks.send.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        context: {
          chapter: { id: "3", startTime: 0, endTime: 120 },
          chapterAssetIds: [11],
          chapterClips: [],
          transcript: "Transcript overview",
          detailedTranscripts: [],
          videoAnalysisAssets: [{ assetId: 11, proxyPath: "/tmp/chapter-proxy.mp4" }],
        },
      },
    });
    expect(bridgeMocks.send.mock.calls[0]?.[0]?.metadata?.context).not.toHaveProperty("assets");
    expect(handlerSupportMocks.buildAgentChatContext).toHaveBeenCalledWith(1, 3, {
      ensureChapterProxyReady: false,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        message: "Drafted one new clip proposal.",
        outcome: "proposal",
        userMessageId: 100,
        assistantMessageId: 101,
      },
    });
  });

  it("summarizes keep-window suggestions with keep-oriented wording in follow-up context", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);
    databaseMocks.getSuggestionsByConversation.mockResolvedValue([
      {
        id: 7,
        chapter_id: 3,
        conversation_id: 2,
        chat_message_id: 101,
        in_point: 12,
        out_point: 18,
        description: "Keep the payoff reaction",
        reasoning: "Skips the slow lead-in.",
        provider: "gemini",
        action_type: "create_clip",
        target_clip_id: null,
        action_payload_json: null,
        preview_snapshot_json: null,
        status: "pending",
        display_order: 0,
        created_at: "2026-04-18T12:00:00.000Z",
        applied_at: null,
        clip_id: null,
      },
    ]);
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
    await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
    });

    expect(handlerSupportMocks.applyNearLimitTokenGuard).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        suggestionSummary: expect.stringContaining(
          "keep window 12.00-18.00s status=pending desc=Keep the payoff reaction"
        ),
      }),
      expect.anything()
    );
    expect(handlerSupportMocks.applyNearLimitTokenGuard.mock.calls[0]?.[1]?.suggestionSummary).not.toContain(
      "create proposal"
    );
  });

  it("reports grounding status through the dedicated IPC handler", async () => {
    handlerSupportMocks.getAgentGroundingStatus.mockResolvedValue({
      status: "ready",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 1,
      assets: [{ assetId: 11, status: "ready" }],
      message: "Video grounding is ready.",
    });

    const groundingHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_GROUNDING_STATUS);
    const result = await groundingHandler?.({}, {
      projectId: "1",
      chapterId: "3",
      ensureReady: true,
    });

    expect(handlerSupportMocks.getAgentGroundingStatus).toHaveBeenCalledWith(1, 3, expect.objectContaining({
      ensureReady: true,
      proxyOptions: undefined,
    }));
    expect(result).toEqual({
      success: true,
      data: {
        status: "ready",
        requiredVideoAssetCount: 1,
        readyVideoAssetCount: 1,
        assets: [{ assetId: 11, status: "ready" }],
        message: "Video grounding is ready.",
      },
    });
  });

  it("does not regenerate a proxy while building validated chapter context", async () => {
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
    await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
      proxyOptions: {
        encodingMode: "gpu",
        quality: "fast",
      },
    });

    expect(handlerSupportMocks.buildAgentChatContext).toHaveBeenCalledWith(1, 3, {
      ensureChapterProxyReady: false,
    });
  });

  it("does not regenerate proxies during reroll and edit mutations", async () => {
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

    const rerollHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_REROLL_MESSAGE);
    await rerollHandler?.({}, {
      clientRequestId: "client-reroll",
      projectId: "1",
      conversationId: 2,
      messageId: 10,
      proxyOptions: {
        encodingMode: "cpu",
        quality: "high",
      },
    });

    expect(handlerSupportMocks.buildAgentChatContext).toHaveBeenLastCalledWith(1, 3, {
      ensureChapterProxyReady: false,
    });

    const editHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_EDIT_MESSAGE);
    await editHandler?.({}, {
      clientRequestId: "client-edit",
      projectId: "1",
      conversationId: 2,
      messageId: 10,
      message: "Tighten the payoff",
      proxyOptions: {
        encodingMode: "gpu",
        quality: "balanced",
      },
    });

    expect(handlerSupportMocks.buildAgentChatContext).toHaveBeenLastCalledWith(1, 3, {
      ensureChapterProxyReady: false,
    });
  });

  it("uses an AI-generated thread title on the first user message", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([]);
    databaseMocks.createChatMessage
      .mockResolvedValueOnce({ id: 100, created_at: "2026-04-18T12:00:00.000Z" })
      .mockResolvedValueOnce({ id: 101, created_at: "2026-04-18T12:00:05.000Z" });
    databaseMocks.getChatConversation.mockResolvedValue({
      id: 2,
      project_id: 1,
      chapter_id: 3,
      provider: "gemini",
      thread_id: "thread-1",
      title: "New conversation",
    });
    namingServiceMocks.suggestConversationTitle.mockResolvedValue("Raid Plan");
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
    await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
      threadNamingModel: "gpt-5-nano",
      agentConfig: {
        providers: {
          openai: "sk-openai",
        },
      },
    });

    expect(namingServiceMocks.suggestConversationTitle).toHaveBeenCalledWith({
      message: "Please provide new clips for this chapter",
      chapterTitle: undefined,
      model: "gpt-5-nano",
      providerConfig: {
        providers: {
          openai: "sk-openai",
        },
      },
    });
    expect(databaseMocks.updateChatConversation).toHaveBeenCalledWith(2, {
      title: "Raid Plan",
    });
  });

  it("falls back to the derived title when the selected naming provider is unavailable", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([]);
    databaseMocks.createChatMessage
      .mockResolvedValueOnce({ id: 100, created_at: "2026-04-18T12:00:00.000Z" })
      .mockResolvedValueOnce({ id: 101, created_at: "2026-04-18T12:00:05.000Z" });
    databaseMocks.getChatConversation.mockResolvedValue({
      id: 2,
      project_id: 1,
      chapter_id: 3,
      provider: "gemini",
      thread_id: "thread-1",
      title: "New conversation",
    });
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
    await chatHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      message: "Please provide new clips for this chapter",
      threadNamingModel: "gemini-3-flash-preview",
      agentConfig: {
        providers: {},
      },
    });

    expect(databaseMocks.updateChatConversation).toHaveBeenCalledWith(2, {
      title: "Fallback title",
    });
  });

  it("blocks rerolls before mutating history when grounding is not ready", async () => {
    handlerSupportMocks.getAgentGroundingStatus.mockResolvedValue({
      status: "generating",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 0,
      assets: [{ assetId: 11, status: "generating" }],
      message: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
    });

    const rerollHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_REROLL_MESSAGE);
    const result = await rerollHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 10,
    });

    expect(result).toEqual({
      success: false,
      error: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
      code: IPC_ERROR_CODES.AGENT_PROXY_NOT_READY,
    });
    expect(databaseMocks.deleteChatMessagesAfter).not.toHaveBeenCalled();
    expect(bridgeMocks.send).not.toHaveBeenCalled();
  });

  it("blocks edits before mutating history when grounding is not ready", async () => {
    handlerSupportMocks.getAgentGroundingStatus.mockResolvedValue({
      status: "generating",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 0,
      assets: [{ assetId: 11, status: "generating" }],
      message: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
    });

    const editHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_EDIT_MESSAGE);
    const result = await editHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 10,
      message: "Please provide sharper clips for this chapter",
    });

    expect(result).toEqual({
      success: false,
      error: "Video proxy is still preparing. Agent chat is locked until grounding is ready.",
      code: IPC_ERROR_CODES.AGENT_PROXY_NOT_READY,
    });
    expect(databaseMocks.updateUserChatMessageContent).not.toHaveBeenCalled();
    expect(bridgeMocks.send).not.toHaveBeenCalled();
  });

  it("falls back to the derived title when AI thread naming throws", async () => {
    devRuntimeMocks.getBackendRuntimeStaleness.mockResolvedValue(null);
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([]);
    databaseMocks.createChatMessage
      .mockResolvedValueOnce({ id: 100, created_at: "2026-04-18T12:00:00.000Z" })
      .mockResolvedValueOnce({ id: 101, created_at: "2026-04-18T12:00:05.000Z" });
    databaseMocks.getChatConversation.mockResolvedValue({
      id: 2,
      project_id: 1,
      chapter_id: 3,
      provider: "gemini",
      thread_id: "thread-1",
      title: "New conversation",
    });
    namingServiceMocks.suggestConversationTitle.mockRejectedValue(new Error("naming failed"));
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
      threadNamingModel: "kimi-k2.5",
      agentConfig: {
        providers: {
          kimi: "sk-kimi",
        },
      },
    });

    expect(databaseMocks.updateChatConversation).toHaveBeenCalledWith(2, {
      title: "Fallback title",
    });
    expect(result).toMatchObject({
      success: true,
    });
  });

  it("rerolls from a user message by truncating later history and regenerating the assistant turn", async () => {
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([
      {
        id: 10,
        conversation_id: 2,
        role: "user",
        content: "Setup the chapter",
        created_at: "2026-04-18T12:00:00.000Z",
      },
      {
        id: 11,
        conversation_id: 2,
        role: "assistant",
        content: "Keep the setup.",
        created_at: "2026-04-18T12:01:00.000Z",
      },
      {
        id: 12,
        conversation_id: 2,
        role: "user",
        content: "Find a sharper payoff",
        created_at: "2026-04-18T12:02:00.000Z",
      },
      {
        id: 13,
        conversation_id: 2,
        role: "assistant",
        content: "Use the reset clip.",
        created_at: "2026-04-18T12:03:00.000Z",
      },
    ]);
    databaseMocks.createChatMessage.mockReset();
    databaseMocks.createChatMessage.mockResolvedValue({
      id: 201,
      created_at: "2026-04-18T12:04:00.000Z",
    });
    bridgeMocks.send.mockResolvedValue({
      type: "turn_complete",
      requestId: "worker-1",
      threadId: "thread-2",
      result: {
        assistantResponse: "Try the ladder payoff instead.",
        outcome: "proposal",
      },
    });

    const rerollHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_REROLL_MESSAGE);
    const result = await rerollHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 12,
    });

    expect(databaseMocks.deleteChatMessagesAfter).toHaveBeenCalledWith(2, 12);
    expect(databaseMocks.createChatMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      data: {
        userMessageId: 12,
        assistantMessageId: 201,
      },
    });
  });

  it("rerolls from an assistant message by anchoring on the preceding user turn", async () => {
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([
      {
        id: 10,
        conversation_id: 2,
        role: "user",
        content: "Setup the chapter",
        created_at: "2026-04-18T12:00:00.000Z",
      },
      {
        id: 11,
        conversation_id: 2,
        role: "assistant",
        content: "Keep the setup.",
        created_at: "2026-04-18T12:01:00.000Z",
      },
      {
        id: 12,
        conversation_id: 2,
        role: "user",
        content: "Find a sharper payoff",
        created_at: "2026-04-18T12:02:00.000Z",
      },
      {
        id: 13,
        conversation_id: 2,
        role: "assistant",
        content: "Use the reset clip.",
        created_at: "2026-04-18T12:03:00.000Z",
      },
    ]);
    databaseMocks.createChatMessage.mockReset();
    databaseMocks.createChatMessage.mockResolvedValue({
      id: 202,
      created_at: "2026-04-18T12:04:30.000Z",
    });
    bridgeMocks.send.mockResolvedValue({
      type: "turn_complete",
      requestId: "worker-1",
      threadId: "thread-2",
      result: {
        assistantResponse: "Land on the ladder payoff.",
        outcome: "proposal",
      },
    });

    const rerollHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_REROLL_MESSAGE);
    const result = await rerollHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 13,
    });

    expect(databaseMocks.deleteChatMessagesAfter).toHaveBeenCalledWith(2, 12);
    expect(result).toMatchObject({
      success: true,
      data: {
        userMessageId: 12,
        assistantMessageId: 202,
      },
    });
  });

  it("edits a user message, truncates later history, and regenerates the assistant turn", async () => {
    databaseMocks.getChatMessagesByConversation.mockResolvedValue([
      {
        id: 10,
        conversation_id: 2,
        role: "user",
        content: "Setup the chapter",
        created_at: "2026-04-18T12:00:00.000Z",
      },
      {
        id: 11,
        conversation_id: 2,
        role: "assistant",
        content: "Keep the setup.",
        created_at: "2026-04-18T12:01:00.000Z",
      },
      {
        id: 12,
        conversation_id: 2,
        role: "user",
        content: "Find a softer payoff",
        created_at: "2026-04-18T12:02:00.000Z",
      },
      {
        id: 13,
        conversation_id: 2,
        role: "assistant",
        content: "Use the reset clip.",
        created_at: "2026-04-18T12:03:00.000Z",
      },
    ]);
    databaseMocks.getChatMessageByConversation.mockResolvedValue({
      id: 12,
      conversation_id: 2,
      role: "user",
      content: "Find a softer payoff",
      created_at: "2026-04-18T12:02:00.000Z",
    });
    databaseMocks.createChatMessage.mockReset();
    databaseMocks.createChatMessage.mockResolvedValue({
      id: 203,
      created_at: "2026-04-18T12:05:00.000Z",
    });
    bridgeMocks.send.mockResolvedValue({
      type: "turn_complete",
      requestId: "worker-1",
      threadId: "thread-3",
      result: {
        assistantResponse: "Use the ladder payoff instead.",
        outcome: "proposal",
      },
    });

    const editHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_EDIT_MESSAGE);
    const result = await editHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 12,
      message: "Find a sharper payoff",
      threadNamingModel: "gpt-5-nano",
    });

    expect(databaseMocks.updateUserChatMessageContent).toHaveBeenCalledWith(
      2,
      12,
      "Find a sharper payoff"
    );
    expect(databaseMocks.deleteChatMessagesAfter).toHaveBeenCalledWith(2, 12);
    expect(result).toMatchObject({
      success: true,
      data: {
        userMessageId: 12,
        assistantMessageId: 203,
      },
    });
  });

  it("rejects edits for non-user messages", async () => {
    databaseMocks.getChatMessageByConversation.mockResolvedValue({
      id: 13,
      conversation_id: 2,
      role: "assistant",
      content: "Use the reset clip.",
      created_at: "2026-04-18T12:03:00.000Z",
    });

    const editHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_EDIT_MESSAGE);
    const result = await editHandler?.({}, {
      clientRequestId: "client-1",
      projectId: "1",
      conversationId: 2,
      messageId: 13,
      message: "Changed text",
    });

    expect(result).toEqual({
      success: false,
      error: "Only user messages can be edited",
      code: IPC_ERROR_CODES.VALIDATION_ERROR,
    });
    expect(databaseMocks.updateUserChatMessageContent).not.toHaveBeenCalled();
    expect(bridgeMocks.send).not.toHaveBeenCalled();
  });

  it("branches a conversation through the selected message", async () => {
    databaseMocks.getChatMessageByConversation.mockResolvedValue({
      id: 13,
      conversation_id: 2,
      role: "assistant",
      content: "Use the reset clip.",
      created_at: "2026-04-18T12:03:00.000Z",
    });
    databaseMocks.createChatConversation.mockResolvedValue({
      id: 99,
      project_id: 1,
      chapter_id: 3,
      title: "Existing conversation (Branch)",
      provider: "gemini",
      thread_id: "thread-branch",
      created_at: "2026-04-18T12:10:00.000Z",
      updated_at: "2026-04-18T12:10:00.000Z",
    });

    const branchHandler = registeredHandlers.get(IPC_CHANNELS.AGENT_BRANCH_MESSAGE);
    const result = await branchHandler?.({}, {
      projectId: "1",
      conversationId: 2,
      messageId: 13,
    });

    expect(databaseMocks.createChatConversation).toHaveBeenCalledWith({
      project_id: 1,
      chapter_id: 3,
      title: "Existing conversation (Branch)",
      provider: "gemini",
      thread_id: expect.any(String),
    });
    expect(databaseMocks.cloneChatMessagesThrough).toHaveBeenCalledWith(2, 99, 13);
    expect(result).toMatchObject({
      success: true,
      data: {
        id: 99,
        title: "Existing conversation (Branch)",
      },
    });
  });
});
