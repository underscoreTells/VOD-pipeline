<script lang="ts">
  import { agentState, sendChatMessage, setProvider, applySuggestion, rejectSuggestion, clearSuggestions } from "../state/agent.svelte";
  
  let message = $state("");
  let chatContainer: HTMLDivElement;
  let showSuggestions = $state(true);
  
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
  
  async function handleApplySuggestion(id: number) {
    await applySuggestion(id);
  }
  
  async function handleRejectSuggestion(id: number) {
    await rejectSuggestion(id);
  }
</script>

<div class="chat-panel">
  <div class="chat-header">
    <h3>Chat</h3>
    <select 
      value={agentState.selectedProvider}
      onchange={(e) => setProvider(e.currentTarget.value as any)}
      class="provider-select"
    >
      {#each providers as provider}
        <option value={provider.value}>{provider.label}</option>
      {/each}
    </select>
  </div>
  
  <div class="chat-messages" bind:this={chatContainer}>
    {#if agentState.messages.length === 0}
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
        <button class="toggle-btn" onclick={() => showSuggestions = !showSuggestions}>
          {showSuggestions ? 'Hide' : 'Show'}
        </button>
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
                <button class="apply-btn" onclick={() => handleApplySuggestion(suggestion.id)}>
                  ✓ Apply
                </button>
                <button class="reject-btn" onclick={() => handleRejectSuggestion(suggestion.id)}>
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
      disabled={agentState.isStreaming}
    />
    <button type="submit" disabled={!message.trim() || agentState.isStreaming}>
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
  }
  
  .chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
    background: #252525;
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
  
  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
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
  
  .suggestion-actions {
    display: flex;
    gap: 8px;
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
  
  .reject-btn {
    background: #444;
    color: #fff;
  }
  
  .reject-btn:hover {
    background: #555;
  }
</style>
