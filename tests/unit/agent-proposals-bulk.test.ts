import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "../../src/shared/types/database.js";

const agentApiMocks = vi.hoisted(() => ({
  createAgentConversation: vi.fn(),
  deleteAgentConversation: vi.fn(),
  getAgentGroundingStatus: vi.fn(),
  getAgentConversationMessages: vi.fn(),
  listAgentConversations: vi.fn(),
  applyAllSuggestions: vi.fn(),
  applySuggestion: vi.fn(),
  cancelSuggestionPreview: vi.fn(),
  getSuggestions: vi.fn(),
  previewSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  applyAgentActions: vi.fn(),
}));

const timelineMocks = vi.hoisted(() => {
  const timelineState = {
    clips: [] as Array<{ id: number; start_time: number }>,
  };

  return {
    timelineState,
    createClip: vi.fn((clip: { id: number; start_time: number }) => {
      timelineState.clips = [...timelineState.clips, clip];
    }),
    deleteClip: vi.fn((id: number) => {
      timelineState.clips = timelineState.clips.filter((clip) => clip.id !== id);
    }),
    selectClip: vi.fn(),
    setPlayhead: vi.fn(),
    updateClip: vi.fn((id: number, updates: { id: number; start_time: number }) => {
      timelineState.clips = timelineState.clips.map((clip) => (
        clip.id === id ? { ...clip, ...updates } : clip
      ));
    }),
  };
});

vi.mock("../../src/renderer/lib/api/agent.js", () => agentApiMocks);
vi.mock("../../src/renderer/lib/state/timeline.svelte", () => timelineMocks);

function createSuggestion(
  id: number,
  overrides: Partial<Suggestion> = {}
): Suggestion {
  return {
    id,
    chapter_id: 2,
    conversation_id: 12,
    chat_message_id: null,
    in_point: id * 10,
    out_point: id * 10 + 6,
    description: `Suggestion ${id}`,
    reasoning: `Reasoning ${id}`,
    provider: "gemini",
    action_type: "create_clip",
    target_clip_id: null,
    action_payload_json: null,
    preview_snapshot_json: null,
    status: "pending",
    display_order: id - 1,
    created_at: "2026-04-18T12:00:00.000Z",
    applied_at: null,
    clip_id: null,
    ...overrides,
  };
}

describe("agent proposal bulk actions", () => {
  beforeEach(async () => {
    vi.resetModules();
    agentApiMocks.applyAllSuggestions.mockReset();
    agentApiMocks.applySuggestion.mockReset();
    agentApiMocks.createAgentConversation.mockReset();
    agentApiMocks.cancelSuggestionPreview.mockReset();
    agentApiMocks.deleteAgentConversation.mockReset();
    agentApiMocks.getAgentGroundingStatus.mockReset();
    agentApiMocks.getAgentConversationMessages.mockReset();
    agentApiMocks.getSuggestions.mockReset();
    agentApiMocks.listAgentConversations.mockReset();
    agentApiMocks.previewSuggestion.mockReset();
    agentApiMocks.rejectSuggestion.mockReset();
    agentApiMocks.applyAgentActions.mockReset();
    timelineMocks.createClip.mockReset();
    timelineMocks.deleteClip.mockReset();
    timelineMocks.selectClip.mockReset();
    timelineMocks.setPlayhead.mockReset();
    timelineMocks.updateClip.mockReset();
    timelineMocks.timelineState.clips = [];

    agentApiMocks.previewSuggestion.mockImplementation(async (id: number) => ({
      success: true,
      data: {
        clip: {
          id: id + 1000,
          start_time: id * 5,
        },
      },
    }));
    agentApiMocks.rejectSuggestion.mockResolvedValue({
      success: true,
      data: {},
    });
    agentApiMocks.listAgentConversations.mockResolvedValue({
      success: true,
      data: [],
    });
    agentApiMocks.getAgentConversationMessages.mockResolvedValue({
      success: true,
      data: [],
    });
    agentApiMocks.createAgentConversation.mockResolvedValue({
      success: true,
      data: null,
    });
    agentApiMocks.deleteAgentConversation.mockResolvedValue({
      success: true,
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

    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.currentProjectId = "1";
    agentState.currentChapterId = "2";
    agentState.selectedConversationId = 12;
    agentState.suggestions = [];
    agentState.timelineProposals = [];
    agentState.groundingStatus = "ready";
    agentState.groundingMessage = "Video grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 1;
    agentState.groundingReadyVideoAssetCount = 1;
    agentState.groundingErrorDetail = null;
    agentState.error = null;
  });

  it("previews only pending suggestions that do not already have a preview clip and continues after failures", async () => {
    agentApiMocks.previewSuggestion
      .mockResolvedValueOnce({
        success: true,
        data: {
          clip: {
            id: 1001,
            start_time: 5,
          },
        },
      })
      .mockResolvedValueOnce({
        success: false,
        error: "preview failed",
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          clip: {
            id: 1003,
            start_time: 15,
          },
        },
      });

    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1),
      createSuggestion(2, { clip_id: 222 }),
      createSuggestion(3),
      createSuggestion(4),
    ];

    const { previewAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await previewAllSuggestions();

    expect(agentApiMocks.previewSuggestion).toHaveBeenCalledTimes(3);
    expect(agentApiMocks.previewSuggestion).toHaveBeenNthCalledWith(1, 1);
    expect(agentApiMocks.previewSuggestion).toHaveBeenNthCalledWith(2, 3);
    expect(agentApiMocks.previewSuggestion).toHaveBeenNthCalledWith(3, 4);
    expect(result).toMatchObject({
      success: false,
      total: 3,
      succeededIds: [1, 4],
      failedIds: [3],
      error: "Failed to preview some suggestions",
    });
    expect(agentState.suggestions[0]?.clip_id).toBe(1001);
    expect(agentState.suggestions[1]?.clip_id).toBe(222);
    expect(agentState.suggestions[2]?.clip_id).toBeNull();
    expect(agentState.suggestions[3]?.clip_id).toBe(1003);
  });

  it("rejects every pending suggestion, including previewed ones", async () => {
    agentApiMocks.rejectSuggestion
      .mockResolvedValueOnce({
        success: true,
        data: {},
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          removedClipId: 2202,
        },
      });

    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1),
      createSuggestion(2, { clip_id: 2202 }),
      createSuggestion(3, { status: "rejected" }),
    ];

    const { rejectAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await rejectAllSuggestions();

    expect(agentApiMocks.rejectSuggestion).toHaveBeenCalledTimes(2);
    expect(agentApiMocks.rejectSuggestion).toHaveBeenNthCalledWith(1, 1);
    expect(agentApiMocks.rejectSuggestion).toHaveBeenNthCalledWith(2, 2);
    expect(result).toMatchObject({
      success: true,
      total: 2,
      succeededIds: [1, 2],
      failedIds: [],
    });
    expect(agentState.suggestions[0]?.status).toBe("rejected");
    expect(agentState.suggestions[1]?.status).toBe("rejected");
    expect(agentState.suggestions[1]?.clip_id).toBeNull();
  });
});
