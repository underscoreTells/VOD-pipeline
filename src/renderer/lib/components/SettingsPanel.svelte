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
    class="settings-overlay fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/60"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleOverlayKeydown}
  >
    <div class="settings-panel flex max-h-[90vh] w-[90%] max-w-[600px] flex-col rounded-md border border-border-default bg-surface-base">
      <div class="settings-header flex items-center justify-between border-b border-border-default px-[18px] py-[14px]">
        <h2 class="m-0 text-app-lg font-semibold text-text-primary">Settings</h2>
        <button class="inline-flex h-7 w-7 items-center justify-center rounded-[4px] bg-transparent p-0 text-[1.25rem] text-text-tertiary transition-all hover:bg-surface-hover hover:text-text-primary" onclick={closeSettings}>×</button>
      </div>
      
      <div class="settings-content scrollbar-thin flex-1 overflow-y-auto px-6 py-5">
        <!-- API Keys Section -->
        <section class="settings-section mb-8 last:mb-0">
          <h3 class="mb-3 mt-0 text-app-base font-semibold text-text-primary">AI Provider API Keys</h3>
          <p class="section-description mb-4 mt-0 text-app-sm leading-[1.5] text-text-tertiary">
            Configure your API keys for AI providers. Keys are stored locally on your device.
          </p>
          
          <div class="providers-list flex flex-col rounded-[4px] border border-border-default">
            {#each providers as provider (provider)}
              {@const isVideoProvider = supportsVideo(provider)}
              <div class="provider-card border-b border-border-subtle bg-transparent p-4 last:border-b-0">
                <div class="provider-header mb-3 flex items-center justify-between">
                  <div class="provider-info flex items-center gap-2">
                    <span class="provider-name text-app-sm font-medium text-text-primary">{getProviderLabel(provider)}</span>
                    {#if isVideoProvider}
                      <span class="video-badge rounded-[4px] bg-accent-success-subtle px-1.5 py-0.5 text-app-xs font-medium uppercase text-accent-success">Video</span>
                    {/if}
                  </div>
                  <button 
                    class="rounded-[4px] border border-border-default bg-transparent px-2.5 py-1 text-app-xs font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
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
                
                <div class="api-key-input flex items-center gap-2">
                  <input
                    class="flex-1 rounded-[4px] border border-border-default bg-surface-raised px-2.5 py-2 font-mono text-app-sm text-text-primary transition-colors focus:border-accent-primary"
                    type="password"
                    value={settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                    oninput={(e) => handleApiKeyChange(provider, e.currentTarget.value)}
                    placeholder={`Enter ${getProviderLabel(provider)} API key`}
                  />
                  {#if settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                    <span class="key-status text-app-sm text-accent-success"><Icon icon={CheckCircle2} size={12} /></span>
                  {:else}
                    <span class="key-status text-app-sm text-text-tertiary"><Icon icon={Circle} size={12} /></span>
                  {/if}
                </div>
                
                {#if testResults[provider]}
                  <div
                    class="test-result mt-2 rounded-[4px] px-2.5 py-1.5 text-app-xs font-medium"
                    class:bg-accent-success-subtle={Boolean(testResults[provider]?.success)}
                    class:text-accent-success={Boolean(testResults[provider]?.success)}
                    class:bg-accent-destructive={!testResults[provider]?.success}
                    class:text-white={!testResults[provider]?.success}
                    class:opacity-90={!testResults[provider]?.success}
                  >
                    {testResults[provider]?.message}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
        
        <!-- Default Provider Selection -->
        <section class="settings-section mb-8 last:mb-0">
          <h3 class="mb-3 mt-0 text-app-base font-semibold text-text-primary">Default Providers</h3>
          
          <div class="select-group mb-4">
            <label for="video-provider" class="mb-2 block text-app-sm font-medium text-text-secondary">Default Video Provider:</label>
            <select id="video-provider" class="w-full cursor-pointer rounded-[4px] border border-border-default bg-surface-raised px-2.5 py-2 text-app-sm text-text-primary transition-colors focus:border-accent-primary" bind:value={settingsState.settings.defaultVideoProvider}>
              {#each videoProviders as provider (provider)}
                {@const apiKey = settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                <option value={provider} disabled={!apiKey}>
                  {getProviderLabel(provider)} {!apiKey ? "(no API key)" : ""}
                </option>
              {/each}
            </select>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Used for video analysis in the chat panel</p>
          </div>
          
          <div class="select-group mb-4">
            <label for="text-provider" class="mb-2 block text-app-sm font-medium text-text-secondary">Default Text Provider:</label>
            <select id="text-provider" class="w-full cursor-pointer rounded-[4px] border border-border-default bg-surface-raised px-2.5 py-2 text-app-sm text-text-primary transition-colors focus:border-accent-primary" bind:value={settingsState.settings.defaultTextProvider}>
              {#each providers as provider (provider)}
                {@const apiKey = settingsState.settings[`${provider}ApiKey` as keyof typeof settingsState.settings]}
                <option value={provider} disabled={!apiKey}>
                  {getProviderLabel(provider)} {!apiKey ? "(no API key)" : ""}
                </option>
              {/each}
            </select>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Used for text-based analysis and chat</p>
          </div>
        </section>
        
        <!-- Application Preferences -->
        <section class="settings-section mb-8 last:mb-0">
          <h3 class="mb-3 mt-0 text-app-base font-semibold text-text-primary">Application Preferences</h3>
          
          <div class="checkbox-group mb-4">
            <label class="flex cursor-pointer items-center gap-2 text-app-sm font-medium text-text-secondary">
              <input 
                class="h-4 w-4 cursor-pointer accent-accent-primary"
                type="checkbox" 
                bind:checked={settingsState.settings.autoGenerateProxies}
              />
              Auto-generate proxy videos for AI analysis
            </label>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Creates low-resolution proxies (640px, 5fps) when importing videos</p>
          </div>
          
          <div class="checkbox-group mb-4">
            <label class="flex cursor-pointer items-center gap-2 text-app-sm font-medium text-text-secondary">
              <input 
                class="h-4 w-4 cursor-pointer accent-accent-primary"
                type="checkbox" 
                bind:checked={settingsState.settings.proxyGenerationOnImport}
              />
              Start proxy generation immediately on import
            </label>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">If disabled, proxies are generated only when needed for analysis</p>
          </div>
        </section>
        
        <!-- Chapter Settings -->
        <section class="settings-section mb-8 last:mb-0">
          <h3 class="mb-3 mt-0 text-app-base font-semibold text-text-primary">Chapter Settings</h3>
          
          <div class="checkbox-group mb-4">
            <label class="flex cursor-pointer items-center gap-2 text-app-sm font-medium text-text-secondary">
              <input 
                class="h-4 w-4 cursor-pointer accent-accent-primary"
                type="checkbox" 
                bind:checked={settingsState.settings.autoChapterNamingEnabled}
              />
              Auto-generate chapter names from transcripts
            </label>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Uses AI to create descriptive titles based on chapter content</p>
          </div>
          
          <div class="select-group mb-4">
            <label for="chapter-naming-model" class="mb-2 block text-app-sm font-medium text-text-secondary">Chapter Naming Model:</label>
            <select id="chapter-naming-model" class="w-full cursor-pointer rounded-[4px] border border-border-default bg-surface-raised px-2.5 py-2 text-app-sm text-text-primary transition-colors focus:border-accent-primary" bind:value={settingsState.settings.autoChapterNamingModel}>
              <option value="gpt-4o-mini">GPT-4o Mini (faster)</option>
              <option value="gpt-4o">GPT-4o (more accurate)</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (cheapest)</option>
            </select>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">AI model used for generating chapter titles</p>
          </div>

          <div class="checkbox-group mb-4">
            <label class="flex cursor-pointer items-center gap-2 text-app-sm font-medium text-text-secondary">
              <input
                class="h-4 w-4 cursor-pointer accent-accent-primary"
                type="checkbox"
                bind:checked={settingsState.settings.autoClipNamingEnabled}
              />
              Auto-name manually created clips
            </label>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Uses a small text model and transcript context when creating clips manually</p>
          </div>

          <div class="select-group mb-4">
            <label for="clip-naming-model" class="mb-2 block text-app-sm font-medium text-text-secondary">Clip Naming Model:</label>
            <select id="clip-naming-model" class="w-full cursor-pointer rounded-[4px] border border-border-default bg-surface-raised px-2.5 py-2 text-app-sm text-text-primary transition-colors focus:border-accent-primary" bind:value={settingsState.settings.autoClipNamingModel}>
              <option value="gpt-5-nano">GPT-5 Nano (smallest)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (fallback)</option>
            </select>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Requires an OpenAI API key</p>
          </div>
           
          <div class="checkbox-group mb-4">
            <label class="flex cursor-pointer items-center gap-2 text-app-sm font-medium text-text-secondary">
              <input 
                class="h-4 w-4 cursor-pointer accent-accent-primary"
                type="checkbox" 
                bind:checked={settingsState.settings.autoTranscribeOnImport}
              />
              Auto-transcribe chapters on import
            </label>
            <p class="help-text ml-6 mt-1 text-app-xs leading-[1.4] text-text-tertiary">Automatically start transcription when chapters are created</p>
          </div>
        </section>
      </div>
      
      <div class="settings-footer flex items-center justify-between border-t border-border-default px-[18px] py-[14px]">
        <button class="bg-none rounded-[4px] border-none px-2.5 py-1.5 text-app-sm font-medium text-accent-destructive transition-colors hover:bg-accent-destructive hover:text-white" onclick={handleReset}>Reset to Defaults</button>
        <div class="footer-actions flex gap-3">
          <button class="rounded-[4px] border border-border-default bg-transparent px-[14px] py-1.5 text-app-sm font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary" onclick={closeSettings}>Cancel</button>
          <button class="rounded-[4px] border-none bg-accent-primary px-[14px] py-1.5 text-app-sm font-medium text-white transition-colors hover:bg-accent-primary-hover" onclick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  </div>
{/if}
