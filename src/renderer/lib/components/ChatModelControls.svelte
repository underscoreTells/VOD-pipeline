<script lang="ts">
  import {
    getProviderLabel,
    type LLMProviderType,
    type ReasoningEffort,
  } from '../../../shared/llm/provider-registry.js';
  import { openSettings, settingsState } from '../state/settings.svelte.js';
  import { getConfiguredProviders } from '../state/settings-helpers.js';
  import {
    getModelsForProvider,
    loadProviderModels,
    modelCatalogState,
  } from '../state/model-catalog.svelte.js';
  import { ChevronDown, RotateCcw, Settings } from '../constants.js';
  import Icon from './ui/Icon.svelte';

  let { provider, model, reasoningEffort, disabled = false, onchange }: {
    provider: LLMProviderType;
    model: string;
    reasoningEffort: ReasoningEffort | null;
    disabled?: boolean;
    onchange: (provider: LLMProviderType, model: string, reasoningEffort: ReasoningEffort | null) => void;
  } = $props();

  const PICKER_ID = 'chat-model-picker';
  let trigger = $state<HTMLButtonElement | null>(null);
  let picker = $state<HTMLDivElement | null>(null);
  let searchInput = $state<HTMLInputElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let browsingProvider = $state<LLMProviderType>('gemini');
  let pickerStyle = $state('');
  const availableProviders = $derived(getConfiguredProviders(settingsState.settings));
  const browsingModels = $derived(
    availableProviders.includes(browsingProvider)
      ? getModelsForProvider(browsingProvider)
      : []
  );
  const filteredModels = $derived(
    browsingModels.filter((candidate) =>
      !query.trim() || `${candidate.label} ${candidate.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    )
  );
  const selectedModel = $derived(
    getModelsForProvider(provider).find((candidate) => candidate.id === model)
  );
  const reasoningEfforts = $derived(selectedModel?.reasoningEfforts ?? []);
  const modelLabel = $derived(selectedModel?.label ?? model);

  $effect(() => {
    if (!open) return;
    const reposition = () => positionPicker();
    const dismissOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || picker?.contains(target) || trigger?.contains(target)) return;
      closePicker();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePicker(true);
    };
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', dismissOnPointerDown, true);
    document.addEventListener('keydown', dismissOnEscape, true);
    requestAnimationFrame(() => {
      positionPicker();
      searchInput?.focus();
    });
    return () => {
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', dismissOnPointerDown, true);
      document.removeEventListener('keydown', dismissOnEscape, true);
    };
  });

  function positionPicker() {
    if (!trigger) return;
    const viewportMargin = 8;
    const gap = 8;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(0, Math.min(352, window.innerWidth - viewportMargin * 2));
    const left = Math.min(
      Math.max(viewportMargin, rect.left),
      Math.max(viewportMargin, window.innerWidth - width - viewportMargin)
    );
    const spaceAbove = Math.max(0, rect.top - gap - viewportMargin);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportMargin);
    const placeAbove = spaceAbove >= 240 || spaceAbove >= spaceBelow;
    const maxHeight = Math.min(416, placeAbove ? spaceAbove : spaceBelow);
    const verticalPosition = placeAbove
      ? `bottom:${Math.max(viewportMargin, window.innerHeight - rect.top + gap)}px;top:auto;`
      : `top:${Math.min(window.innerHeight - viewportMargin, rect.bottom + gap)}px;bottom:auto;`;
    pickerStyle = `position:fixed;left:${left}px;right:auto;${verticalPosition}width:${width}px;max-height:${maxHeight}px;margin:0;`;
  }

  function handlePickerToggle(event: ToggleEvent) {
    open = event.newState === 'open';
  }

  function closePicker(restoreFocus = false) {
    if (picker?.matches(':popover-open')) picker.hidePopover();
    if (restoreFocus) requestAnimationFrame(() => trigger?.focus());
  }

  function togglePicker() {
    if (disabled || !picker) return;
    if (picker.matches(':popover-open')) {
      closePicker();
      return;
    }
    browsingProvider = availableProviders.includes(provider)
      ? provider
      : availableProviders[0] ?? settingsState.settings.defaultVideoProvider;
    query = '';
    if (availableProviders.includes(browsingProvider)) void loadProviderModels(browsingProvider);
    picker.showPopover();
  }

  function browse(nextProvider: LLMProviderType) {
    browsingProvider = nextProvider;
    query = '';
    void loadProviderModels(nextProvider);
  }

  function chooseModel(nextProvider: LLMProviderType, nextModel: string) {
    const candidate = getModelsForProvider(nextProvider).find((item) => item.id === nextModel);
    const efforts = candidate?.reasoningEfforts ?? [];
    const nextEffort = reasoningEffort && efforts.includes(reasoningEffort)
      ? reasoningEffort
      : efforts.includes('medium')
        ? 'medium'
        : efforts[0] ?? null;
    onchange(nextProvider, nextModel, nextEffort);
    closePicker(true);
  }
</script>

<div class="relative flex min-w-0 items-center gap-1.5" data-chat-model-controls>
  <button
    type="button"
    class="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-app-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
    onclick={togglePicker}
    bind:this={trigger}
    {disabled}
    aria-expanded={open}
    aria-controls={PICKER_ID}
    aria-haspopup="dialog"
    title={`${getProviderLabel(provider)} · ${modelLabel}`}
  >
    <span class="truncate">{getProviderLabel(provider)} · {modelLabel}</span>
    <Icon icon={ChevronDown} size={11} class="shrink-0" />
  </button>

  {#if reasoningEfforts.length > 0}
    <label class="sr-only" for="chat-reasoning-effort">Reasoning level</label>
    <select
      id="chat-reasoning-effort"
      class="h-7 rounded-md border-0 bg-transparent px-1.5 text-app-xs text-text-tertiary outline-none hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
      value={reasoningEffort ?? ''}
      onchange={(event) => onchange(
        provider,
        model,
        event.currentTarget.value ? event.currentTarget.value as ReasoningEffort : null
      )}
      {disabled}
      title="Reasoning level"
    >
      <option value="">Reasoning: Default</option>
      {#each reasoningEfforts as effort (effort)}
        <option value={effort}>Reasoning: {effort[0].toUpperCase()}{effort.slice(1)}</option>
      {/each}
    </select>
  {/if}

  <div
    id={PICKER_ID}
    popover="manual"
    bind:this={picker}
    ontoggle={handlePickerToggle}
    style={pickerStyle}
    class="model-picker z-[var(--z-float)] min-h-0 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-elevated p-0 text-text-primary shadow-[0_12px_36px_rgba(0,0,0,0.32)]"
    role="dialog"
    aria-label="Choose a chat model"
  >
    {#if availableProviders.length === 0}
      <div class="px-4 py-8 text-center">
        <div class="text-app-sm font-medium text-text-primary">No chat provider configured</div>
        <div class="mt-1 text-app-xs text-text-tertiary">Configure a provider to choose a model.</div>
      </div>
    {:else}
      <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle p-2">
        {#each availableProviders as candidateProvider (candidateProvider)}
          <button type="button" class="shrink-0 rounded-md px-2 py-1 text-app-xs" class:bg-accent-primary-subtle={candidateProvider === browsingProvider} class:text-accent-primary={candidateProvider === browsingProvider} class:text-text-tertiary={candidateProvider !== browsingProvider} onclick={() => browse(candidateProvider)}>{getProviderLabel(candidateProvider)}</button>
        {/each}
      </div>
      <div class="shrink-0 border-b border-border-subtle p-2">
        <input class="h-8 w-full rounded-md border border-border-default bg-surface-base px-2.5 text-app-sm text-text-primary outline-none focus:border-border-strong" bind:this={searchInput} bind:value={query} placeholder="Search chat models" aria-label="Search chat models" />
      </div>
      <div class="scrollbar-thin min-h-20 flex-1 overflow-y-auto p-1.5">
        {#if modelCatalogState.loadingProvider === browsingProvider && browsingModels.length === 0}
          <div class="space-y-1.5 p-2" aria-label="Loading models"><div class="h-8 animate-pulse rounded-md bg-surface-hover"></div><div class="h-8 animate-pulse rounded-md bg-surface-hover"></div></div>
        {:else if filteredModels.length === 0}
          <div class="px-3 py-6 text-center text-app-xs text-text-tertiary">No matching chat models</div>
        {:else}
          {#each filteredModels as candidate (candidate.id)}
            <button type="button" class="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-hover" class:bg-accent-primary-subtle={provider === browsingProvider && model === candidate.id} onclick={() => chooseModel(browsingProvider, candidate.id)}>
              <span class="min-w-0"><span class="block truncate text-app-sm font-medium text-text-primary">{candidate.label}</span><span class="block truncate font-mono text-[10px] text-text-disabled">{candidate.id}</span></span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
      <div class="flex shrink-0 items-center justify-between border-t border-border-subtle px-2 py-1.5">
        <span class="truncate text-[10px] text-accent-warning">{modelCatalogState.errors[browsingProvider] ?? ''}</span>
        <div class="flex shrink-0 items-center gap-1">
          {#if availableProviders.length > 0}<button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={() => void loadProviderModels(browsingProvider, true)}><Icon icon={RotateCcw} size={11} /> Refresh</button>{/if}
          <button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={() => { closePicker(); void openSettings(); }}><Icon icon={Settings} size={11} /> Providers</button>
        </div>
      </div>
  </div>
</div>

<style>
  .model-picker:not(:popover-open) {
    display: none !important;
  }

  .model-picker:popover-open {
    display: flex !important;
  }
</style>
