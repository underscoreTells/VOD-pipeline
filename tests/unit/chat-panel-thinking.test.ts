import { render } from "svelte/server";
import { afterEach, describe, expect, it } from "vitest";
import ChatPanel from "../../src/renderer/lib/components/ChatPanel.svelte";
import { agentState } from "../../src/renderer/lib/state/agent.svelte.js";

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

describe("chat panel thinking disclosure", () => {
  afterEach(() => {
    resetAgentState();
  });

  it("renders final answer in the bubble and detailed reasoning inside the thinking disclosure", () => {
    resetAgentState();
    agentState.conversations = [
      {
        id: 12,
        project_id: 1,
        chapter_id: 2,
        title: "Conversation 12",
        provider: "gemini",
        thread_id: "thread-12",
        created_at: "2026-04-18T12:00:00.000Z",
        updated_at: "2026-04-18T12:00:00.000Z",
      },
    ];
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
    agentState.conversations = [
      {
        id: 12,
        project_id: 1,
        chapter_id: 2,
        title: "Conversation 12",
        provider: "gemini",
        thread_id: "thread-12",
        created_at: "2026-04-18T12:00:00.000Z",
        updated_at: "2026-04-18T12:00:00.000Z",
      },
    ];
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
});
