<script lang="ts">
  import {
    agentState,
    applyAllSuggestions,
    branchMessage,
    editMessage,
    previewAllSuggestions,
    rejectAllSuggestions,
    rerollMessage,
    sendChatMessage,
    setProvider,
    type ChatMessage,
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
  import {
    collapseChat,
    layoutState,
    persistLayout,
    setSuggestionsTrayMaxHeight,
  } from "../state/layout.svelte";
  import { clampValue, startPointerDrag } from "./project-detail-layout.js";
  import Icon from './ui/Icon.svelte';
  import TooltipIconButton from './ui/TooltipIconButton.svelte';
  import { Check, X, ArrowUp, Plus, Trash2, ChevronDown, ChevronRight, Copy, GitBranch, Pencil, Repeat, Play } from '../constants';
  import {
    canSubmitComposerMessage,
    shouldInterceptComposerEnter,
  } from './chat-panel-composer.js';
  import {
    countExecutionTraceSteps,
    getExecutionTraceStepIndex,
  } from "../../../shared/utils/execution-trace.js";
  import { cn } from "../utils/cn";

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();

  let message = $state("");
  let chatPanelElement = $state<HTMLDivElement | null>(null);
  let chatContainer = $state<HTMLDivElement | null>(null);
  let messageInput = $state<HTMLTextAreaElement | null>(null);
  let suggestionsWrapper = $state<HTMLDivElement | null>(null);
  let suggestionsPanel = $state<HTMLDivElement | null>(null);
  let showSuggestions = $state(true);
  let bulkSuggestionAction = $state<'preview' | 'reject' | 'apply' | null>(null);
  let busySuggestionIds = $state<number[]>([]);
  let showConversationDropdown = $state(false);
  let copiedMessageId = $state<string | null>(null);
  let editingMessageId = $state<string | null>(null);
  let editingMessageValue = $state("");
  let messageActionPending = $state(false);
  let copyResetTimeout: ReturnType<typeof setTimeout> | null = null;

  const MESSAGE_INPUT_MIN_HEIGHT = 112;
  const MESSAGE_INPUT_MAX_HEIGHT = 180;
  const SUGGESTIONS_TRAY_RESIZE_HANDLE_HEIGHT = 6;
  const MIN_SUGGESTIONS_TRAY_MAX_HEIGHT = 140;
  const MIN_VISIBLE_MESSAGES_HEIGHT = 160;
  const SUGGESTION_ACTION_BUTTON_CLASS = 'border border-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] bg-accent-primary-subtle text-accent-primary hover:border-accent-primary hover:bg-accent-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

  const providers = [
    { value: "gemini", label: "Gemini" },
    { value: "kimi", label: "Kimi K2.5" },
  ];

  let currentConversation = $derived(
    agentState.conversations.find(c => c.id === agentState.selectedConversationId)
  );

  let pendingSuggestions = $derived.by(
    () => agentState.suggestions.filter((suggestion) => suggestion.status === 'pending')
  );

  let previewableSuggestions = $derived.by(
    () => pendingSuggestions.filter((suggestion) => suggestion.clip_id == null)
  );

  let isBulkSuggestionActionRunning = $derived(bulkSuggestionAction !== null);
  let isGroundingActionBlocked = $derived(
    Boolean(agentState.currentChapterId)
      && (agentState.isGroundingStatusLoading || agentState.groundingStatus !== 'ready')
  );

  let canSubmitCurrentMessage = $derived.by(() =>
    canSubmitComposerMessage({
      isEditing: Boolean(editingMessageId),
      isGroundingActionBlocked,
      isStreaming: agentState.isStreaming,
      message,
    })
  );

  let composerPlaceholder = $derived.by(() => {
    if (editingMessageId) {
      return "Finish editing the selected message...";
    }

    if (isGroundingActionBlocked) {
      return "Draft while video grounding finishes...";
    }

    return "Ask the AI editor...";
  });

  let isComposerDisabled = $derived(agentState.isStreaming || Boolean(editingMessageId));
  let isSendDisabled = $derived(!canSubmitCurrentMessage);

  let conversationTitle = $derived(
    !agentState.currentChapterId
      ? 'Select a chapter'
      : agentState.conversations.length === 0
        ? 'No conversations'
        : currentConversation?.title || 'Select conversation'
  );

  let groundingBanner = $derived.by(() => {
    if (
      !agentState.currentChapterId
      || (!agentState.isGroundingStatusLoading && agentState.groundingStatus === 'ready')
    ) {
      return null;
    }

    if (agentState.isGroundingStatusLoading) {
      return {
        title: 'Checking video grounding',
        body: 'You can keep drafting, but send stays disabled until grounding is ready.',
        progress: null,
        detail: null,
      };
    }

    if (agentState.groundingStatus === 'missing_video_asset') {
      return {
        title: 'No video proxy source available',
        body: 'Link a video asset to this chapter. You can keep drafting, but send stays disabled until the agent has grounded video.',
        progress: null,
        detail: null,
      };
    }

    if (agentState.groundingStatus === 'error') {
      return {
        title: 'Video proxy failed',
        body: 'You can keep drafting, but send stays disabled until the chapter proxy can be built.',
        progress: null,
        detail: agentState.groundingErrorDetail,
      };
    }

    const progress =
      agentState.groundingRequiredVideoAssetCount > 0
        ? `${agentState.groundingReadyVideoAssetCount}/${agentState.groundingRequiredVideoAssetCount} video assets ready`
        : null;

    return {
      title: 'Video proxy is still preparing',
      body: 'You can keep drafting, but send stays disabled until grounding is ready.',
      progress,
      detail: null,
    };
  });

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

  $effect(() => {
    if (!editingMessageId) return;
    if (agentState.messages.some((msg) => msg.id === editingMessageId)) {
      return;
    }

    editingMessageId = null;
    editingMessageValue = "";
  });

  function isSuggestionBusy(id: number): boolean {
    return busySuggestionIds.includes(id);
  }

  function getBusySuggestionIdsNext(id: number, busy: boolean): number[] {
    const next = busySuggestionIds.filter((busyId) => busyId !== id);
    if (busy) {
      next.push(id);
    }
    return next;
  }

  function getSuggestionsTrayMaxHeightBounds() {
    const min = MIN_SUGGESTIONS_TRAY_MAX_HEIGHT;
    if (!chatContainer || !suggestionsWrapper || !showSuggestions) {
      return { min, max: Math.max(min, layoutState.suggestionsTrayMaxHeight) };
    }

    const availableCenterHeight = chatContainer.clientHeight + suggestionsWrapper.offsetHeight;
    const max = Math.max(
      min,
      availableCenterHeight - MIN_VISIBLE_MESSAGES_HEIGHT - SUGGESTIONS_TRAY_RESIZE_HANDLE_HEIGHT
    );
    return { min, max };
  }

  function clampSuggestionsTrayMaxHeight(shouldPersist: boolean = false) {
    if (!showSuggestions || pendingSuggestions.length === 0) {
      return;
    }

    const { min, max } = getSuggestionsTrayMaxHeightBounds();
    const next = clampValue(layoutState.suggestionsTrayMaxHeight, min, max);
    if (next === layoutState.suggestionsTrayMaxHeight) {
      return;
    }

    setSuggestionsTrayMaxHeight(next);
    if (shouldPersist) {
      persistLayout();
    }
  }

  $effect(() => {
    if (!showSuggestions || pendingSuggestions.length === 0) {
      return;
    }

    clampSuggestionsTrayMaxHeight();
  });

  $effect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    if (!chatPanelElement || !chatContainer) return;

    const observer = new ResizeObserver(() => {
      clampSuggestionsTrayMaxHeight();
    });

    observer.observe(chatPanelElement);
    observer.observe(chatContainer);
    if (suggestionsWrapper) {
      observer.observe(suggestionsWrapper);
    }
    if (suggestionsPanel) {
      observer.observe(suggestionsPanel);
    }
    if (messageInput) {
      observer.observe(messageInput);
    }

    return () => observer.disconnect();
  });

  async function submitMessage() {
    if (!canSubmitCurrentMessage) return;

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
    if (shouldInterceptComposerEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      canSubmit: canSubmitCurrentMessage,
    })) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function canMutateMessage(message: ChatMessage) {
    return !agentState.isStreaming && !messageActionPending && message.databaseId !== null;
  }

  function canEditMessage(message: ChatMessage) {
    return canMutateMessage(message) && !isGroundingActionBlocked && message.role === "user" && !editingMessageId;
  }

  function canRerollMessage(message: ChatMessage) {
    return canMutateMessage(message) && !isGroundingActionBlocked && message.role !== "system";
  }

  function startEditingMessage(message: ChatMessage) {
    if (!canEditMessage(message)) return;
    editingMessageId = message.id;
    editingMessageValue = message.content;
  }

  function cancelEditingMessage() {
    editingMessageId = null;
    editingMessageValue = "";
  }

  async function handleSaveEditedMessage(message: ChatMessage) {
    if (editingMessageId !== message.id || !editingMessageValue.trim()) return;

    const nextContent = editingMessageValue;
    cancelEditingMessage();
    await editMessage(message, nextContent);
  }

  async function handleCopyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      copiedMessageId = message.id;
      if (copyResetTimeout) {
        clearTimeout(copyResetTimeout);
      }
      copyResetTimeout = setTimeout(() => {
        copiedMessageId = null;
      }, 1500);
    } catch (error) {
      agentState.error = error instanceof Error ? error.message : "Failed to copy message";
    }
  }

  async function handleBranchMessage(message: ChatMessage) {
    if (!canMutateMessage(message) || editingMessageId) return;

    messageActionPending = true;
    try {
      await branchMessage(message);
      cancelEditingMessage();
    } finally {
      messageActionPending = false;
    }
  }

  async function handleRerollMessage(message: ChatMessage) {
    if (!canMutateMessage(message) || editingMessageId) return;
    await rerollMessage(message);
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

  function getTraceStepCount(message: { trace: Array<{ label: string; stepIndex?: number }> }) {
    return countExecutionTraceSteps(message.trace);
  }

  function formatTraceMeta(message: { label: string; nodeName?: string; passIndex?: number; stepIndex?: number }) {
    const parts: string[] = [];
    const stepIndex = getExecutionTraceStepIndex(message);
    if (typeof stepIndex === "number") {
      parts.push(`Step ${stepIndex}`);
    }
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
    trace: Array<{ label: string; nodeName?: string; passIndex?: number; stepIndex?: number }>;
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
    if (isBulkSuggestionActionRunning || isSuggestionBusy(id)) return;
    busySuggestionIds = getBusySuggestionIdsNext(id, true);
    try {
      await applySuggestion(id);
    } finally {
      busySuggestionIds = getBusySuggestionIdsNext(id, false);
    }
  }

  async function handlePreviewSuggestion(id: number) {
    if (isBulkSuggestionActionRunning || isSuggestionBusy(id)) return;
    busySuggestionIds = getBusySuggestionIdsNext(id, true);
    try {
      await previewSuggestion(id);
    } finally {
      busySuggestionIds = getBusySuggestionIdsNext(id, false);
    }
  }

  async function handleCancelSuggestionPreview(id: number) {
    if (isBulkSuggestionActionRunning || isSuggestionBusy(id)) return;
    busySuggestionIds = getBusySuggestionIdsNext(id, true);
    try {
      await cancelSuggestionPreviewAction(id);
    } finally {
      busySuggestionIds = getBusySuggestionIdsNext(id, false);
    }
  }

  async function handleApplyAllSuggestions() {
    if (isBulkSuggestionActionRunning || pendingSuggestions.length === 0) return;
    bulkSuggestionAction = 'apply';
    try {
      await applyAllSuggestions();
    } finally {
      bulkSuggestionAction = null;
    }
  }

  async function handlePreviewAllSuggestions() {
    if (isBulkSuggestionActionRunning || previewableSuggestions.length === 0) return;
    bulkSuggestionAction = 'preview';
    try {
      await previewAllSuggestions();
    } finally {
      bulkSuggestionAction = null;
    }
  }

  async function handleRejectAllSuggestions() {
    if (isBulkSuggestionActionRunning || pendingSuggestions.length === 0) return;
    bulkSuggestionAction = 'reject';
    try {
      await rejectAllSuggestions();
    } finally {
      bulkSuggestionAction = null;
    }
  }

  async function handleRejectSuggestion(id: number) {
    if (isBulkSuggestionActionRunning || isSuggestionBusy(id)) return;
    busySuggestionIds = getBusySuggestionIdsNext(id, true);
    try {
      await rejectSuggestion(id);
    } finally {
      busySuggestionIds = getBusySuggestionIdsNext(id, false);
    }
  }

  function handleSuggestionsResize(event: PointerEvent) {
    if (!showSuggestions || pendingSuggestions.length === 0) return;

    const startY = event.clientY;
    const startHeight = layoutState.suggestionsTrayMaxHeight;

    startPointerDrag(
      event,
      'row-resize',
      (moveEvent) => {
        const delta = moveEvent.clientY - startY;
        const { min, max } = getSuggestionsTrayMaxHeightBounds();
        const next = clampValue(startHeight - delta, min, max);
        setSuggestionsTrayMaxHeight(next);
      },
      () => {
        clampSuggestionsTrayMaxHeight(true);
      }
    );
  }
</script>

<div
  class={cn('chat-panel flex h-full min-h-0 flex-col overflow-hidden bg-surface-base', className)}
  bind:this={chatPanelElement}
>
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
        <p class="m-0 text-app-sm">Select a chapter before chatting</p>
        <p class="hint mt-3 text-app-xs text-text-disabled">Choose a chapter from the left sidebar to start a conversation with the AI editor.</p>
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
            `message ${msg.role} group/message relative mb-5 flex w-full flex-col gap-2`,
            msg.role === 'user' ? 'items-end' : 'items-start',
          )}
        >
          <div
            class={cn(
              'message-body min-w-0',
              msg.role === 'user' ? 'w-fit max-w-[80%]' : 'max-w-[85%]',
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

            {#if editingMessageId === msg.id}
              <div class="message-edit flex flex-col gap-2 rounded-lg bg-surface-elevated px-4 py-3">
                <textarea
                  class="min-h-[112px] w-full resize-y rounded-md border border-border-default bg-surface-base px-3 py-2 text-app-sm leading-[1.6] text-text-primary outline-none transition-colors focus-visible:border-border-strong"
                  bind:value={editingMessageValue}
                ></textarea>
                <div class="message-edit-actions flex items-center justify-end gap-1">
                  <TooltipIconButton
                    class="h-7 w-7 rounded-[6px] border border-border-default bg-surface-base text-text-secondary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
                    icon={X}
                    onclick={cancelEditingMessage}
                    tooltip="Cancel edit"
                    type="button"
                  />
                  <TooltipIconButton
                    class="h-7 w-7 rounded-[6px] border border-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] bg-accent-primary-subtle text-accent-primary hover:border-accent-primary hover:bg-accent-primary hover:text-white disabled:opacity-50"
                    icon={Check}
                    onclick={() => handleSaveEditedMessage(msg)}
                    disabled={!editingMessageValue.trim()}
                    tooltip="Save edit"
                    type="button"
                  />
                </div>
              </div>
            {:else if msg.content}
              <div
                class={cn(
                  'message-content min-w-0 leading-[1.6]',
                  msg.role === 'user'
                    ? 'rounded-lg bg-surface-elevated px-4 py-3 text-text-primary'
                    : 'text-text-secondary',
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
                    Thinking{msg.trace.length > 0 ? ` (${getTraceStepCount(msg)})` : ''}...
                  {:else}
                    {@const traceStepCount = getTraceStepCount(msg)}
                    Thought for {traceStepCount} step{traceStepCount !== 1 ? 's' : ''}
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
          </div>

          <div
            class={cn(
              'message-meta flex min-h-[20px] items-center gap-2 text-app-2xs leading-none',
              'pointer-events-none opacity-0 transition-opacity',
              'group-hover/message:pointer-events-auto group-hover/message:opacity-100',
              'group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100',
              msg.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {#if msg.role !== 'system' && editingMessageId !== msg.id}
              <div class="message-actions flex items-center gap-1">
                <TooltipIconButton
                  class="h-6 w-6 rounded-[6px] border border-border-default bg-surface-base text-text-tertiary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                  icon={Repeat}
                  onclick={() => handleRerollMessage(msg)}
                  disabled={!canRerollMessage(msg) || !!editingMessageId}
                  tooltip="Reroll response"
                  type="button"
                />
                <TooltipIconButton
                  class="h-6 w-6 rounded-[6px] border border-border-default bg-surface-base text-text-tertiary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
                  icon={copiedMessageId === msg.id ? Check : Copy}
                  onclick={() => handleCopyMessage(msg)}
                  tooltip={copiedMessageId === msg.id ? 'Copied' : 'Copy message'}
                  type="button"
                />
                <TooltipIconButton
                  class="h-6 w-6 rounded-[6px] border border-border-default bg-surface-base text-text-tertiary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                  icon={GitBranch}
                  onclick={() => handleBranchMessage(msg)}
                  disabled={!canMutateMessage(msg) || !!editingMessageId}
                  tooltip="Branch conversation"
                  type="button"
                />
                {#if msg.role === 'user'}
                  <TooltipIconButton
                    class="h-6 w-6 rounded-[6px] border border-border-default bg-surface-base text-text-tertiary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                    icon={Pencil}
                    onclick={() => startEditingMessage(msg)}
                    disabled={!canEditMessage(msg)}
                    tooltip="Edit message"
                    type="button"
                  />
                {/if}
              </div>
            {/if}
            <div
              class="message-time font-mono tracking-[0.04em] tabular-nums text-text-tertiary"
              class:text-right={msg.role === 'user'}
              class:text-left={msg.role !== 'user'}
            >
              {formatTime(msg.timestamp)}
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if pendingSuggestions.length > 0}
    <div class="suggestions-wrapper mx-3 mb-2 shrink-0" bind:this={suggestionsWrapper}>
      {#if showSuggestions}
        <div
          class="suggestions-resize-handle h-[6px] flex-[0_0_6px] cursor-row-resize touch-none rounded-t-lg bg-surface-base transition-colors hover:bg-surface-hover"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize suggestions tray"
          onpointerdown={handleSuggestionsResize}
        ></div>
      {/if}
      <div class="suggestions-shell overflow-hidden rounded-lg bg-surface-raised">
        <div
          class="suggestions-panel scrollbar-thin overflow-y-auto"
          bind:this={suggestionsPanel}
          style={showSuggestions ? `max-height: ${layoutState.suggestionsTrayMaxHeight}px;` : undefined}
        >
          <div class="suggestions-header sticky top-0 z-[var(--z-panel)] flex items-center justify-between border-b border-border-subtle bg-surface-raised px-3 py-2 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
            <span class="suggestions-count text-app-xs font-medium text-text-secondary">{pendingSuggestions.length} suggestion{pendingSuggestions.length !== 1 ? 's' : ''}</span>
            <div class="suggestions-actions flex items-center gap-1">
              <TooltipIconButton
                class={cn(
                  'h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]',
                  SUGGESTION_ACTION_BUTTON_CLASS,
                  bulkSuggestionAction === 'preview' && 'animate-pulse'
                )}
                icon={Play}
                onclick={handlePreviewAllSuggestions}
                disabled={isBulkSuggestionActionRunning || previewableSuggestions.length === 0}
                tooltip={bulkSuggestionAction === 'preview' ? 'Previewing suggestions' : 'Preview all suggestions'}
                type="button"
              />
              <TooltipIconButton
                class={cn(
                  'h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]',
                  SUGGESTION_ACTION_BUTTON_CLASS,
                  bulkSuggestionAction === 'reject' && 'animate-pulse'
                )}
                icon={X}
                onclick={handleRejectAllSuggestions}
                disabled={isBulkSuggestionActionRunning || pendingSuggestions.length === 0}
                tooltip={bulkSuggestionAction === 'reject' ? 'Rejecting suggestions' : 'Reject all suggestions'}
                type="button"
              />
              <TooltipIconButton
                class={cn(
                  'h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]',
                  SUGGESTION_ACTION_BUTTON_CLASS,
                  bulkSuggestionAction === 'apply' && 'animate-pulse'
                )}
                icon={Check}
                onclick={handleApplyAllSuggestions}
                disabled={isBulkSuggestionActionRunning || pendingSuggestions.length === 0}
                tooltip={bulkSuggestionAction === 'apply' ? 'Applying suggestions' : 'Apply all suggestions'}
                type="button"
              />
              <button
                class="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-transparent text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
                onclick={() => showSuggestions = !showSuggestions}
                aria-label={showSuggestions ? 'Collapse suggestions tray' : 'Expand suggestions tray'}
              >
                <Icon icon={showSuggestions ? ChevronDown : ChevronRight} size={14} />
              </button>
            </div>
          </div>
          {#if showSuggestions}
            <div class="suggestions-list flex flex-col gap-2 px-3 pb-2 pt-2">
              {#each pendingSuggestions as suggestion (suggestion.id)}
                <div class="suggestion-row group/suggestion flex items-start justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-hover">
                  <div class="suggestion-info flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="suggestion-time font-mono text-app-xs text-accent-primary">{formatSuggestionPrimaryLine(suggestion)}</span>
                    <span class="suggestion-desc text-app-sm font-medium leading-[1.4] text-text-primary">{suggestion.description || 'No description'}</span>
                    {#if suggestion.reasoning}
                      <span class="suggestion-reasoning text-app-xs leading-[1.4] text-text-tertiary">{suggestion.reasoning}</span>
                    {/if}
                  </div>
                  <div class="suggestion-actions flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/suggestion:opacity-100 group-focus-within/suggestion:opacity-100">
                    {#if suggestion.clip_id}
                      <TooltipIconButton
                        class={cn('h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95', SUGGESTION_ACTION_BUTTON_CLASS)}
                        icon={X}
                        onclick={() => handleCancelSuggestionPreview(suggestion.id)}
                        disabled={isBulkSuggestionActionRunning || isSuggestionBusy(suggestion.id)}
                        tooltip="Cancel preview"
                        type="button"
                      />
                    {:else}
                      <TooltipIconButton
                        class={cn('h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95', SUGGESTION_ACTION_BUTTON_CLASS)}
                        icon={Play}
                        onclick={() => handlePreviewSuggestion(suggestion.id)}
                        disabled={isBulkSuggestionActionRunning || isSuggestionBusy(suggestion.id)}
                        tooltip="Preview suggestion"
                        type="button"
                      />
                    {/if}
                    <TooltipIconButton
                      class={cn('h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95', SUGGESTION_ACTION_BUTTON_CLASS)}
                      icon={Check}
                      onclick={() => handleApplySuggestion(suggestion.id)}
                      disabled={isBulkSuggestionActionRunning || isSuggestionBusy(suggestion.id)}
                      tooltip="Apply suggestion"
                      type="button"
                    />
                    <TooltipIconButton
                      class={cn('h-7 w-7 rounded-[6px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95', SUGGESTION_ACTION_BUTTON_CLASS)}
                      icon={X}
                      onclick={() => handleRejectSuggestion(suggestion.id)}
                      disabled={isBulkSuggestionActionRunning || isSuggestionBusy(suggestion.id)}
                      tooltip="Reject suggestion"
                      type="button"
                    />
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if agentState.currentChapterId}
    <div class="composer-wrapper shrink-0 px-3 pb-3">
      {#if groundingBanner}
        <div class="mb-3 rounded-lg border border-accent-destructive bg-accent-destructive/10 px-3 py-2 text-accent-destructive">
          <div class="text-app-xs font-semibold uppercase tracking-[0.06em]">{groundingBanner.title}</div>
          <div class="mt-1 text-app-sm">{groundingBanner.body}</div>
          {#if groundingBanner.progress}
            <div class="mt-1 text-app-xs">{groundingBanner.progress}</div>
          {/if}
          {#if groundingBanner.detail}
            <div class="mt-1 text-app-xs">{groundingBanner.detail}</div>
          {/if}
        </div>
      {/if}
      <form class="composer flex items-end gap-3 rounded-xl border border-border-default bg-surface-raised px-3 py-3 pl-4 transition-colors focus-within:border-border-strong" onsubmit={handleSubmit}>
        <textarea
          class="min-h-28 max-h-[180px] flex-1 resize-none overflow-y-hidden bg-transparent py-2.5 text-app-base leading-[1.5] text-text-primary outline-none placeholder:text-text-tertiary focus-visible:shadow-none"
          rows="1"
          bind:value={message}
          bind:this={messageInput}
          placeholder={composerPlaceholder}
          disabled={isComposerDisabled}
          oninput={autoResizeMessageInput}
          onkeydown={handleInputKeydown}
        ></textarea>
        <button
          type="submit"
          class="send-btn inline-flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-lg border border-transparent bg-accent-primary text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-105 hover:bg-accent-primary-hover active:scale-95 disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-hover disabled:text-text-disabled disabled:transform-none"
          disabled={isSendDisabled}
          title="Send message"
        >
          <Icon icon={ArrowUp} size={16} />
        </button>
      </form>
    </div>
  {/if}
</div>
