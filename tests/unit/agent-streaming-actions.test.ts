import { beforeEach, describe, expect, it, vi } from "vitest";

const agentApiMocks = vi.hoisted(() => ({
  agentChat: vi.fn(),
  branchAgentMessage: vi.fn(),
  cancelAgentTurn: vi.fn(),
  createAgentConversation: vi.fn(),
  deleteAgentConversation: vi.fn(),
  editAgentMessage: vi.fn(),
  getAgentGroundingStatus: vi.fn(),
  getAgentConversationMessages: vi.fn(),
  getSuggestions: vi.fn(),
  listAgentConversations: vi.fn(),
  onAgentError: vi.fn(),
  onAgentStream: vi.fn(),
  rerollAgentMessage: vi.fn(),
}));

const proposalMocks = vi.hoisted(() => ({
  loadSuggestions: vi.fn(),
}));

const timelineMocks = vi.hoisted(() => ({
  timelineState: {
    selectedClipIds: new Set<number>(),
    playheadTime: 0,
  },
}));

const settingsMocks = vi.hoisted(() => ({
  settingsState: {
    settings: {
      geminiApiKey: "AIza-test",
      openaiApiKey: "",
      anthropicApiKey: "",
      kimiApiKey: "",
      openrouterApiKey: "",
      defaultVideoProvider: "gemini",
      defaultTextProvider: "openai",
      autoGenerateProxies: true,
      proxyGenerationOnImport: true,
      proxyEncodingMode: "auto",
      proxyQuality: "balanced",
      autoChapterNamingEnabled: true,
      autoChapterNamingModel: "gpt-5-nano",
      autoClipNamingEnabled: true,
      autoClipNamingModel: "gpt-5-nano",
      autoThreadNamingModel: "gpt-5-nano",
      autoTranscribeOnImport: true,
    },
  },
}));

vi.mock("../../src/renderer/lib/api/agent.js", () => agentApiMocks);
vi.mock("../../src/renderer/lib/state/agent-proposals.svelte.js", () => proposalMocks);
vi.mock("../../src/renderer/lib/state/timeline.svelte.js", () => timelineMocks);
vi.mock("../../src/renderer/lib/state/settings.svelte.js", () => settingsMocks);

function createConversation(title = "Conversation 2") {
  return {
    id: 2,
    project_id: 1,
    chapter_id: 3,
    title,
    provider: "gemini" as const,
    thread_id: "thread-1",
    created_at: "2026-04-18T12:00:00.000Z",
    updated_at: "2026-04-18T12:00:00.000Z",
  };
}

function createMessage(id: number, role: "user" | "assistant", content: string, createdAt: string) {
  return {
    role,
    content,
    thinkingMarkdown: null,
    trace: [],
    id: `db-${id}`,
    databaseId: id,
    timestamp: new Date(createdAt),
  };
}

describe("agent streaming message actions", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(agentApiMocks).forEach((mock) => mock.mockReset());
    Object.values(proposalMocks).forEach((mock) => mock.mockReset());

    timelineMocks.timelineState.selectedClipIds = new Set<number>([7, 8]);
    timelineMocks.timelineState.playheadTime = 42;

    agentApiMocks.onAgentStream.mockReturnValue(() => {});
    agentApiMocks.onAgentError.mockReturnValue(() => {});
    agentApiMocks.listAgentConversations.mockResolvedValue({
      success: true,
      data: [createConversation()],
    });
    agentApiMocks.getSuggestions.mockResolvedValue({
      success: true,
      data: [],
    });
    agentApiMocks.getAgentGroundingStatus.mockResolvedValue({
      success: true,
      data: {
        status: "ready",
        requiredVideoAssetCount: 1,
        readyVideoAssetCount: 1,
        assets: [{ assetId: 11, status: "ready" }],
        message: "Video grounding is ready.",
      },
    });
    agentApiMocks.getAgentConversationMessages.mockResolvedValue({
      success: true,
      data: [],
    });
  });

  it("reconciles optimistic send messages to persisted database ids", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const { sendChatMessage } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation("New conversation")];
    agentState.messages = [];
    agentState.suggestions = [];
    agentState.isStreaming = false;
    agentState.groundingStatus = "ready";
    agentState.groundingMessage = "Video grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 1;
    agentState.groundingReadyVideoAssetCount = 1;
    agentState.groundingErrorDetail = null;
    agentState.error = null;

    agentApiMocks.agentChat.mockResolvedValue({
      success: true,
      data: {
        message: "Persisted assistant response",
        userMessageId: 100,
        assistantMessageId: 101,
        userCreatedAt: "2026-04-18T12:00:00.000Z",
        assistantCreatedAt: "2026-04-18T12:00:05.000Z",
        suggestions: [],
      },
    });

    await sendChatMessage("Send this prompt");

    expect(agentState.messages).toHaveLength(2);
    expect(agentState.messages[0]).toMatchObject({
      id: "db-100",
      databaseId: 100,
      content: "Send this prompt",
    });
    expect(agentState.messages[1]).toMatchObject({
      id: "db-101",
      databaseId: 101,
      content: "Persisted assistant response",
    });
    expect(agentApiMocks.agentChat).toHaveBeenCalledWith(expect.objectContaining({
      proxyOptions: {
        encodingMode: "auto",
        quality: "balanced",
      },
    }));
  });

  it("reconciles edited history against persisted message metadata", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const { editMessage } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation()];
    agentState.messages = [
      createMessage(10, "user", "Setup", "2026-04-18T12:00:00.000Z"),
      createMessage(11, "assistant", "Keep the setup.", "2026-04-18T12:01:00.000Z"),
      createMessage(12, "user", "Find a softer payoff", "2026-04-18T12:02:00.000Z"),
      createMessage(13, "assistant", "Use the reset clip.", "2026-04-18T12:03:00.000Z"),
    ];
    agentState.suggestions = [];
    agentState.isStreaming = false;
    agentState.groundingStatus = "ready";
    agentState.groundingMessage = "Video grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 1;
    agentState.groundingReadyVideoAssetCount = 1;
    agentState.groundingErrorDetail = null;
    agentState.error = null;

    agentApiMocks.editAgentMessage.mockResolvedValue({
      success: true,
      data: {
        message: "Use the ladder payoff instead.",
        userMessageId: 12,
        assistantMessageId: 14,
        userCreatedAt: "2026-04-18T12:02:00.000Z",
        assistantCreatedAt: "2026-04-18T12:05:00.000Z",
        suggestions: [],
      },
    });

    await editMessage(agentState.messages[2], "Find a sharper payoff");

    expect(agentState.messages).toHaveLength(4);
    expect(agentState.messages[2]).toMatchObject({
      id: "db-12",
      databaseId: 12,
      content: "Find a sharper payoff",
    });
    expect(agentState.messages[3]).toMatchObject({
      id: "db-14",
      databaseId: 14,
      content: "Use the ladder payoff instead.",
    });
    expect(agentApiMocks.editAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      proxyOptions: {
        encodingMode: "auto",
        quality: "balanced",
      },
    }));
    expect(proposalMocks.loadSuggestions).toHaveBeenCalledWith("3", 2);
  });

  it("reconciles rerolled assistant messages onto the retained user anchor", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const { rerollMessage } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation()];
    agentState.messages = [
      createMessage(10, "user", "Setup", "2026-04-18T12:00:00.000Z"),
      createMessage(11, "assistant", "Keep the setup.", "2026-04-18T12:01:00.000Z"),
      createMessage(12, "user", "Find a sharper payoff", "2026-04-18T12:02:00.000Z"),
      createMessage(13, "assistant", "Use the reset clip.", "2026-04-18T12:03:00.000Z"),
    ];
    agentState.suggestions = [];
    agentState.isStreaming = false;
    agentState.groundingStatus = "ready";
    agentState.groundingMessage = "Video grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 1;
    agentState.groundingReadyVideoAssetCount = 1;
    agentState.groundingErrorDetail = null;
    agentState.error = null;

    agentApiMocks.rerollAgentMessage.mockResolvedValue({
      success: true,
      data: {
        message: "Land on the ladder payoff.",
        userMessageId: 12,
        assistantMessageId: 15,
        userCreatedAt: "2026-04-18T12:02:00.000Z",
        assistantCreatedAt: "2026-04-18T12:05:30.000Z",
        suggestions: [],
      },
    });

    await rerollMessage(agentState.messages[3]);

    expect(agentState.messages).toHaveLength(4);
    expect(agentState.messages[2]).toMatchObject({
      id: "db-12",
      databaseId: 12,
      content: "Find a sharper payoff",
    });
    expect(agentState.messages[3]).toMatchObject({
      id: "db-15",
      databaseId: 15,
      content: "Land on the ladder payoff.",
    });
    expect(agentApiMocks.rerollAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      proxyOptions: {
        encodingMode: "auto",
        quality: "balanced",
      },
    }));
    expect(proposalMocks.loadSuggestions).toHaveBeenCalledWith("3", 2);
  });

  it("allows transcript-grounded sends while video grounding is not ready", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const { sendChatMessage } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation()];
    agentState.messages = [
      createMessage(10, "user", "Setup", "2026-04-18T12:00:00.000Z"),
      createMessage(11, "assistant", "Keep the setup.", "2026-04-18T12:01:00.000Z"),
    ];
    agentState.isStreaming = false;
    agentState.groundingStatus = "generating";
    agentState.groundingMessage = "Video proxy is still preparing. Agent chat is locked until grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 1;
    agentState.groundingReadyVideoAssetCount = 0;
    agentState.groundingErrorDetail = null;
    agentState.error = "stale";
    agentApiMocks.agentChat.mockResolvedValue({
      success: true,
      data: {
        message: "Transcript-grounded response",
        userMessageId: 100,
        assistantMessageId: 101,
        userCreatedAt: "2026-04-18T12:04:00.000Z",
        assistantCreatedAt: "2026-04-18T12:04:05.000Z",
        suggestions: [],
      },
    });

    expect(await sendChatMessage("Try a new cut")).toBe(true);
    expect(agentState.error).toBeNull();
    expect(agentApiMocks.agentChat).toHaveBeenCalledTimes(1);
  });

  it("allows transcript-grounded sends while grounding status is loading", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const { sendChatMessage } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation()];
    agentState.messages = [];
    agentState.isStreaming = false;
    agentState.isGroundingStatusLoading = true;
    agentState.groundingStatus = "idle";
    agentState.error = "stale";
    agentApiMocks.agentChat.mockResolvedValue({
      success: true,
      data: {
        message: "Transcript-grounded response",
        userMessageId: 100,
        assistantMessageId: 101,
        userCreatedAt: "2026-04-18T12:04:00.000Z",
        assistantCreatedAt: "2026-04-18T12:04:05.000Z",
        suggestions: [],
      },
    });

    expect(await sendChatMessage("Try a new cut")).toBe(true);
    expect(agentState.error).toBeNull();
    expect(agentApiMocks.agentChat).toHaveBeenCalledTimes(1);
  });

  it("cancels an active send and reloads the persisted user message", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    const {
      cancelActiveAgentTurn,
      sendChatMessage,
    } = await import("../../src/renderer/lib/state/agent-streaming.svelte.js");

    agentState.currentProjectId = "1";
    agentState.currentChapterId = "3";
    agentState.selectedConversationId = 2;
    agentState.conversations = [createConversation()];
    agentState.messages = [];
    agentState.isStreaming = false;

    let settleTurn: ((value: { success: false; error: string }) => void) | null = null;
    agentApiMocks.agentChat.mockReturnValue(new Promise((resolve) => {
      settleTurn = resolve;
    }));
    agentApiMocks.cancelAgentTurn.mockImplementation(async () => {
      settleTurn?.({ success: false, error: "Agent request cancelled" });
      return { success: true, data: { cancelled: true } };
    });
    agentApiMocks.getAgentConversationMessages.mockResolvedValue({
      success: true,
      data: [{
        id: 100,
        conversation_id: 2,
        role: "user",
        content: "Try a new cut",
        created_at: "2026-04-18T12:04:00.000Z",
      }],
    });

    const sendResult = sendChatMessage("Try a new cut");
    await vi.waitFor(() => expect(agentState.activeTurn?.status).toBe("running"));
    const cancelResult = await cancelActiveAgentTurn();

    expect(cancelResult).toBe(true);
    expect(await sendResult).toBe(false);
    expect(agentApiMocks.cancelAgentTurn).toHaveBeenCalledTimes(1);
    expect(agentApiMocks.getAgentConversationMessages).toHaveBeenCalledWith(2);
    expect(agentState.messages).toEqual([
      expect.objectContaining({ databaseId: 100, content: "Try a new cut" }),
    ]);
    expect(agentState.activeTurn).toBeNull();
    expect(agentState.isStreaming).toBe(false);
    expect(agentState.error).toBeNull();
  });
});
