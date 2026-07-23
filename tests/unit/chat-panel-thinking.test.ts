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
  agentState.isGroundingStatusLoading = false;
  agentState.groundingStatus = "ready";
  agentState.groundingMessage = "Video grounding is ready.";
  agentState.groundingRequiredVideoAssetCount = 1;
  agentState.groundingReadyVideoAssetCount = 1;
  agentState.groundingErrorDetail = null;
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

  it("shows chapter-selection guidance and hides the composer when no chapter is selected", () => {
    resetAgentState();
    agentState.currentChapterId = null;

    const { body } = render(ChatPanel);

    expect(body).toContain("Select a chapter before chatting");
    expect(body).toContain("Choose a chapter from the left sidebar to start a conversation with the AI editor.");
    expect(body).not.toContain("Ask the AI editor...");
    expect(body).not.toContain('title="Send message"');
  });

  it("renders the composer when a chapter is selected", () => {
    resetAgentState();

    const { body } = render(ChatPanel);

    expect(body).toContain("Ask the AI editor about this chapter...");
    expect(body).toContain('title="Send message"');
  });

  it("keeps chat available while video proxies are generating", () => {
    resetAgentState();
    agentState.groundingStatus = "generating";
    agentState.groundingMessage = "Video proxy is still preparing. Agent chat is locked until grounding is ready.";
    agentState.groundingRequiredVideoAssetCount = 2;
    agentState.groundingReadyVideoAssetCount = 1;

    const { body } = render(ChatPanel);

    expect(body).toContain("Video proxy is still preparing");
    expect(body).toContain("You can chat now. Requests that require visuals may use transcript evidence until the proxy is ready.");
    expect(body).toContain("1/2 video assets ready");
    expect(body).toContain("Ask the AI editor about this chapter...");

    const composerMatch = body.match(/<div[^>]*contenteditable="true"[^>]*role="textbox"[^>]*aria-label="Message the AI editor"[^>]*>/);
    expect(composerMatch?.[0]).toBeDefined();
    expect(composerMatch?.[0]).not.toContain('aria-disabled="true"');

    const sendButtonMatch = body.match(/<button[^>]*title="Send message"[^>]*>/);
    expect(sendButtonMatch?.[0]).toContain("disabled");
  });

  it("shows a grounding check banner while status is loading and keeps the composer editable", () => {
    resetAgentState();
    agentState.isGroundingStatusLoading = true;
    agentState.groundingStatus = "idle";

    const { body } = render(ChatPanel);

    expect(body).toContain("Checking video grounding");
    expect(body).toContain("Transcript-grounded editing is available while video analysis is checked.");
    expect(body).not.toContain("video assets ready");
    expect(body).toContain("Ask the AI editor about this chapter...");

    const composerMatch = body.match(/<div[^>]*contenteditable="true"[^>]*role="textbox"[^>]*aria-label="Message the AI editor"[^>]*>/);
    expect(composerMatch?.[0]).toBeDefined();
    expect(composerMatch?.[0]).not.toContain('aria-disabled="true"');

    const sendButtonMatch = body.match(/<button[^>]*title="Send message"[^>]*>/);
    expect(sendButtonMatch?.[0]).toContain("disabled");
  });

  it("keeps transcript and timeline chat available when proxy generation fails", () => {
    resetAgentState();
    agentState.groundingStatus = "error";
    agentState.groundingMessage = "Video proxy failed to build. Agent chat is locked until grounding is available.";
    agentState.groundingErrorDetail = "ffmpeg exited with status 1";

    const { body } = render(ChatPanel);

    expect(body).toContain("Video proxy failed");
    expect(body).toContain("Visual analysis is unavailable, but transcript and timeline editing remain available.");
    expect(body).toContain("ffmpeg exited with status 1");
    expect(body).toContain("Ask the AI editor about this chapter...");

    const composerMatch = body.match(/<div[^>]*contenteditable="true"[^>]*role="textbox"[^>]*aria-label="Message the AI editor"[^>]*>/);
    expect(composerMatch?.[0]).toBeDefined();
    expect(composerMatch?.[0]).not.toContain('aria-disabled="true"');
  });

  it("renders the final answer without exposing raw reasoning or internal trace details", () => {
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
    expect(body).not.toContain("Thought for");
    expect(body).not.toContain("Thinking...");
    expect(body).not.toContain("The intro sets up the goal");
    expect(body).not.toContain("chat_node");
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
            stepIndex: 1,
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
    expect(body).toContain("Drafting cut suggestions…");
    expect(body).not.toContain("Step 1");
    expect(body).not.toContain("draftRoughCutProposals");
  });

  it("deduplicates completed tool events into a user-facing activity summary", () => {
    resetAgentState();
    agentState.conversations = [createConversation()];
    agentState.selectedConversationId = 12;
    agentState.messages = [
      {
        role: "assistant",
        content: "Final response.",
        thinkingMarkdown: null,
        trace: Array.from({ length: 20 }, (_, index) => {
          const stepIndex = Math.floor(index / 5) + 1;
          return {
            id: `trace-${index + 1}`,
            status: index % 5 === 0 ? "processing_chat" : "tool_completed",
            label:
              index % 5 === 0
                ? `Working on turn step ${stepIndex}...`
                : `Tool event ${index + 1}`,
            nodeName: index % 5 === 0 ? "conversation_runner" : "draftRoughCutProposals",
            stepIndex,
            createdAt: `2026-04-18T12:00:${String(index).padStart(2, "0")}.000Z`,
          };
        }),
        id: "assistant-steps",
        databaseId: 102,
        timestamp: new Date("2026-04-18T12:00:30.000Z"),
        isStreaming: false,
      },
    ];

    const { body } = render(ChatPanel);

    expect(body).toContain("Activity · 1 item");
    expect(body).toContain("Drafted rough-cut suggestions");
    expect(body).not.toContain("Tool event");
    expect(body).not.toContain("conversation_runner");
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
    expect(body).not.toContain('aria-label="Preview all suggestions"');
    expect(body).not.toContain('aria-label="Reject all suggestions"');
    expect(body).not.toContain('aria-label="Apply all suggestions"');
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

    expect(body).toContain('aria-label="Review suggested cuts on the timeline"');
    expect(body).toContain('aria-label="Reject all suggestions"');
    expect(body).toContain('aria-label="Apply all suggestions"');
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
