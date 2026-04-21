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
  import { cn } from "../utils/cn";

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

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

<div class={cn('chat-panel flex h-full min-h-0 flex-col overflow-hidden bg-surface-base', className)}>
  <div class="chat-header flex shrink-0 items-center justify-between bg-surface-base px-[14px] py-[10px]">
    <div class="header-left relative min-w-0 flex-1">
      <button
        class="conversation-trigger inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm bg-transparent px-2.5 py-[5px] text-app-sm font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
        onclick={() => showConversationDropdown = !showConversationDropdown}
        disabled={agentState.isStreaming || agentState.isLoadingConversations || !agentState.currentChapterId}
      >
        <span class="conversation-title min-w-0 truncate">{conversationTitle}</span>
        <span
          class="trigger-chevron inline-flex shrink-0 items-center text-text-tertiary transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          class:rotate-180={showConversationDropdown}
        >
          <Icon icon={ChevronDown} size={14} />
        </span>
      </button>

      {#if showConversationDropdown}
        <div class="dropdown-menu absolute left-0 top-[calc(100%+4px)] z-[var(--z-float)] min-w-[220px] max-w-[300px] overflow-hidden rounded-md bg-surface-elevated py-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          {#if agentState.conversations.length === 0}
            <div class="dropdown-empty px-4 py-3 text-app-sm text-text-tertiary">No conversations yet</div>
          {:else}
            {#each agentState.conversations as conversation (conversation.id)}
              <button
                class="dropdown-item flex w-full items-center gap-2 bg-transparent px-[14px] py-2 text-left text-app-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
                class:bg-accent-primary-subtle={conversation.id === agentState.selectedConversationId}
                class:text-accent-primary={conversation.id === agentState.selectedConversationId}
                onclick={() => { handleConversationChange(String(conversation.id)); showConversationDropdown = false; }}
                disabled={agentState.isStreaming}
              >
                {conversation.title}
              </button>
            {/each}
          {/if}
          <div class="dropdown-separator my-1 h-px bg-border-subtle"></div>
          <button
            class="dropdown-item flex w-full items-center gap-2 bg-transparent px-[14px] py-2 text-left text-app-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
            onclick={() => { handleCreateConversation(); showConversationDropdown = false; }}
            disabled={agentState.isStreaming}
          >
            <Icon icon={Plus} size={14} /> New conversation
          </button>
          <button
            class="dropdown-item flex w-full items-center gap-2 bg-transparent px-[14px] py-2 text-left text-app-sm text-accent-destructive transition-colors hover:bg-accent-destructive hover:text-white disabled:pointer-events-none disabled:opacity-50"
            onclick={() => { handleDeleteConversation(); showConversationDropdown = false; }}
            disabled={!agentState.selectedConversationId || agentState.isStreaming}
          >
            <Icon icon={Trash2} size={14} /> Delete
          </button>
        </div>
      {/if}
    </div>

    <div class="header-right flex shrink-0 items-center gap-2">
      <div class="relative">
        <select
          class="provider-pill h-7 appearance-none rounded-[6px] border border-border-default bg-surface-base pl-2.5 pr-8 text-app-xs font-medium text-text-secondary outline-none transition-colors hover:border-border-strong hover:text-text-primary focus-visible:border-border-strong disabled:opacity-50"
          value={agentState.selectedProvider}
          onchange={(e) => setProvider(e.currentTarget.value as any)}
          disabled={agentState.isStreaming}
        >
          {#each providers as provider (provider.value)}
            <option value={provider.value}>{provider.label}</option>
          {/each}
        </select>
        <span class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-text-tertiary">
          <Icon icon={ChevronDown} size={12} />
        </span>
      </div>
      <button class="close-btn inline-flex h-7 w-7 items-center justify-center rounded-sm bg-transparent text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary" onclick={collapseChat} title="Hide chat">
        <Icon icon={X} size={16} />
      </button>
    </div>
  </div>

  <div class="chat-messages scrollbar-thin flex flex-1 flex-col overflow-y-auto px-4 py-5" bind:this={chatContainer}>
    {#if !agentState.currentChapterId}
      <div class="empty-state mt-20 self-center px-6 text-center text-text-tertiary">
        <p class="m-0 text-app-sm">Select a chapter to start chatting</p>
      </div>
    {:else if agentState.conversations.length === 0}
      <div class="empty-state mt-20 self-center px-6 text-center text-text-tertiary">
        <p class="m-0 text-app-sm">No conversations yet for this chapter</p>
        <p class="hint mt-3 text-app-xs text-text-disabled">Send a message to start one</p>
      </div>
    {:else if agentState.messages.length === 0}
      <div class="empty-state mt-20 self-center px-6 text-center text-text-tertiary">
        <p class="m-0 text-app-sm">Start this conversation with the AI editor</p>
        <p class="hint mt-3 text-app-xs text-text-disabled">Try: "What should we keep?" or "Analyze this video"</p>
      </div>
    {:else}
      {#each agentState.messages as msg (msg.id)}
        <div
          class={cn(
            `message ${msg.role} group/message relative mb-5 max-w-[85%]`,
            msg.role === 'user'
              ? 'self-end max-w-[80%] rounded-lg bg-surface-elevated px-4 py-3'
              : 'self-start',
          )}
        >
          {#if msg.role === 'assistant' && getVisibleStreamingStatusLabel(msg)}
            <div class="message-live-status streaming-pill mb-2 inline-flex items-center gap-2 rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-primary)_20%,transparent)] bg-accent-primary-subtle px-2.5 py-1 text-app-xs font-medium text-accent-primary" aria-live="polite">
              <span class="streaming-dot h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary animate-pulse"></span>
              <span>{getVisibleStreamingStatusLabel(msg)}</span>
              {#if getVisibleStreamingStatusMeta(msg)}
                <span class="streaming-meta text-app-xs text-text-tertiary">{getVisibleStreamingStatusMeta(msg)}</span>
              {/if}
            </div>
          {/if}

          {#if msg.content}
            <div
              class={cn(
                'message-content min-w-0 leading-[1.6]',
                msg.role === 'user' ? 'text-text-primary' : 'text-text-secondary',
              )}
            >
              <MarkdownContent content={msg.content} role={msg.role} />
            </div>
          {/if}

          {#if msg.role === 'assistant' && hasThinkingDetails(msg)}
            <details class="thinking group/thinking mt-2" open={Boolean(msg.isStreaming)}>
              <summary class="ui-summary-reset flex list-none items-center gap-1 py-0.5 text-app-xs text-text-tertiary select-none">
                <span class="thinking-chevron inline-flex items-center text-text-disabled transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-open/thinking:rotate-90"><Icon icon={ChevronRight} size={12} /></span>
                {#if msg.isStreaming}
                  Thinking{msg.trace.length > 0 ? ` (${msg.trace.length})` : ''}...
                {:else}
                  Thought for {msg.trace.length} step{msg.trace.length !== 1 ? 's' : ''}
                {/if}
              </summary>
              <div class="thinking-body ml-4 pt-2">
                {#if msg.trace.length > 0}
                  <div class="thinking-steps flex flex-col gap-[3px]">
                    {#each msg.trace as entry (entry.id)}
                      <div class="thinking-step text-app-xs text-text-tertiary">
                        <span class="step-label text-text-tertiary">{entry.label}</span>
                        {#if formatTraceMeta(entry)}
                          <span class="step-meta ml-2 font-mono text-app-xs text-text-disabled">{formatTraceMeta(entry)}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                {#if msg.thinkingMarkdown}
                  <div class="thinking-reasoning thinking-markdown mt-2">
                    <MarkdownContent content={msg.thinkingMarkdown} role="assistant" />
                  </div>
                {/if}
              </div>
            </details>
          {/if}

          <div
            class={cn(
              'message-time mt-1 text-app-xs text-text-tertiary opacity-0 transition-opacity group-hover/message:opacity-100',
              msg.role === 'user' ? 'text-right' : 'text-left',
            )}
          >
            {formatTime(msg.timestamp)}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if agentState.suggestions.length > 0}
    <div class="suggestions-panel scrollbar-thin mx-3 mb-2 max-h-[240px] shrink-0 overflow-y-auto rounded-lg bg-surface-raised">
      <div class="suggestions-header flex items-center justify-between px-3 py-2">
        <span class="suggestions-count text-app-xs font-medium text-text-secondary">{pendingSuggestions.length} suggestion{pendingSuggestions.length !== 1 ? 's' : ''}</span>
        <div class="suggestions-actions flex items-center gap-2">
          <button
            class="rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-success)_20%,transparent)] bg-accent-success-subtle px-2.5 py-1 text-app-xs font-medium text-accent-success transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-accent-success hover:bg-accent-success hover:text-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            onclick={handleApplyAllSuggestions}
            disabled={applyingAllSuggestionState || pendingSuggestions.length === 0}
          >
            {applyingAllSuggestionState ? 'Applying...' : 'Apply All'}
          </button>
          <button class="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-transparent text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary" onclick={() => showSuggestions = !showSuggestions}>
            <Icon icon={showSuggestions ? ChevronDown : ChevronRight} size={14} />
          </button>
        </div>
      </div>
      {#if showSuggestions}
        <div class="suggestions-list flex flex-col gap-2 px-3 pb-2">
          {#each pendingSuggestions as suggestion (suggestion.id)}
            <div class="suggestion-row group/suggestion flex items-start justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-hover">
              <div class="suggestion-info flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="suggestion-time font-mono text-app-xs text-accent-success">{formatSuggestionPrimaryLine(suggestion)}</span>
                <span class="suggestion-desc text-app-sm font-medium leading-[1.4] text-text-primary">{suggestion.description || 'No description'}</span>
                {#if suggestion.reasoning}
                  <span class="suggestion-reasoning text-app-xs leading-[1.4] text-text-tertiary">{suggestion.reasoning}</span>
                {/if}
              </div>
              <div class="suggestion-actions flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/suggestion:opacity-100">
                {#if suggestion.clip_id}
                  <button
                    class="rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] bg-accent-primary-subtle px-2.5 py-1 text-app-xs font-medium text-accent-primary transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-accent-primary hover:bg-accent-primary hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={() => handleCancelSuggestionPreview(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Cancel
                  </button>
                {:else}
                  <button
                    class="rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] bg-accent-primary-subtle px-2.5 py-1 text-app-xs font-medium text-accent-primary transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-accent-primary hover:bg-accent-primary hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    onclick={() => handlePreviewSuggestion(suggestion.id)}
                    disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  >
                    Preview
                  </button>
                {/if}
                <button
                  class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-success)_20%,transparent)] bg-accent-success-subtle p-0 text-accent-success transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-accent-success hover:bg-accent-success hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  onclick={() => handleApplySuggestion(suggestion.id)}
                  disabled={applyingAllSuggestionState || suggestionActionBusy.has(suggestion.id)}
                  title="Apply"
                >
                  <Icon icon={Check} size={12} />
                </button>
                <button
                  class="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-border-default bg-surface-base p-0 text-text-tertiary transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-border-strong hover:bg-surface-hover hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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

  <div class="composer-wrapper shrink-0 px-3 pb-3">
    <form class="composer flex items-center rounded-lg border border-border-default bg-surface-raised px-2 py-1 pl-4 transition-colors focus-within:border-border-strong" onsubmit={handleSubmit}>
      <textarea
        class="min-h-8 max-h-[180px] flex-1 resize-none overflow-y-hidden bg-transparent py-1.5 text-app-base leading-[1.5] text-text-primary outline-none placeholder:text-text-tertiary focus-visible:shadow-none"
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
        class="send-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-accent-primary text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 hover:bg-accent-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-hover disabled:text-text-disabled disabled:transform-none"
        disabled={!message.trim() || agentState.isStreaming || !agentState.currentChapterId}
        title="Send message"
      >
        <Icon icon={ArrowUp} size={16} />
      </button>
    </form>
  </div>
</div>
