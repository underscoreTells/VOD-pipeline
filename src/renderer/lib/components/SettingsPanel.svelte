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
</script>

{#if settingsState.isSettingsOpen}
  <div class="settings-overlay" onclick={closeSettings}>
    <div class="settings-panel" onclick={(e) => e.stopPropagation()}>
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={closeSettings}>×</button>
      </div>
      
      <div class="settings-content">
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
                    <span class="key-status configured">●</span>
                  {:else}
                    <span class="key-status not-configured">○</span>
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
    background: #1e1e1e;
    border-radius: 8px;
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
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #333;
  }
  
  .settings-header h2 {
    margin: 0;
    color: #fff;
    font-size: 1.25rem;
  }
  
  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  
  .close-btn:hover {
    background: #333;
    color: #fff;
  }
  
  .settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }
  
  .settings-section {
    margin-bottom: 2rem;
  }
  
  .settings-section h3 {
    margin: 0 0 0.75rem 0;
    color: #fff;
    font-size: 1rem;
  }
  
  .section-description {
    color: #888;
    font-size: 0.875rem;
    margin: 0 0 1rem 0;
  }
  
  .providers-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .provider-card {
    background: #252525;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 1rem;
  }
  
  .provider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  
  .provider-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .provider-name {
    color: #fff;
    font-weight: 500;
  }
  
  .video-badge {
    background: #4ade80;
    color: #000;
    font-size: 0.625rem;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
  }
  
  .test-btn {
    background: #333;
    color: #fff;
    border: 1px solid #444;
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    border-radius: 4px;
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
    gap: 0.5rem;
  }
  
  .api-key-input input {
    flex: 1;
    background: #1e1e1e;
    border: 1px solid #444;
    color: #fff;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
    font-family: monospace;
  }
  
  .api-key-input input:focus {
    outline: none;
    border-color: #2563eb;
  }
  
  .key-status {
    font-size: 0.75rem;
  }
  
  .key-status.configured {
    color: #4ade80;
  }
  
  .key-status.not-configured {
    color: #666;
  }
  
  .test-result {
    margin-top: 0.5rem;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
  }
  
  .test-result.success {
    background: rgba(74, 222, 128, 0.1);
    color: #4ade80;
  }
  
  .test-result.error {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
  }
  
  .select-group {
    margin-bottom: 1rem;
  }
  
  .select-group label {
    display: block;
    color: #ccc;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }
  
  .select-group select {
    width: 100%;
    background: #1e1e1e;
    border: 1px solid #444;
    color: #fff;
    padding: 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }
  
  .select-group select:focus {
    outline: none;
    border-color: #2563eb;
  }
  
  .checkbox-group {
    margin-bottom: 1rem;
  }
  
  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #ccc;
    font-size: 0.875rem;
    cursor: pointer;
  }
  
  .checkbox-group input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: #2563eb;
  }
  
  .help-text {
    margin: 0.25rem 0 0 1.5rem;
    color: #666;
    font-size: 0.75rem;
  }
  
  .settings-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid #333;
  }
  
  .reset-btn {
    background: none;
    border: none;
    color: #f87171;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.5rem;
  }
  
  .reset-btn:hover {
    text-decoration: underline;
  }
  
  .footer-actions {
    display: flex;
    gap: 0.75rem;
  }
  
  .cancel-btn {
    background: #333;
    color: #fff;
    border: 1px solid #444;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }
  
  .cancel-btn:hover {
    background: #444;
  }
  
  .save-btn {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }
  
  .save-btn:hover {
    background: #1d4ed8;
  }
</style>
