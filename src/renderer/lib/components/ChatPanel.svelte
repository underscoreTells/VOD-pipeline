<script lang="ts">
  import {
    agentState,
    applyAllSuggestions,
    sendChatMessage,
    setProvider,
    createNewConversation,
    selectConversation,
    removeConversation,
    applySuggestion,
    previewSuggestion,
    cancelSuggestionPreviewAction,
    rejectSuggestion,
  } from "../state/agent.svelte";
  import { getVisibleStreamingStatusLabel } from "../state/agent-streaming-helpers.js";
  import MarkdownContent from "./MarkdownContent.svelte";
  import { collapseChat } from "../state/layout.svelte";
  
  let message = $state("");
  let chatContainer: HTMLDivElement;
  let messageInput: HTMLTextAreaElement | null = null;
  let showSuggestions = $state(true);
  let applyingAllSuggestionState = $state(false);
  let suggestionActionBusy = $state<Map<number, boolean>>(new Map());
  const MESSAGE_INPUT_MIN_HEIGHT = 40;
  const MESSAGE_INPUT_MAX_HEIGHT = 180;
  
  const providers = [
    { value: "gemini", label: "Gemini" },
    { value: "kimi", label: "Kimi K2.5" },
  ];
  
  function autoResizeMessageInput() {
    if (!messageInput) return;
    messageInput.style.height = 'auto';
    const nextHeight = Math.min(
      MESSAGE_INPUT_MAX_HEIGHT,
      Math.max(MESSAGE_INPUT_MIN_HEIGHT, messageInput.scrollHeight)
    );
    messageInput.style.height = `${nextHeight}px`;
    messageInput.style.overflowY = messageInput.scrollHeight > MESSAGE_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
  }

  $effect(() => {
    message;
    if (!messageInput) return;
    autoResizeMessageInput();
  });

  $effect(() => {
    const lastMessage = agentState.messages[agentState.messages.length - 1];
    const lastContent = lastMessage?.content ?? "";
    const lastThinking = lastMessage?.thinkingMarkdown ?? "";
    const lastTraceLength = lastMessage?.trace.length ?? 0;
    const lastStreaming = lastMessage?.isStreaming ?? false;
    void lastContent;
    void lastThinking;
    void lastTraceLength;
    void lastStreaming;

    if (!chatContainer || !lastMessage) return;

    queueMicrotask(() => {
      if (!chatContainer) return;
      chatContainer.scrollTop = chatContainer.scrollHeight;
    });
  });

  async function submitMessage() {
    if (!message.trim() || agentState.isStreaming) return;
    
    const msg = message;
    message = "";
    autoResizeMessageInput();
    await sendChatMessage(msg);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    await submitMessage();
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }
  
  function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  
  function formatDuration(start: number, end: number) {
    const format = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    return `${format(start)} - ${format(end)}`;
  }

  function formatSuggestionPrimaryLine(suggestion: { action_type?: string; target_clip_id?: number | null; in_point: number; out_point: number }) {
    if (suggestion.action_type === 'update_clip') {
      const clipLabel = suggestion.target_clip_id ? `Clip #${suggestion.target_clip_id}` : 'Target clip';
      return `${clipLabel} (${formatDuration(suggestion.in_point, suggestion.out_point)})`;
    }
    return formatDuration(suggestion.in_point, suggestion.out_point);
  }

  function formatTraceMeta(message: { nodeName?: string; passIndex?: number }) {
    const parts: string[] = [];
    if (typeof message.passIndex === "number") {
      parts.push(`Pass ${message.passIndex}`);
    }
    if (message.nodeName) {
      parts.push(message.nodeName);
    }
    return parts.join(" · ");
  }

  function hasThinkingDetails(message: { trace: unknown[]; thinkingMarkdown?: string | null }) {
    return message.trace.length > 0 || Boolean(message.thinkingMarkdown?.trim());
  }

  function getVisibleStreamingStatusMeta(message: {
    isStreaming?: boolean;
    trace: Array<{ nodeName?: string; passIndex?: number }>;
  }) {
    if (!message.isStreaming || message.trace.length === 0) {
      return null;
    }

    return formatTraceMeta(message.trace[message.trace.length - 1] ?? {});
  }

  async function handleCreateConversation() {
    await createNewConversation();
  }

  async function handleConversationChange(conversationId: string) {
    const parsed = Number(conversationId);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    await selectConversation(parsed);
  }

  async function handleDeleteConversation() {
    if (!agentState.selectedConversationId) return;
    await removeConversation(agentState.selectedConversationId);
  }
  
  async function handleApplySuggestion(id: number) {
    if (applyingAllSuggestionState || suggestionActionBusy.has(id)) return;
    suggestionActionBusy = new Map(suggestionActionBusy).set(id, true);
    try {
      await applySuggestion(id);
    } finally {
      const next = new Map(suggestionActionBusy);
      next.delete(id);
      suggestionActionBusy = next;
    }
  }

  async function handlePreviewSuggestion(id: number) {
    if (applyingAllSuggestionState || suggestionActionBusy.has(id)) return;
    suggestionActionBusy = new Map(suggestionActionBusy).set(id, true);
    try {
      await previewSuggestion(id);
    } finally {
      const next = new Map(suggestionActionBusy);
      next.delete(id);
      suggestionActionBusy = next;
    }
  }

  async function handleCancelSuggestionPreview(id: number) {
    if (applyingAllSuggestionState || suggestionActionBusy.has(id)) return;
    suggestionActionBusy = new Map(suggestionActionBusy).set(id, true);
    try {
      await cancelSuggestionPreviewAction(id);
    } finally {
      const next = new Map(suggestionActionBusy);
      next.delete(id);
      suggestionActionBusy = next;
    }
  }

  async function handleApplyAllSuggestions() {
    if (applyingAllSuggestionState) return;
    applyingAllSuggestionState = true;
    try {
      await applyAllSuggestions();
    } finally {
      applyingAllSuggestionState = false;
    }
  }
  
  async function handleRejectSuggestion(id: number) {
    if (applyingAllSuggestionState || suggestionActionBusy.has(id)) return;
    suggestionActionBusy = new Map(suggestionActionBusy).set(id, true);
    try {
      await rejectSuggestion(id);
    } finally {
      const next = new Map(suggestionActionBusy);
      next.delete(id);
      suggestionActionBusy = next;
    }
  }

</script>

<div class="chat-panel">
  <div class="chat-header">
    <h3>Chat</h3>
    <div class="header-actions">
      <select 
        value={agentState.selectedProvider}
        onchange={(e) => setProvider(e.currentTarget.value as any)}
        class="provider-select"
        disabled={agentState.isStreaming}
      >
        {#each providers as provider (provider.value)}
          <option value={provider.value}>{provider.label}</option>
        {/each}
      </select>
      <button class="collapse-btn" onclick={collapseChat}>
        Hide
      </button>
    </div>
  </div>

  <div class="conversation-toolbar">
    <select
      class="conversation-select"
      value={agentState.selectedConversationId ?? ""}
      onchange={(event) => handleConversationChange(event.currentTarget.value)}
      disabled={agentState.isStreaming || agentState.isLoadingConversations || agentState.conversations.length === 0}
    >
      {#if agentState.conversations.length === 0}
        <option value="">No conversations</option>
      {:else}
        {#each agentState.conversations as conversation (conversation.id)}
          <option value={conversation.id}>{conversation.title}</option>
        {/each}
      {/if}
    </select>
    <button class="toolbar-btn" onclick={handleCreateConversation} disabled={agentState.isStreaming}>New</button>
    <button
      class="toolbar-btn danger"
      onclick={handleDeleteConversation}
      disabled={!agentState.selectedConversationId || agentState.isStreaming}
    >
      Delete
    </button>
  </div>
  
  <div class="chat-messages" bind:this={chatContainer}>
    {#if !agentState.currentChapterId}
      <div class="empty-state">
        <p>Select a chapter to start chatting</p>
      </div>
    {:else if agentState.conversations.length === 0}
      <div class="empty-state">
        <p>No conversations yet for this chapter</p>
        <p class="hint">Click New or send a message to start one</p>
      </div>
    {:else if agentState.messages.length === 0}
      <div class="empty-state">
        <p>Start this conversation with the AI editor</p>
        <p class="hint">Try: "What should we keep?" or "Analyze this video"</p>
      </div>
    {:else}
      {#each agentState.messages as msg (msg.id)}
        <div class="message {msg.role}">
          <div class="message-header">
            <span class="role">{msg.role === "user" ? "You" : "AI"}</span>
            <span class="time">{formatTime(msg.timestamp)}</span>
          </div>
          {#if getVisibleStreamingStatusLabel(msg)}
            <div class="message-live-status" aria-live="polite">
              <span class="live-status-dot"></span>
              <span class="live-status-label">{getVisibleStreamingStatusLabel(msg)}</span>
              {#if getVisibleStreamingStatusMeta(msg)}
                <span class="live-status-meta">{getVisibleStreamingStatusMeta(msg)}</span>
              {/if}
            </div>
          {/if}
          {#if msg.content}
            <div class="message-content">
              <MarkdownContent content={msg.content} role={msg.role} />
            </div>
          {/if}
          {#if hasThinkingDetails(msg)}
            <details class="message-trace" open={Boolean(msg.isStreaming)}>
              <summary>Thinking{msg.trace.length > 0 ? ` (${msg.trace.length})` : ""}</summary>
              <div class="thinking-content">
                {#if msg.trace.length > 0}
                  <div class="thinking-section">
                    <div class="thinking-label">Steps</div>
                    <div class="trace-list">
                      {#each msg.trace as entry (entry.id)}
                        <div class="trace-entry">
                          <div class="trace-label">{entry.label}</div>
                          {#if formatTraceMeta(entry)}
                            <div class="trace-meta">{formatTraceMeta(entry)}</div>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if msg.thinkingMarkdown}
                  <div class="thinking-section">
                    <div class="thinking-label">Reasoning</div>
                    <div class="thinking-markdown">
                      <MarkdownContent content={msg.thinkingMarkdown} role="assistant" />
                    </div>
                  </div>
                {/if}
              </div>
            </details>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
  
  <!-- Suggestions Panel -->
  {#if agentState.suggestions.length > 0}
    <div class="suggestions-panel">
      <div class="suggestions-header">
        <h4>Suggestions ({agentState.suggestions.filter(s => s.status === 'pending').length} pending)</h4>
        <div class="suggestions-header-actions">
          <button
            class="apply-all-btn"
            onclick={handleApplyAllSuggestions}
            disabled={applyingAllSuggestionState || agentState.suggestions.filter(s => s.status === 'pending').length === 0}
          >
            {applyingAllSuggestionState ? 'Applying…' : 'Apply All'}
          </button>
          <button class="toggle-btn" onclick={() => showSuggestions = !showSuggestions}>
            {showSuggestions ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      
      {#if showSuggestions}
        <div class="suggestions-list">
          {#each agentState.suggestions.filter(s => s.status === 'pending') as suggestion (suggestion.id)}
            <div class="suggestion-card">
              <div class="suggestion-time">
                {formatSuggestionPrimaryLine(suggestion)}
              </div>
              <div class="suggestion-description">
                {suggestion.description || 'No description'}
              </div>
              <div class="suggestion-reasoning">
                {suggestion.reasoning || ''}
              </div>
              <div class="suggestion-actions">
                {#if suggestion.clip_id}
                  <button
                    class="preview-btn"
                    onclick={() => handleCancelSuggestionPreview(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Cancel Preview
                  </button>
                {:else}
                  <button
                    class="preview-btn"
                    onclick={() => handlePreviewSuggestion(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Preview
                  </button>
                {/if}
                <button
                  class="apply-btn"
                  onclick={() => handleApplySuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                >
                  ✓ Apply
                </button>
                <button
                  class="reject-btn"
                  onclick={() => handleRejectSuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <form class="chat-input" onsubmit={handleSubmit}>
    <textarea
      rows="1"
      bind:value={message}
      bind:this={messageInput}
      placeholder="Ask the AI editor..."
      disabled={agentState.isStreaming || !agentState.currentChapterId}
      oninput={autoResizeMessageInput}
      onkeydown={handleInputKeydown}
    ></textarea>
    <button type="submit" disabled={!message.trim() || agentState.isStreaming || !agentState.currentChapterId}>
      Send
    </button>
  </form>
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    border-left: 1px solid #333;
    min-height: 0;
  }
  
  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
    background: #252525;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .chat-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  
  .provider-select {
    padding: 4px 8px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
  }

  .collapse-btn {
    padding: 4px 8px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    cursor: pointer;
  }

  .collapse-btn:hover {
    background: #444;
    color: #fff;
  }
  
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .conversation-toolbar {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #333;
    background: #202020;
  }

  .conversation-select {
    flex: 1;
    padding: 6px 8px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
  }

  .toolbar-btn {
    padding: 6px 10px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ddd;
    font-size: 12px;
    cursor: pointer;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: #444;
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn.danger {
    border-color: #653030;
    color: #fca5a5;
  }
  
  .empty-state {
    text-align: center;
    color: #888;
    margin-top: 40px;
  }
  
  .empty-state .hint {
    font-size: 12px;
    color: #666;
    margin-top: 8px;
  }
  
  .message {
    margin-bottom: 16px;
    padding: 12px;
    border-radius: 8px;
    background: #2a2a2a;
  }
  
  .message.user {
    background: #2563eb;
  }
  
  .message-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: 12px;
    opacity: 0.7;
  }
  
  .message-content {
    min-width: 0;
  }

  .message-live-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 0;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.36);
    color: #dbeafe;
    font-size: 12px;
  }

  .live-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #60a5fa;
    box-shadow: 0 0 0 4px rgba(96, 165, 250, 0.16);
    animation: live-status-pulse 1.2s ease-in-out infinite;
    flex: 0 0 auto;
  }

  .live-status-label {
    font-weight: 600;
  }

  .live-status-meta {
    color: #94a3b8;
    font-size: 11px;
  }

  @keyframes live-status-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }

    50% {
      opacity: 0.72;
      transform: scale(0.92);
    }
  }

  .message-trace {
    margin-top: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.26);
  }

  .message-trace summary {
    cursor: pointer;
    padding: 8px 10px;
    font-size: 12px;
    color: #cbd5e1;
    user-select: none;
  }

  .thinking-content {
    padding: 0 10px 10px;
  }

  .thinking-section + .thinking-section {
    margin-top: 12px;
  }

  .thinking-label {
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #94a3b8;
  }

  .trace-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .trace-entry {
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .trace-entry:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .trace-label {
    font-size: 12px;
    color: #e2e8f0;
  }

  .trace-meta {
    margin-top: 2px;
    font-size: 11px;
    color: #94a3b8;
  }

  .thinking-markdown :global(.markdown-content) {
    font-size: 13px;
  }
  
  .chat-input {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #333;
    background: #252525;
  }
  
  .chat-input textarea {
    flex: 1;
    padding: 8px 12px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    line-height: 1.4;
    min-height: 40px;
    max-height: 180px;
    resize: none;
    overflow-y: hidden;
    font-family: inherit;
  }
  
  .chat-input textarea:focus {
    outline: none;
    border-color: #2563eb;
  }
  
  .chat-input button {
    padding: 8px 16px;
    background: #2563eb;
    border: none;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .chat-input button:hover:not(:disabled) {
    background: #1d4ed8;
  }
  
  .chat-input button:disabled {
    background: #444;
    cursor: not-allowed;
  }
  
  .suggestions-panel {
    border-top: 1px solid #333;
    background: #252525;
    max-height: 300px;
    overflow-y: auto;
  }
  
  .suggestions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
  }

  .suggestions-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .suggestions-header h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #4ade80;
  }
  
  .toggle-btn {
    padding: 4px 8px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #888;
    font-size: 11px;
    cursor: pointer;
  }
  
  .toggle-btn:hover {
    background: #444;
    color: #fff;
  }

  .apply-all-btn {
    padding: 4px 8px;
    background: #14532d;
    border: 1px solid #166534;
    border-radius: 4px;
    color: #dcfce7;
    font-size: 11px;
    cursor: pointer;
  }

  .apply-all-btn:hover:not(:disabled) {
    background: #166534;
  }

  .apply-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .suggestions-list {
    padding: 12px 16px;
  }
  
  .suggestion-card {
    background: #2a2a2a;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 8px;
  }
  
  .suggestion-time {
    font-family: monospace;
    font-size: 12px;
    color: #4ade80;
    margin-bottom: 4px;
  }
  
  .suggestion-description {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 4px;
  }
  
  .suggestion-reasoning {
    font-size: 11px;
    color: #888;
    margin-bottom: 8px;
    line-height: 1.3;
  }

  .proposal-error {
    font-size: 11px;
    color: #fca5a5;
    margin-bottom: 8px;
    line-height: 1.3;
  }
  
  .suggestion-actions {
    display: flex;
    gap: 8px;
  }

  .preview-btn {
    padding: 4px 12px;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    background: #1e3a8a;
    color: #dbeafe;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .preview-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }
  
  .apply-btn, .reject-btn {
    padding: 4px 12px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .apply-btn {
    background: #4ade80;
    color: #000;
  }
  
  .apply-btn:hover {
    background: #22c55e;
  }

  .preview-btn:disabled,
  .apply-btn:disabled,
  .reject-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  
  .reject-btn {
    background: #444;
    color: #fff;
  }
  
  .reject-btn:hover {
    background: #555;
  }
</style>
