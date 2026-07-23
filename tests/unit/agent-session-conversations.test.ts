import { describe, expect, it } from "vitest";
import type { ChatConversation } from "../../src/shared/types/database.js";
import {
  resolveConversationSelection,
  resolveChatModelConfiguration,
  setProviderReasoningEffort,
  shouldChangeChapterContext,
  sortChatConversations,
} from "../../src/renderer/lib/state/agent-session-helpers.js";

function createConversation(
  id: number,
  updatedAt: string
): ChatConversation {
  return {
    id,
    project_id: 1,
    chapter_id: 101,
    title: `Conversation ${id}`,
    provider: "gemini",
    thread_id: `thread-${id}`,
    created_at: "2026-04-17T10:00:00.000Z",
    updated_at: updatedAt,
  };
}

describe("agent session conversation helpers", () => {
  it("sorts conversations by newest update first", () => {
    const sorted = sortChatConversations([
      createConversation(1, "2026-04-17T10:00:00.000Z"),
      createConversation(2, "2026-04-17T12:00:00.000Z"),
      createConversation(3, "2026-04-17T11:00:00.000Z"),
    ]);

    expect(sorted.map((conversation) => conversation.id)).toEqual([2, 3, 1]);
  });

  it("preserves the selected older conversation when asked", () => {
    const state = resolveConversationSelection(
      [
        createConversation(1, "2026-04-17T12:00:00.000Z"),
        createConversation(2, "2026-04-17T11:00:00.000Z"),
      ],
      {
        autoCreateIfEmpty: false,
        hasLoadedMessages: true,
        preserveSelection: true,
        selectedConversationId: 2,
      }
    );

    expect(state.sortedConversations.map((conversation) => conversation.id)).toEqual([1, 2]);
    expect(state.targetConversationId).toBe(2);
    expect(state.shouldReloadMessages).toBe(false);
  });

  it("falls back to the newest conversation when the selected one is gone", () => {
    const state = resolveConversationSelection(
      [
        createConversation(1, "2026-04-17T12:00:00.000Z"),
        createConversation(2, "2026-04-17T11:00:00.000Z"),
      ],
      {
        autoCreateIfEmpty: false,
        hasLoadedMessages: true,
        preserveSelection: true,
        selectedConversationId: 99,
      }
    );

    expect(state.targetConversationId).toBe(1);
    expect(state.shouldReloadMessages).toBe(true);
  });

  it("clears selection for empty chapters without creating a placeholder conversation", () => {
    const state = resolveConversationSelection([], {
      hasLoadedMessages: false,
      preserveSelection: true,
      selectedConversationId: null,
    });

    expect(state.shouldClearMessages).toBe(true);
    expect(state.targetConversationId).toBeNull();
    expect(state.shouldReloadMessages).toBe(false);
  });

  it("treats repeated chapter selection as a no-op", () => {
    expect(shouldChangeChapterContext("123", "123")).toBe(false);
    expect(shouldChangeChapterContext("123", "456")).toBe(true);
    expect(shouldChangeChapterContext("123", null)).toBe(true);
  });

  it("keeps a conversation's configured chat model and reasoning effort", () => {
    const conversation = {
      ...createConversation(1, "2026-04-17T12:00:00.000Z"),
      provider: "kimi" as const,
      model: "kimi-k2.6",
      reasoning_effort: "high" as const,
    };

    expect(resolveChatModelConfiguration({
      conversation,
      configuredProviders: ["gemini", "kimi"],
      defaultProvider: "gemini",
      providerModels: {},
      providerReasoningEfforts: {},
    })).toEqual({
      provider: "kimi",
      model: "kimi-k2.6",
      reasoningEffort: "high",
    });
  });

  it("keeps a configured text-only conversation provider", () => {
    const conversation = {
      ...createConversation(1, "2026-04-17T12:00:00.000Z"),
      provider: "openai" as const,
      model: "gpt-5.6-terra",
      reasoning_effort: "high" as const,
    };

    expect(resolveChatModelConfiguration({
      conversation,
      configuredProviders: ["gemini", "openai", "kimi"],
      defaultProvider: "kimi",
      providerModels: { kimi: "kimi-k2.7-code" },
      providerReasoningEfforts: { kimi: "low" },
    })).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });

  it("keeps configured custom chat models", () => {
    expect(resolveChatModelConfiguration({
      configuredProviders: ["openaiCompatible"],
      defaultProvider: "openaiCompatible",
      providerModels: { openaiCompatible: "local-custom-model" },
      providerReasoningEfforts: {},
    })).toEqual({
      provider: "openaiCompatible",
      model: "local-custom-model",
      reasoningEffort: null,
    });
  });

  it("removes a provider's stale reasoning effort when none is selected", () => {
    expect(setProviderReasoningEffort(
      { openai: "high", kimiCode: "medium" },
      "openai",
      null
    )).toEqual({ kimiCode: "medium" });
  });
});
