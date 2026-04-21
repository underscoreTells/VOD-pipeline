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
  import { Check, X, ArrowUp, Plus, Trash2, ChevronDown, ChevronRight } from '../constants';

  let message = $state("");
  let chatContainer: HTMLDivElement;
  let messageInput: HTMLTextAreaElement | null = null;
  let showSuggestions = $state(true);
  let applyingAllSuggestionState = $state(false);
  let suggestionActionBusy = $state<Map<number, boolean>>(new Map());
  let showConversationDropdown = $state(false);

  const MESSAGE_INPUT_MIN_HEIGHT = 40;
  const MESSAGE_INPUT_MAX_HEIGHT = 180;

  const providers = [
    { value: "gemini", label: "Gemini" },
    { value: "kimi", label: "Kimi K2.5" },
  ];

  let currentConversation = $derived(
    agentState.conversations.find(c => c.id === agentState.selectedConversationId)
  );

  let pendingSuggestions = $derived(
    agentState.suggestions.filter(s => s.status === 'pending')
  );

  let conversationTitle = $derived(
    !agentState.currentChapterId
      ? 'Select a chapter'
      : agentState.conversations.length === 0
        ? 'No conversations'
        : currentConversation?.title || 'Select conversation'
  );

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

  $effect(() => {
    if (!showConversationDropdown) return;

    const onClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.header-left')) {
        showConversationDropdown = false;
      }
    };

    requestAnimationFrame(() => document.addEventListener('click', onClickOutside, true));
    return () => document.removeEventListener('click', onClickOutside, true);
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
    <div class="header-left">
      <button
        class="conversation-trigger"
        onclick={() => showConversationDropdown = !showConversationDropdown}
        disabled={agentState.isStreaming || agentState.isLoadingConversations || !agentState.currentChapterId}
      >
        <span class="conversation-title">{conversationTitle}</span>
        <span class="trigger-chevron" class:open={showConversationDropdown}>
          <Icon icon={ChevronDown} size={14} />
        </span>
      </button>

      {#if showConversationDropdown}
        <div class="dropdown-menu">
          {#if agentState.conversations.length === 0}
            <div class="dropdown-empty">No conversations yet</div>
          {:else}
            {#each agentState.conversations as conversation (conversation.id)}
              <button
                class="dropdown-item"
                class:active={conversation.id === agentState.selectedConversationId}
                onclick={() => { handleConversationChange(String(conversation.id)); showConversationDropdown = false; }}
                disabled={agentState.isStreaming}
              >
                {conversation.title}
              </button>
            {/each}
          {/if}
          <div class="dropdown-separator"></div>
          <button
            class="dropdown-item"
            onclick={() => { handleCreateConversation(); showConversationDropdown = false; }}
            disabled={agentState.isStreaming}
          >
            <Icon icon={Plus} size={14} /> New conversation
          </button>
          <button
            class="dropdown-item danger"
            onclick={() => { handleDeleteConversation(); showConversationDropdown = false; }}
            disabled={!agentState.selectedConversationId || agentState.isStreaming}
          >
            <Icon icon={Trash2} size={14} /> Delete
          </button>
        </div>
      {/if}
    </div>

    <div class="header-right">
      <select
        class="provider-pill"
        value={agentState.selectedProvider}
        onchange={(e) => setProvider(e.currentTarget.value as any)}
        disabled={agentState.isStreaming}
      >
        {#each providers as provider (provider.value)}
          <option value={provider.value}>{provider.label}</option>
        {/each}
      </select>
      <button class="close-btn" onclick={collapseChat} title="Hide chat">
        <Icon icon={X} size={16} />
      </button>
    </div>
  </div>

  <div class="chat-messages scrollbar-thin" bind:this={chatContainer}>
    {#if !agentState.currentChapterId}
      <div class="empty-state">
        <p>Select a chapter to start chatting</p>
      </div>
    {:else if agentState.conversations.length === 0}
      <div class="empty-state">
        <p>No conversations yet for this chapter</p>
        <p class="hint">Send a message to start one</p>
      </div>
    {:else if agentState.messages.length === 0}
      <div class="empty-state">
        <p>Start this conversation with the AI editor</p>
        <p class="hint">Try: "What should we keep?" or "Analyze this video"</p>
      </div>
    {:else}
      {#each agentState.messages as msg (msg.id)}
        <div class="message {msg.role}">
          {#if msg.role === 'assistant' && getVisibleStreamingStatusLabel(msg)}
            <div class="streaming-pill" aria-live="polite">
              <span class="streaming-dot"></span>
              <span>{getVisibleStreamingStatusLabel(msg)}</span>
              {#if getVisibleStreamingStatusMeta(msg)}
                <span class="streaming-meta">{getVisibleStreamingStatusMeta(msg)}</span>
              {/if}
            </div>
          {/if}

          {#if msg.content}
            <div class="message-content">
              <MarkdownContent content={msg.content} role={msg.role} />
            </div>
          {/if}

          {#if msg.role === 'assistant' && hasThinkingDetails(msg)}
            <details class="thinking" open={Boolean(msg.isStreaming)}>
              <summary>
                <span class="thinking-chevron"><Icon icon={ChevronRight} size={12} /></span>
                {#if msg.isStreaming}
                  Thinking{msg.trace.length > 0 ? ` (${msg.trace.length})` : ''}...
                {:else}
                  Thought for {msg.trace.length} step{msg.trace.length !== 1 ? 's' : ''}
                {/if}
              </summary>
              <div class="thinking-body">
                {#if msg.trace.length > 0}
                  <div class="thinking-steps">
                    {#each msg.trace as entry (entry.id)}
                      <div class="thinking-step">
                        <span class="step-label">{entry.label}</span>
                        {#if formatTraceMeta(entry)}
                          <span class="step-meta">{formatTraceMeta(entry)}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if msg.thinkingMarkdown}
                  <div class="thinking-reasoning">
                    <MarkdownContent content={msg.thinkingMarkdown} role="assistant" />
                  </div>
                {/if}
              </div>
            </details>
          {/if}

          <div class="message-time">{formatTime(msg.timestamp)}</div>
        </div>
      {/each}
    {/if}
  </div>

  {#if agentState.suggestions.length > 0}
    <div class="suggestions-panel scrollbar-thin">
      <div class="suggestions-header">
        <span class="suggestions-count">{pendingSuggestions.length} suggestion{pendingSuggestions.length !== 1 ? 's' : ''}</span>
        <div class="suggestions-actions">
          <button
            class="apply-all-btn"
            onclick={handleApplyAllSuggestions}
            disabled={applyingAllSuggestionState || pendingSuggestions.length === 0}
          >
            {applyingAllSuggestionState ? 'Applying...' : 'Apply All'}
          </button>
          <button class="toggle-chevron" onclick={() => showSuggestions = !showSuggestions}>
            <Icon icon={showSuggestions ? ChevronDown : ChevronRight} size={14} />
          </button>
        </div>
      </div>
      {#if showSuggestions}
        <div class="suggestions-list">
          {#each pendingSuggestions as suggestion (suggestion.id)}
            <div class="suggestion-row">
              <div class="suggestion-info">
                <span class="suggestion-time">{formatSuggestionPrimaryLine(suggestion)}</span>
                <span class="suggestion-desc">{suggestion.description || 'No description'}</span>
                {#if suggestion.reasoning}
                  <span class="suggestion-reasoning">{suggestion.reasoning}</span>
                {/if}
              </div>
              <div class="suggestion-actions">
                {#if suggestion.clip_id}
                  <button
                    class="action-btn preview"
                    onclick={() => handleCancelSuggestionPreview(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    class="action-btn preview"
                    onclick={() => handlePreviewSuggestion(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Preview
                  </button>
                {/if}
                <button
                  class="action-btn apply"
                  onclick={() => handleApplySuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  title="Apply"
                >
                  <Icon icon={Check} size={12} />
                </button>
                <button
                  class="action-btn reject"
                  onclick={() => handleRejectSuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  title="Reject"
                >
                  <Icon icon={X} size={12} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="composer-wrapper">
    <form class="composer" onsubmit={handleSubmit}>
      <textarea
        rows="1"
        bind:value={message}
        bind:this={messageInput}
        placeholder="Ask the AI editor..."
        disabled={agentState.isStreaming || !agentState.currentChapterId}
        oninput={autoResizeMessageInput}
        onkeydown={handleInputKeydown}
      ></textarea>
      <button
        type="submit"
        class="send-btn"
        disabled={!message.trim() || agentState.isStreaming || !agentState.currentChapterId}
        title="Send message"
      >
        <Icon icon={ArrowUp} size={16} />
      </button>
    </form>
  </div>
</div>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-base);
    min-height: 0;
    overflow: hidden;
  }

  /* ── Header ── */

  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--surface-base);
    flex-shrink: 0;
  }

  .header-left {
    position: relative;
    min-width: 0;
    flex: 1;
  }

  .conversation-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 5px 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background var(--transition-fast);
    max-width: 100%;
    min-width: 0;
  }

  .conversation-trigger:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .conversation-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .trigger-chevron {
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
    transition: transform var(--transition-spring);
    flex-shrink: 0;
  }

  .trigger-chevron.open {
    transform: rotate(180deg);
  }

  /* ── Dropdown ── */

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 220px;
    max-width: 300px;
    background: var(--surface-elevated);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    z-index: var(--z-float);
    padding: var(--space-1) 0;
    overflow: hidden;
  }

  .dropdown-empty {
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 8px 14px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .dropdown-item:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .dropdown-item.active {
    color: var(--accent-primary);
    background: var(--accent-primary-subtle);
  }

  .dropdown-item.danger {
    color: var(--accent-destructive);
  }

  .dropdown-item.danger:hover:not(:disabled) {
    background: var(--accent-destructive);
    color: #ffffff;
  }

  .dropdown-separator {
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--border-subtle);
  }

  /* ── Header Right ── */

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .provider-pill {
    appearance: none;
    -webkit-appearance: none;
    padding: 4px 24px 4px 10px;
    background: var(--surface-hover);
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    cursor: pointer;
    outline: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 12px;
    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
  }

  .provider-pill:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-default);
  }

  .provider-pill:focus-visible {
    border-color: var(--border-strong);
    box-shadow: none;
  }

  .provider-pill:disabled {
    opacity: 0.5;
  }

  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .close-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* ── Messages ── */

  .chat-messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-5) var(--space-4);
    display: flex;
    flex-direction: column;
  }

  .empty-state {
    align-self: center;
    text-align: center;
    color: var(--text-tertiary);
    margin-top: 80px;
    padding: 0 var(--space-6);
  }

  .empty-state p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .empty-state .hint {
    font-size: var(--text-xs);
    color: var(--text-disabled);
    margin-top: var(--space-3);
  }

  .message {
    margin-bottom: var(--space-5);
    position: relative;
  }

  .message.user {
    align-self: flex-end;
    max-width: 80%;
    background: var(--surface-elevated);
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
  }

  .message.assistant {
    align-self: flex-start;
    max-width: 85%;
  }

  .message-content {
    min-width: 0;
    line-height: 1.6;
  }

  .message.user .message-content {
    color: var(--text-primary);
  }

  .message.assistant .message-content {
    color: var(--text-secondary);
  }

  .message-time {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity var(--transition-fast);
    margin-top: 4px;
  }

  .message.user .message-time {
    text-align: right;
  }

  .message.assistant .message-time {
    text-align: left;
  }

  .message:hover .message-time {
    opacity: 1;
  }

  /* ── Streaming Indicator ── */

  .streaming-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    padding: 3px 10px;
    border-radius: var(--radius-pill);
    background: var(--accent-primary-subtle);
    color: var(--accent-primary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }

  .streaming-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-primary);
    animation: streaming-pulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }

  .streaming-meta {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }

  @keyframes streaming-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  /* ── Thinking Traces ── */

  .thinking {
    margin-top: var(--space-2);
  }

  .thinking summary {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    cursor: pointer;
    padding: 2px 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    user-select: none;
  }

  .thinking summary::-webkit-details-marker {
    display: none;
  }

  .thinking summary::before {
    display: none;
  }

  .thinking-chevron {
    display: inline-flex;
    align-items: center;
    transition: transform var(--transition-spring);
    color: var(--text-disabled);
  }

  .thinking[open] .thinking-chevron {
    transform: rotate(90deg);
  }

  .thinking-body {
    margin-left: var(--space-4);
    padding-top: var(--space-2);
  }

  .thinking-steps {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .thinking-step {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .step-label {
    color: var(--text-tertiary);
  }

  .step-meta {
    margin-left: var(--space-2);
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    color: var(--text-disabled);
  }

  .thinking-reasoning {
    margin-top: var(--space-2);
  }

  .thinking-reasoning :global(.markdown-content) {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
  }

  /* ── Suggestions Panel ── */

  .suggestions-panel {
    margin: 0 var(--space-3) var(--space-2);
    background: var(--surface-raised);
    border-radius: var(--radius-lg);
    max-height: 240px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .suggestions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) var(--space-3);
  }

  .suggestions-count {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
  }

  .suggestions-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .apply-all-btn {
    padding: 4px 10px;
    background: var(--accent-success-subtle);
    border: none;
    border-radius: var(--radius-pill);
    color: var(--accent-success);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--transition-spring);
  }

  .apply-all-btn:hover:not(:disabled) {
    background: var(--accent-success);
    color: #ffffff;
  }

  .apply-all-btn:active:not(:disabled) {
    transform: scale(0.97);
  }

  .apply-all-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .toggle-chevron:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .suggestions-list {
    padding: 0 var(--space-3) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .suggestion-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    transition: background var(--transition-fast);
  }

  .suggestion-row:hover {
    background: var(--surface-hover);
  }

  .suggestion-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .suggestion-time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-success);
  }

  .suggestion-desc {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    line-height: 1.4;
  }

  .suggestion-reasoning {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .suggestion-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  .suggestion-row:hover .suggestion-actions {
    opacity: 1;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: all var(--transition-spring);
  }

  .action-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.preview {
    background: var(--accent-primary-subtle);
    color: var(--accent-primary);
  }

  .action-btn.preview:hover:not(:disabled) {
    background: var(--accent-primary);
    color: #ffffff;
  }

  .action-btn.apply {
    background: var(--accent-success-subtle);
    color: var(--accent-success);
    width: 26px;
    height: 26px;
    padding: 0;
  }

  .action-btn.apply:hover:not(:disabled) {
    background: var(--accent-success);
    color: #ffffff;
  }

  .action-btn.reject {
    background: transparent;
    color: var(--text-tertiary);
    width: 26px;
    height: 26px;
    padding: 0;
  }

  .action-btn.reject:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* ── Composer ── */

  .composer-wrapper {
    padding: 0 var(--space-3) var(--space-3);
    flex-shrink: 0;
  }

  .composer {
    display: flex;
    align-items: center;
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-4);
    transition: border-color var(--transition-fast);
  }

  .composer:focus-within {
    border-color: var(--border-strong);
  }

  .composer textarea {
    flex: 1;
    padding: 6px 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: var(--text-base);
    font-family: var(--font-sans);
    line-height: 1.5;
    min-height: 32px;
    max-height: 180px;
    resize: none;
    overflow-y: hidden;
  }

  .composer textarea:focus-visible {
    box-shadow: none;
  }

  .composer textarea::placeholder {
    color: var(--text-tertiary);
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: var(--accent-primary);
    border: none;
    border-radius: var(--radius-pill);
    color: #ffffff;
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-spring);
  }

  .send-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
    transform: scale(1.05);
  }

  .send-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .send-btn:disabled {
    background: var(--surface-hover);
    color: var(--text-disabled);
    cursor: not-allowed;
    transform: none;
  }
</style>
