import { render } from "svelte/server";
import { afterEach, describe, expect, it } from "vitest";
import ChatPanel from "../../src/renderer/lib/components/ChatPanel.svelte";
import { agentState } from "../../src/renderer/lib/state/agent.svelte.js";
import type { Suggestion } from "../../src/shared/types/database.js";

function resetAgentState(): void {
  agentState.messages = [];
  agentState.conversations = [];
  agentState.selectedConversationId = null;
  agentState.isLoadingConversations = false;
  agentState.suggestions = [];
  agentState.timelineProposals = [];
  agentState.selectedProvider = "gemini";
  agentState.isStreaming = false;
  agentState.currentProjectId = "1";
  agentState.currentChapterId = "2";
  agentState.error = null;
}

function createConversation() {
  return {
    id: 12,
    project_id: 1,
    chapter_id: 2,
    title: "Conversation 12",
    provider: "gemini" as const,
    thread_id: "thread-12",
    created_at: "2026-04-18T12:00:00.000Z",
    updated_at: "2026-04-18T12:00:00.000Z",
  };
}

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
    out_point: id * 10 + 8,
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

describe("chat panel thinking disclosure", () => {
  afterEach(() => {
    resetAgentState();
  });

  it("renders final answer in the bubble and detailed reasoning inside the thinking disclosure", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.messages = [
      {
        role: "assistant",
        content: "Keep the intro and tighten the reset.",
        thinkingMarkdown: "## Reasoning\n\nThe intro sets up the goal, while the reset repeats the same beat.",
        trace: [
          {
            id: "trace-1",
            status: "processing_chat",
            label: "Thinking...",
            nodeName: "chat_node",
            passIndex: 1,
            createdAt: "2026-04-18T12:00:00.000Z",
          },
        ],
        id: "assistant-1",
        databaseId: 101,
        timestamp: new Date("2026-04-18T12:00:01.000Z"),
        isStreaming: false,
      },
    ];

    const { body } = render(ChatPanel);

    expect(body).toMatch(/message-content[\s\S]*?Keep the intro and tighten the reset\./);
    expect(body).toContain("Thought for 1 step");
    expect(body).toContain(">Thinking...</span>");
    expect(body).toMatch(/<h2>[\s\S]*Reasoning[\s\S]*<\/h2>/);
    expect(body).toMatch(/thinking-markdown[\s\S]*?The intro sets up the goal/);
    expect(body).not.toContain("message-live-status");
  });

  it("renders a visible live status row for streaming assistant drafts", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.messages = [
      {
        role: "assistant",
        content: "",
        thinkingMarkdown: null,
        trace: [
          {
            id: "trace-1",
            status: "tool_running",
            label: "Drafting rough-cut proposals...",
            nodeName: "draftRoughCutProposals",
            passIndex: 1,
            createdAt: "2026-04-18T12:00:00.000Z",
          },
        ],
        id: "assistant-1",
        databaseId: 101,
        timestamp: new Date("2026-04-18T12:00:01.000Z"),
        isStreaming: true,
      },
    ];

    const { body } = render(ChatPanel);

    expect(body).toContain("message-live-status");
    expect(body).toContain("Thinking (1)...");
    expect(body).toContain("Drafting rough-cut proposals...");
    expect(body).toContain("Pass 1 · draftRoughCutProposals");
  });

  it("omits the suggestions tray when no pending suggestions remain", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.suggestions = [
      createSuggestion(1, { status: "applied", clip_id: 101, applied_at: "2026-04-18T12:05:00.000Z" }),
      createSuggestion(2, { status: "rejected" }),
    ];

    const { body } = render(ChatPanel);

    expect(body).not.toContain("suggestions-wrapper");
    expect(body).not.toContain("Preview All");
    expect(body).not.toContain("Reject All");
    expect(body).not.toContain("Apply All");
  });

  it("renders bulk suggestion actions, sticky header markup, and resize handle for pending suggestions", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.messages = [
      {
        role: "user",
        content: "Can we tighten this chapter?",
        thinkingMarkdown: null,
        trace: [],
        id: "user-1",
        databaseId: 100,
        timestamp: new Date("2026-04-18T12:00:01.000Z"),
      },
    ];
    agentState.suggestions = [
      createSuggestion(1),
      createSuggestion(2, { clip_id: 202 }),
    ];

    const { body } = render(ChatPanel);

    expect(body).toContain("Preview all suggestions");
    expect(body).toContain("Reject all suggestions");
    expect(body).toContain("Apply all suggestions");
    expect(body).toContain("suggestions-resize-handle");
    expect(body).toContain("suggestions-header sticky top-0");
    expect(body).toContain("text-app-2xs");
  });

  it("renders bubble actions for visible messages and limits Edit to user bubbles", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.messages = [
      {
        role: "user",
        content: "Tighten the setup.",
        thinkingMarkdown: null,
        trace: [],
        id: "user-1",
        databaseId: 100,
        timestamp: new Date("2026-04-18T12:00:01.000Z"),
      },
      {
        role: "assistant",
        content: "I would trim the first reset loop.",
        thinkingMarkdown: null,
        trace: [],
        id: "assistant-1",
        databaseId: 101,
        timestamp: new Date("2026-04-18T12:00:02.000Z"),
      },
    ];

    const { body } = render(ChatPanel);

    expect(body.match(/aria-label="Reroll response"/g)).toHaveLength(2);
    expect(body.match(/aria-label="Copy message"/g)).toHaveLength(2);
    expect(body.match(/aria-label="Branch conversation"/g)).toHaveLength(2);
    expect(body.match(/aria-label="Edit message"/g)).toHaveLength(1);
  });
});
