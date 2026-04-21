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
  import Icon from './ui/Icon.svelte';
  import { Check, X } from '../constants';
  
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
  
  <div class="chat-messages scrollbar-thin" bind:this={chatContainer}>
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
    <div class="suggestions-panel scrollbar-thin">
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
                  <Icon icon={Check} size={14} /> Apply
                </button>
                <button
                  class="reject-btn"
                  onclick={() => handleRejectSuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                >
                  <Icon icon={X} size={14} /> Reject
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
    background: var(--surface-raised);
    border-left: 1px solid var(--border-default);
    min-height: 0;
  }
  
  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-elevated);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .chat-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
  }
  
  .provider-select {
    padding: var(--space-1) var(--space-2);
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .collapse-btn {
    padding: var(--space-1) var(--space-2);
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
  }

  .collapse-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }

  .conversation-toolbar {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-raised);
  }

  .conversation-select {
    flex: 1;
    padding: 6px var(--space-2);
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .toolbar-btn {
    padding: 6px 10px;
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: var(--surface-hover);
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
    color: var(--text-tertiary);
    margin-top: 40px;
  }
  
  .empty-state .hint {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    margin-top: var(--space-2);
  }
  
  .message {
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--surface-hover);
  }
  
  .message.user {
    background: var(--accent-primary);
  }
  
  .message-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: var(--space-1);
    font-size: var(--text-sm);
    opacity: 0.7;
  }
  
  .message-content {
    min-width: 0;
  }

  .message-live-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 6px 0 0;
    padding: 7px 10px;
    border-radius: var(--radius-pill);
    background: rgba(15, 23, 42, 0.36);
    color: #dbeafe;
    font-size: var(--text-sm);
  }

  .live-status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
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
    border-radius: var(--radius-md);
    background: rgba(15, 23, 42, 0.26);
  }

  .message-trace summary {
    cursor: pointer;
    padding: var(--space-2) 10px;
    font-size: var(--text-sm);
    color: #cbd5e1;
    user-select: none;
  }

  .thinking-content {
    padding: 0 10px 10px;
  }

  .thinking-section + .thinking-section {
    margin-top: var(--space-3);
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
    gap: var(--space-2);
  }

  .trace-entry {
    padding-top: var(--space-2);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .trace-entry:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .trace-label {
    font-size: var(--text-sm);
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
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-default);
    background: var(--surface-elevated);
  }
  
  .chat-input textarea {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--text-base);
    line-height: 1.4;
    min-height: 40px;
    max-height: 180px;
    resize: none;
    overflow-y: hidden;
    font-family: inherit;
  }
  
  .chat-input textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .chat-input button {
    padding: var(--space-2) var(--space-4);
    background: var(--accent-primary);
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--text-base);
    cursor: pointer;
    transition: background var(--transition-normal);
  }
  
  .chat-input button:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }
  
  .chat-input button:disabled {
    background: var(--surface-hover);
    cursor: not-allowed;
  }
  
  .suggestions-panel {
    border-top: 1px solid var(--border-default);
    background: var(--surface-elevated);
    max-height: 300px;
    overflow-y: auto;
  }
  
  .suggestions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-default);
  }

  .suggestions-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .suggestions-header h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--accent-success);
  }
  
  .toggle-btn {
    padding: var(--space-1) var(--space-2);
    background: var(--surface-hover);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    font-size: 11px;
    cursor: pointer;
  }
  
  .toggle-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .apply-all-btn {
    padding: var(--space-1) var(--space-2);
    background: #14532d;
    border: 1px solid #166534;
    border-radius: var(--radius-sm);
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
    padding: var(--space-3) var(--space-4);
  }
  
  .suggestion-card {
    background: var(--surface-hover);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-2);
  }
  
  .suggestion-time {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--accent-success);
    margin-bottom: var(--space-1);
  }
  
  .suggestion-description {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: var(--space-1);
  }
  
  .suggestion-reasoning {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-bottom: var(--space-2);
    line-height: 1.3;
  }

  .proposal-error {
    font-size: 11px;
    color: #fca5a5;
    margin-bottom: var(--space-2);
    line-height: 1.3;
  }
  
  .suggestion-actions {
    display: flex;
    gap: var(--space-2);
  }

  .preview-btn {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: #1e3a8a;
    color: #dbeafe;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--transition-normal);
  }

  .preview-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }
  
  .apply-btn, .reject-btn {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--transition-normal);
  }
  
  .apply-btn {
    background: var(--accent-success);
    color: #000;
  }
  
  .apply-btn:hover {
    background: var(--accent-success);
  }

  .preview-btn:disabled,
  .apply-btn:disabled,
  .reject-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  
  .reject-btn {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  
  .reject-btn:hover {
    background: #555;
  }
</style>
