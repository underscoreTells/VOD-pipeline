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
  getSuggestions: vi.fn(),
  rejectSuggestion: vi.fn(),
  applyAgentActions: vi.fn(),
  applySuggestionBatch: vi.fn(),
  rejectSuggestionBatch: vi.fn(),
  restoreSuggestionBatch: vi.fn(),
  revertSuggestionBatch: vi.fn(),
}));

const clipsApiMocks = vi.hoisted(() => ({
  getClipsByProject: vi.fn(),
}));

const timelineMocks = vi.hoisted(() => {
  const timelineState = {
    clips: [] as Array<{ id: number; start_time: number }>,
    selectedClipIds: new Set<number>(),
    playheadTime: 0,
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
vi.mock("../../src/renderer/lib/api/clips.js", () => clipsApiMocks);
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
    agentApiMocks.deleteAgentConversation.mockReset();
    agentApiMocks.getAgentGroundingStatus.mockReset();
    agentApiMocks.getAgentConversationMessages.mockReset();
    agentApiMocks.getSuggestions.mockReset();
    agentApiMocks.listAgentConversations.mockReset();
    agentApiMocks.rejectSuggestion.mockReset();
    agentApiMocks.applyAgentActions.mockReset();
    agentApiMocks.applySuggestionBatch.mockReset();
    agentApiMocks.rejectSuggestionBatch.mockReset();
    agentApiMocks.restoreSuggestionBatch.mockReset();
    agentApiMocks.revertSuggestionBatch.mockReset();
    clipsApiMocks.getClipsByProject.mockReset();
    timelineMocks.createClip.mockReset();
    timelineMocks.deleteClip.mockReset();
    timelineMocks.selectClip.mockReset();
    timelineMocks.setPlayhead.mockReset();
    timelineMocks.updateClip.mockReset();
    timelineMocks.timelineState.clips = [];
    clipsApiMocks.getClipsByProject.mockImplementation(async () => ({
      success: true,
      data: timelineMocks.timelineState.clips,
    }));

    agentApiMocks.rejectSuggestion.mockResolvedValue({
      success: true,
      data: {},
    });
    agentApiMocks.rejectSuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 2, total: 2, results: [] },
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
    const { chaptersState } = await import("../../src/renderer/lib/state/chapters.svelte.js");
    const { projectDetail } = await import("../../src/renderer/lib/state/project-media.svelte.js");
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
    chaptersState.chapters = [{
      id: 2,
      project_id: 1,
      title: "Chapter",
      start_time: 0,
      end_time: 100,
      display_order: 0,
      rough_cut_completed_at: null,
      created_at: "2026-04-18T12:00:00.000Z",
    }];
    chaptersState.selectedChapterId = 2;
    chaptersState.chapterAssets = new Map([[2, [11]]]);
    projectDetail.projectId = 1;
  });

  it("reviews pending suggestions as renderer-only ghosts without preview IPC", async () => {
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1),
      createSuggestion(2, { clip_id: 222 }),
      createSuggestion(3),
      createSuggestion(4),
    ];

    const { previewAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await previewAllSuggestions();

    expect(result).toMatchObject({
      success: true,
      total: 4,
      succeededIds: [1, 2, 3, 4],
      failedIds: [],
    });
    expect(agentState.suggestions[0]?.clip_id).toBeNull();
    expect(agentState.suggestions[1]?.clip_id).toBe(222);
    expect(agentState.suggestions[2]?.clip_id).toBeNull();
    expect(agentState.suggestions[3]?.clip_id).toBeNull();
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

    expect(agentApiMocks.rejectSuggestion).not.toHaveBeenCalled();
    expect(agentApiMocks.rejectSuggestionBatch).toHaveBeenCalledWith({ suggestionIds: [1, 2] });
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

  it("rejects a later action targeting a clip deleted earlier in the batch", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "delete_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ delete: true }),
      }),
      createSuggestion(2, {
        action_type: "update_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ update: { outPoint: 18 } }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({
      success: false,
      appliedCount: 0,
      total: 2,
      error: "A suggested cut targets a clip deleted earlier in this batch.",
    });
    expect(agentApiMocks.applySuggestionBatch).not.toHaveBeenCalled();
  });

  it("validates a split against an earlier update's simulated target window", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 2, total: 2, results: [] },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "update_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ update: { outPoint: 30 } }),
      }),
      createSuggestion(2, {
        action_type: "split_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 20 },
              { inPoint: 20, outPoint: 30 },
            ],
          },
        }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({
      success: true,
      appliedCount: 2,
      total: 2,
    });
    expect(agentApiMocks.applySuggestionBatch).toHaveBeenCalledWith({ suggestionIds: [1, 2] });
  });

  it("rejects a legacy split point at the target boundary", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [createSuggestion(1, {
      action_type: "split_clip",
      target_clip_id: targetClip.id,
      action_payload_json: JSON.stringify({ split: { splitPoint: 20 } }),
    })];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({
      success: false,
      error: "A split suggestion has no valid interior split point.",
    });
    expect(agentApiMocks.applySuggestionBatch).not.toHaveBeenCalled();
  });

  it("rejects split ranges that overlap a surviving clip after an earlier update", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [
      targetClip,
      { ...targetClip, id: 42, in_point: 25, out_point: 35, description: "Survivor" },
    ];
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "update_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ update: { outPoint: 30 } }),
      }),
      createSuggestion(2, {
        action_type: "split_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 20 },
              { inPoint: 20, outPoint: 30 },
            ],
          },
        }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({
      success: false,
      error: "Resolve the overlapping suggested cut before accepting it.",
    });
    expect(agentApiMocks.applySuggestionBatch).not.toHaveBeenCalled();
  });

  it("allows an overlapping update when its target is deleted later in the batch", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [
      targetClip,
      { ...targetClip, id: 42, in_point: 25, out_point: 35, description: "Survivor" },
    ];
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 2, total: 2, results: [] },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "update_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ update: { outPoint: 30 } }),
      }),
      createSuggestion(2, {
        action_type: "delete_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ delete: true }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({ success: true, appliedCount: 2, total: 2 });
    expect(agentApiMocks.applySuggestionBatch).toHaveBeenCalledWith({ suggestionIds: [1, 2] });
  });

  it("rejects a later action targeting a clip split earlier in the batch", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "split_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 15 },
              { inPoint: 15, outPoint: 20 },
            ],
          },
        }),
      }),
      createSuggestion(2, {
        action_type: "update_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({ update: { outPoint: 20 } }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({
      success: false,
      appliedCount: 0,
      total: 2,
      error: "A suggested cut targets a clip split earlier in this batch.",
    });
    expect(agentApiMocks.applySuggestionBatch).not.toHaveBeenCalled();
  });

  it("allows a later create in a gap removed by an earlier split", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 30,
      role: null,
      description: "Target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 2, total: 2, results: [] },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [
      createSuggestion(1, {
        action_type: "split_clip",
        target_clip_id: targetClip.id,
        action_payload_json: JSON.stringify({
          split: {
            segments: [
              { inPoint: 10, outPoint: 15 },
              { inPoint: 25, outPoint: 30 },
            ],
          },
        }),
      }),
      createSuggestion(2, {
        in_point: 15,
        out_point: 25,
        action_payload_json: JSON.stringify({ create: { assetId: 11 } }),
      }),
    ];

    const { applyAllSuggestions } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const result = await applyAllSuggestions();

    expect(result).toMatchObject({ success: true, appliedCount: 2, total: 2 });
    expect(agentApiMocks.applySuggestionBatch).toHaveBeenCalledWith({ suggestionIds: [1, 2] });
  });

  it("keeps a committed apply undoable when the post-commit timeline refresh fails", async () => {
    clipsApiMocks.getClipsByProject.mockRejectedValue(new Error("refresh unavailable"));
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 1, total: 1, results: [] },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [createSuggestion(1, {
      action_payload_json: JSON.stringify({ create: { assetId: 11 } }),
    })];

    const { applySuggestion } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const { canUndo, getLastCommandDescription } = await import("../../src/renderer/lib/state/undo-redo.svelte.js");
    const result = await applySuggestion(1);

    expect(result).toEqual({ success: true });
    expect(agentState.suggestions[0]?.status).toBe("applied");
    expect(canUndo()).toBe(true);
    expect(getLastCommandDescription()).toBe("Apply suggested cut");
  });

  it("reconciles deleted clips when the post-commit timeline refresh fails", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Deleted target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    timelineMocks.timelineState.clips = [targetClip];
    clipsApiMocks.getClipsByProject.mockRejectedValue(new Error("refresh unavailable"));
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: {
        appliedCount: 1,
        total: 1,
        results: [{ suggestionId: 1, success: true, removedClipIds: [targetClip.id] }],
      },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [createSuggestion(1, {
      action_type: "delete_clip",
      target_clip_id: targetClip.id,
    })];

    const { applySuggestion } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    expect(await applySuggestion(1)).toEqual({ success: true });

    expect(timelineMocks.timelineState.clips).toEqual([]);
  });

  it("reconciles every split segment when the post-commit timeline refresh fails", async () => {
    const targetClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 30,
      role: null,
      description: "Split target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    const firstSegment = { ...targetClip, out_point: 15 };
    const secondSegment = { ...targetClip, id: 42, in_point: 25 };
    timelineMocks.timelineState.clips = [targetClip];
    clipsApiMocks.getClipsByProject.mockRejectedValue(new Error("refresh unavailable"));
    agentApiMocks.applySuggestionBatch.mockResolvedValue({
      success: true,
      data: {
        appliedCount: 1,
        total: 1,
        results: [{
          suggestionId: 1,
          success: true,
          clip: firstSegment,
          clips: [firstSegment, secondSegment],
        }],
      },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [createSuggestion(1, {
      action_type: "split_clip",
      target_clip_id: targetClip.id,
      action_payload_json: JSON.stringify({
        split: {
          segments: [
            { inPoint: 10, outPoint: 15 },
            { inPoint: 25, outPoint: 30 },
          ],
        },
      }),
    })];

    const { applySuggestion } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    expect(await applySuggestion(1)).toEqual({ success: true });

    expect(timelineMocks.timelineState.clips).toEqual([firstSegment, secondSegment]);
  });

  it("restores a recreated inherited target to the timeline when undoing rejection", async () => {
    const restoredClip = {
      id: 41,
      project_id: 1,
      asset_id: 11,
      track_index: 0,
      in_point: 10,
      out_point: 20,
      role: null,
      description: "Restored target",
      is_essential: true,
      created_at: "2026-04-18T12:00:00.000Z",
    };
    agentApiMocks.rejectSuggestionBatch.mockResolvedValue({
      success: true,
      data: { appliedCount: 1, total: 1, results: [{ suggestionId: 1, success: true }] },
    });
    agentApiMocks.restoreSuggestionBatch.mockResolvedValue({
      success: true,
      data: {
        appliedCount: 1,
        total: 1,
        results: [{ suggestionId: 1, success: true, clip: restoredClip }],
      },
    });
    const { agentState } = await import("../../src/renderer/lib/state/agent-session.svelte.js");
    agentState.suggestions = [createSuggestion(1, {
      action_type: "update_clip",
      target_clip_id: restoredClip.id,
    })];

    const { rejectSuggestion } = await import("../../src/renderer/lib/state/agent-proposals.svelte.js");
    const { undo } = await import("../../src/renderer/lib/state/undo-redo.svelte.js");
    expect(await rejectSuggestion(1)).toBe(true);
    timelineMocks.timelineState.clips = [];

    expect(await undo()).toBe(true);
    expect(timelineMocks.timelineState.clips).toContainEqual(restoredClip);
    expect(agentState.suggestions[0]?.status).toBe("pending");
  });
});
