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
    applyTimelineProposal,
    rejectTimelineProposal,
  } from "../state/agent.svelte";
  import type { TimelineAction } from "../../../shared/types/agent-ipc";
  import { collapseChat } from "../state/layout.svelte";
  
  let message = $state("");
  let chatContainer: HTMLDivElement;
  let showSuggestions = $state(true);
  let showTimelineProposals = $state(true);
  let applyingAllSuggestionState = $state(false);
  let suggestionActionBusy = $state<Map<number, boolean>>(new Map());
  
  const providers = [
    { value: "gemini", label: "Gemini" },
    { value: "kimi", label: "Kimi K2.5" },
  ];
  
  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!message.trim() || agentState.isStreaming) return;
    
    const msg = message;
    message = "";
    await sendChatMessage(msg);
    
    // Scroll to bottom
    setTimeout(() => {
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }, 100);
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

  async function handleApplyTimelineProposal(id: string) {
    await applyTimelineProposal(id);
  }

  function handleRejectTimelineProposal(id: string) {
    rejectTimelineProposal(id);
  }

  function formatTimelineAction(action: TimelineAction): string {
    if (action.type === "create_clip") {
      const track = action.trackIndex ?? 0;
      const asset = action.assetId ? ` on asset ${action.assetId}` : "";
      return `Create clip ${formatDuration(action.inPoint, action.outPoint)} on track ${track + 1}${asset}`;
    }

    const fields = Object.keys(action.updates ?? {});
    return `Edit clip #${action.clipId}${fields.length > 0 ? ` (${fields.join(", ")})` : ""}`;
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
      >
        {#each providers as provider}
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
      disabled={agentState.isLoadingConversations || agentState.conversations.length === 0}
    >
      {#if agentState.conversations.length === 0}
        <option value="">No conversations</option>
      {:else}
        {#each agentState.conversations as conversation}
          <option value={conversation.id}>{conversation.title}</option>
        {/each}
      {/if}
    </select>
    <button class="toolbar-btn" onclick={handleCreateConversation}>New</button>
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
    {:else if agentState.messages.length === 0}
      <div class="empty-state">
        <p>Start a conversation with the AI editor</p>
        <p class="hint">Try: "What should we keep?" or "Analyze this video"</p>
      </div>
    {:else}
      {#each agentState.messages as msg}
        <div class="message {msg.role}">
          <div class="message-header">
            <span class="role">{msg.role === "user" ? "You" : "AI"}</span>
            <span class="time">{formatTime(msg.timestamp)}</span>
          </div>
          <div class="message-content">{msg.content}</div>
        </div>
      {/each}
    {/if}
    
    {#if agentState.isStreaming}
      <div class="message assistant streaming">
        <div class="message-header">
          <span class="role">AI</span>
          <span class="time">{formatTime(new Date())}</span>
        </div>
        <div class="message-content">
          <span class="typing">Analyzing video...</span>
        </div>
      </div>
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
          {#each agentState.suggestions.filter(s => s.status === 'pending') as suggestion}
            <div class="suggestion-card">
              <div class="suggestion-time">
                {formatDuration(suggestion.in_point, suggestion.out_point)}
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

  {#if agentState.timelineProposals.length > 0}
    <div class="suggestions-panel">
      <div class="suggestions-header">
        <h4>Timeline Proposals ({agentState.timelineProposals.filter(p => p.status === 'pending').length} pending)</h4>
        <button class="toggle-btn" onclick={() => showTimelineProposals = !showTimelineProposals}>
          {showTimelineProposals ? 'Hide' : 'Show'}
        </button>
      </div>

      {#if showTimelineProposals}
        <div class="suggestions-list">
          {#each agentState.timelineProposals.filter(p => p.status === 'pending' || p.status === 'failed') as proposal}
            <div class="suggestion-card">
              <div class="suggestion-description">
                {formatTimelineAction(proposal.action)}
              </div>
              {#if proposal.action.reasoning}
                <div class="suggestion-reasoning">
                  {proposal.action.reasoning}
                </div>
              {/if}
              {#if proposal.error}
                <div class="proposal-error">{proposal.error}</div>
              {/if}
              <div class="suggestion-actions">
                <button class="apply-btn" onclick={() => handleApplyTimelineProposal(proposal.id)}>
                  {proposal.status === 'failed' ? 'Retry Apply' : '✓ Apply'}
                </button>
                <button class="reject-btn" onclick={() => handleRejectTimelineProposal(proposal.id)}>
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
    <input
      type="text"
      bind:value={message}
      placeholder="Ask the AI editor..."
      disabled={agentState.isStreaming || !agentState.currentChapterId}
    />
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
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  
  .typing {
    font-style: italic;
    opacity: 0.7;
  }
  
  .chat-input {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #333;
    background: #252525;
  }
  
  .chat-input input {
    flex: 1;
    padding: 8px 12px;
    background: #333;
    border: 1px solid #444;
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
  }
  
  .chat-input input:focus {
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
