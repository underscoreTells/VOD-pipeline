<script lang="ts">
  import { 
    settingsState, 
    loadSettings, 
    saveSettings, 
    updateApiKey, 
    testProvider,
    getProviderLabel,
    supportsVideo,
    closeSettings,
    resetSettings,
    type LLMProviderType,
  } from "../state/settings.svelte";
  import { Icon } from './ui';
  import { CheckCircle2, Circle } from '../constants';
  
  // Load settings on mount
  let testingProvider: LLMProviderType | null = $state(null);
  let testResults = $state<Record<LLMProviderType, { success: boolean; message: string } | null>>({
    gemini: null,
    openai: null,
    anthropic: null,
    kimi: null,
    openrouter: null,
  });
  
  const providers: LLMProviderType[] = ["gemini", "openai", "anthropic", "kimi", "openrouter"];
  const videoProviders: LLMProviderType[] = ["gemini", "kimi"];
  
  async function handleTestProvider(provider: LLMProviderType) {
    testingProvider = provider;
    testResults[provider] = null;
    
    try {
      const isWorking = await testProvider(provider);
      testResults[provider] = {
        success: isWorking,
        message: isWorking ? "API key is valid!" : "API key is invalid or missing",
      };
    } catch (error) {
      testResults[provider] = {
        success: false,
        message: error instanceof Error ? error.message : "Test failed",
      };
    } finally {
      testingProvider = null;
    }
  }
  
  async function handleApiKeyChange(provider: LLMProviderType, value: string) {
    await updateApiKey(provider, value);
    // Clear test result when key changes
    testResults[provider] = null;
  }
  
  async function handleSave() {
    await saveSettings();
    closeSettings();
  }
  
  async function handleReset() {
    if (confirm("Are you sure you want to reset all settings to defaults? This will clear all API keys.")) {
      await resetSettings();
    }
  }
  
  function maskApiKey(key: string): string {
    if (key.length <= 8) return key.slice(0, 2) + "•".repeat(key.length - 4) + key.slice(-2);
    return key.slice(0, 4) + "•".repeat(key.length - 8) + key.slice(-4);
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeSettings();
    }
  }

  function handleOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettings();
    }
  }
</script>

{#if settingsState.isSettingsOpen}
  <div
    class="settings-overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleOverlayKeydown}
  >
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={closeSettings}>×</button>
      </div>
      
      <div class="settings-content scrollbar-thin">
        <!-- API Keys Section -->
        <section class="settings-section">
          <h3>AI Provider API Keys</h3>
          <p class="section-description">
            Configure your API keys for AI providers. Keys are stored locally on your device.
          </p>
          
          <div class="providers-list">
            {#each providers as provider}
              {@const isVideoProvider = supportsVideo(provider)}
              <div class="provider-card">
                <div class="provider-header">
                  <div class="provider-info">
                    <span class="provider-name">{getProviderLabel(provider)}</span>
                    {#if isVideoProvider}
                      <span class="video-badge">Video</span>
                    {/if}
                  </div>
                  <button 
                    class="test-btn"
                    onclick={() => handleTestProvider(provider)}
                    disabled={testingProvider === provider || !settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                  >
                    {#if testingProvider === provider}
                      Testing...
                    {:else}
                      Test
                    {/if}
                  </button>
                </div>
                
                <div class="api-key-input">
                  <input
                    type="password"
                    value={settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                    oninput={(e) => handleApiKeyChange(provider, e.currentTarget.value)}
                    placeholder={`Enter ${getProviderLabel(provider)} API key`}
                  />
                  {#if settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                    <span class="key-status configured"><Icon icon={CheckCircle2} size={12} /></span>
                  {:else}
                    <span class="key-status not-configured"><Icon icon={Circle} size={12} /></span>
                  {/if}
                </div>
                
                {#if testResults[provider]}
                  <div class="test-result" class:success={testResults[provider]?.success} class:error={!testResults[provider]?.success}>
                    {testResults[provider]?.message}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
        
        <!-- Default Provider Selection -->
        <section class="settings-section">
          <h3>Default Providers</h3>
          
          <div class="select-group">
            <label for="video-provider">Default Video Provider:</label>
            <select id="video-provider" bind:value={settingsState.settings.defaultVideoProvider}>
              {#each videoProviders as provider}
                {@const apiKey = settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                <option value={provider} disabled={!apiKey}>
                  {getProviderLabel(provider)} {!apiKey ? "(no API key)" : ""}
                </option>
              {/each}
            </select>
            <p class="help-text">Used for video analysis in the chat panel</p>
          </div>
          
          <div class="select-group">
            <label for="text-provider">Default Text Provider:</label>
            <select id="text-provider" bind:value={settingsState.settings.defaultTextProvider}>
              {#each providers as provider}
                {@const apiKey = settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                <option value={provider} disabled={!apiKey}>
                  {getProviderLabel(provider)} {!apiKey ? "(no API key)" : ""}
                </option>
              {/each}
            </select>
            <p class="help-text">Used for text-based analysis and chat</p>
          </div>
        </section>
        
        <!-- Application Preferences -->
        <section class="settings-section">
          <h3>Application Preferences</h3>
          
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                bind:checked={settingsState.settings.autoGenerateProxies}
              />
              Auto-generate proxy videos for AI analysis
            </label>
            <p class="help-text">Creates low-resolution proxies (640px, 5fps) when importing videos</p>
          </div>
          
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                bind:checked={settingsState.settings.proxyGenerationOnImport}
              />
              Start proxy generation immediately on import
            </label>
            <p class="help-text">If disabled, proxies are generated only when needed for analysis</p>
          </div>
        </section>
        
        <!-- Chapter Settings -->
        <section class="settings-section">
          <h3>Chapter Settings</h3>
          
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                bind:checked={settingsState.settings.autoChapterNamingEnabled}
              />
              Auto-generate chapter names from transcripts
            </label>
            <p class="help-text">Uses AI to create descriptive titles based on chapter content</p>
          </div>
          
          <div class="select-group">
            <label for="chapter-naming-model">Chapter Naming Model:</label>
            <select id="chapter-naming-model" bind:value={settingsState.settings.autoChapterNamingModel}>
              <option value="gpt-4o-mini">GPT-4o Mini (faster)</option>
              <option value="gpt-4o">GPT-4o (more accurate)</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (cheapest)</option>
            </select>
            <p class="help-text">AI model used for generating chapter titles</p>
          </div>

          <div class="checkbox-group">
            <label>
              <input
                type="checkbox"
                bind:checked={settingsState.settings.autoClipNamingEnabled}
              />
              Auto-name manually created clips
            </label>
            <p class="help-text">Uses a small text model and transcript context when creating clips manually</p>
          </div>

          <div class="select-group">
            <label for="clip-naming-model">Clip Naming Model:</label>
            <select id="clip-naming-model" bind:value={settingsState.settings.autoClipNamingModel}>
              <option value="gpt-5-nano">GPT-5 Nano (smallest)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (fallback)</option>
            </select>
            <p class="help-text">Requires an OpenAI API key</p>
          </div>
           
          <div class="checkbox-group">
            <label>
              <input 
                type="checkbox" 
                bind:checked={settingsState.settings.autoTranscribeOnImport}
              />
              Auto-transcribe chapters on import
            </label>
            <p class="help-text">Automatically start transcription when chapters are created</p>
          </div>
        </section>
      </div>
      
      <div class="settings-footer">
        <button class="reset-btn" onclick={handleReset}>Reset to Defaults</button>
        <div class="footer-actions">
          <button class="cancel-btn" onclick={closeSettings}>Cancel</button>
          <button class="save-btn" onclick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .settings-panel {
    background: var(--surface-raised);
    border-radius: var(--radius-lg);
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  
  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--border-default);
  }
  
  .settings-header h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-xl);
  }
  
  .close-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }
  
  .close-btn:hover {
    background: var(--surface-active);
    color: var(--text-primary);
  }
  
  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6);
  }
  
  .settings-section {
    margin-bottom: var(--space-8);
  }
  
  .settings-section h3 {
    margin: 0 0 var(--space-3) 0;
    color: var(--text-primary);
    font-size: var(--text-md);
  }
  
  .section-description {
    color: var(--text-tertiary);
    font-size: var(--text-base);
    margin: 0 0 var(--space-4) 0;
  }
  
  .providers-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  
  .provider-card {
    background: var(--surface-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  
  .provider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
  }
  
  .provider-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .provider-name {
    color: var(--text-primary);
    font-weight: 500;
  }
  
  .video-badge {
    background: var(--accent-success);
    color: #000;
    font-size: 0.625rem;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-weight: 600;
    text-transform: uppercase;
  }
  
  .test-btn {
    background: var(--surface-active);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    padding: 0.25rem var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  
  .test-btn:hover:not(:disabled) {
    background: #444;
  }
  
  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .api-key-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .api-key-input input {
    flex: 1;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    font-family: monospace;
  }
  
  .api-key-input input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .key-status {
    font-size: var(--text-sm);
  }
  
  .key-status.configured {
    color: var(--accent-success);
  }
  
  .key-status.not-configured {
    color: var(--text-disabled);
  }
  
  .test-result {
    margin-top: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }
  
  .test-result.success {
    background: rgba(74, 222, 128, 0.1);
    color: var(--accent-success);
  }
  
  .test-result.error {
    background: rgba(248, 113, 113, 0.1);
    color: var(--accent-destructive);
  }
  
  .select-group {
    margin-bottom: var(--space-4);
  }
  
  .select-group label {
    display: block;
    color: var(--text-secondary);
    font-size: var(--text-base);
    margin-bottom: var(--space-2);
  }
  
  .select-group select {
    width: 100%;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
  }
  
  .select-group select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .checkbox-group {
    margin-bottom: var(--space-4);
  }
  
  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--text-base);
    cursor: pointer;
  }
  
  .checkbox-group input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-primary);
  }
  
  .help-text {
    margin: 0.25rem 0 0 var(--space-6);
    color: var(--text-disabled);
    font-size: var(--text-sm);
  }
  
  .settings-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-default);
  }
  
  .reset-btn {
    background: none;
    border: none;
    color: var(--accent-destructive);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: var(--space-2);
  }
  
  .reset-btn:hover {
    text-decoration: underline;
  }
  
  .footer-actions {
    display: flex;
    gap: var(--space-3);
  }
  
  .cancel-btn {
    background: var(--surface-active);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
  }
  
  .cancel-btn:hover {
    background: #444;
  }
  
  .save-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: 500;
  }
  
  .save-btn:hover {
    background: var(--accent-primary-hover);
  }
</style>
