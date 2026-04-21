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
    background: var(--surface-base);
    border-left: 1px solid var(--border-default);
    min-height: 0;
  }

  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .chat-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }
  
  .provider-select {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .provider-select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .collapse-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .collapse-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
  }

  .conversation-toolbar {
    display: flex;
    gap: var(--space-2);
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .conversation-select {
    flex: 1;
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    color: var(--text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .conversation-select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .toolbar-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .toolbar-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn.danger {
    border-color: var(--border-default);
    color: var(--accent-destructive);
  }

  .toolbar-btn.danger:hover:not(:disabled) {
    background: var(--accent-destructive);
    color: #ffffff;
    border-color: var(--accent-destructive);
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
    padding: var(--space-2) 0;
  }

  .message.user {
    border-left: 2px solid var(--accent-primary);
    padding-left: var(--space-3);
    margin-left: calc(-1 * var(--space-3));
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-weight: var(--weight-medium);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .message-content {
    min-width: 0;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .message.user .message-content {
    color: var(--text-primary);
  }

  .message-live-status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 6px 0 0;
    padding: 4px 8px;
    border-radius: var(--radius-xs);
    background: var(--surface-hover);
    color: var(--accent-primary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .live-status-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-primary);
    animation: live-status-pulse 1.2s ease-in-out infinite;
    flex: 0 0 auto;
  }

  .live-status-label {
    font-weight: var(--weight-medium);
  }

  .live-status-meta {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }

  @keyframes live-status-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }

    50% {
      opacity: 0.5;
      transform: scale(0.9);
    }
  }

  .message-trace {
    margin-top: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    background: var(--surface-raised);
  }

  .message-trace summary {
    cursor: pointer;
    padding: 6px 10px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    user-select: none;
    font-weight: var(--weight-medium);
  }

  .thinking-content {
    padding: 0 10px 10px;
  }

  .thinking-section + .thinking-section {
    margin-top: var(--space-3);
  }

  .thinking-label {
    margin-bottom: 4px;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .trace-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .trace-entry {
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-subtle);
  }

  .trace-entry:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .trace-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .trace-meta {
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .thinking-markdown :global(.markdown-content) {
    font-size: var(--text-sm);
  }
  
  .chat-input {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .chat-input textarea {
    flex: 1;
    padding: 10px 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--text-base);
    line-height: 1.4;
    min-height: 40px;
    max-height: 180px;
    resize: none;
    overflow-y: hidden;
    font-family: inherit;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .chat-input textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary);
  }

  .chat-input textarea::placeholder {
    color: var(--text-tertiary);
  }

  .chat-input button {
    padding: 10px 16px;
    background: var(--accent-primary);
    border: none;
    border-radius: var(--radius-md);
    color: #ffffff;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background var(--transition-normal);
    flex-shrink: 0;
  }

  .chat-input button:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }

  .chat-input button:disabled {
    background: var(--surface-hover);
    color: var(--text-tertiary);
    cursor: not-allowed;
  }
  
  .suggestions-panel {
    border-top: 1px solid var(--border-default);
    background: var(--surface-base);
    max-height: 300px;
    overflow-y: auto;
  }

  .suggestions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .suggestions-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .suggestions-header h4 {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .toggle-btn {
    padding: 4px 8px;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .toggle-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  .apply-all-btn {
    padding: 4px 8px;
    background: var(--accent-success);
    border: 1px solid var(--accent-success);
    border-radius: var(--radius-xs);
    color: #ffffff;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .apply-all-btn:hover:not(:disabled) {
    background: var(--accent-success);
    opacity: 0.9;
  }

  .apply-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .suggestions-list {
    padding: 0;
  }

  .suggestion-card {
    background: transparent;
    border-bottom: 1px solid var(--border-subtle);
    padding: var(--space-3) var(--space-4);
    transition: background var(--transition-fast);
  }

  .suggestion-card:last-child {
    border-bottom: none;
  }

  .suggestion-card:hover {
    background: var(--surface-hover);
  }

  .suggestion-time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-success);
    margin-bottom: 4px;
  }

  .suggestion-description {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    margin-bottom: 4px;
    line-height: 1.4;
  }

  .suggestion-reasoning {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-bottom: var(--space-2);
    line-height: 1.3;
  }

  .proposal-error {
    font-size: var(--text-xs);
    color: var(--accent-destructive);
    margin-bottom: var(--space-2);
    line-height: 1.3;
  }

  .suggestion-actions {
    display: flex;
    gap: var(--space-2);
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .suggestion-card:hover .suggestion-actions {
    opacity: 1;
  }

  .preview-btn {
    padding: 4px 10px;
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--accent-primary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .preview-btn:hover:not(:disabled) {
    background: var(--accent-primary);
    color: #ffffff;
  }

  .apply-btn, .reject-btn {
    padding: 4px 10px;
    border: none;
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .apply-btn {
    background: var(--accent-success);
    color: #ffffff;
  }

  .apply-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .preview-btn:disabled,
  .apply-btn:disabled,
  .reject-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .reject-btn {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
  }

  .reject-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
</style>
