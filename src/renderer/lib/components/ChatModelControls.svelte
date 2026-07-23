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

  let root = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let query = $state('');
  let browsingProvider = $state<LLMProviderType>('gemini');
  const configuredProviders = $derived(getConfiguredProviders(settingsState.settings));
  const availableProviders = $derived(configuredProviders.length > 0 ? configuredProviders : [provider]);
  const browsingModels = $derived(getModelsForProvider(browsingProvider));
  const filteredModels = $derived(
    browsingModels.filter((candidate) =>
      !query.trim() || `${candidate.label} ${candidate.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    )
  );
  const selectedModel = $derived(
    getModelsForProvider(provider).find((candidate) => candidate.id === model)
  );
  const reasoningEfforts = $derived(selectedModel?.reasoningEfforts ?? []);
  const displayedReasoningEffort = $derived(
    reasoningEffort ?? (reasoningEfforts.includes('medium') ? 'medium' : reasoningEfforts[0])
  );
  const modelLabel = $derived(selectedModel?.label ?? model);

  $effect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root && event.target instanceof Node && !root.contains(event.target)) open = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  function togglePicker() {
    if (disabled) return;
    open = !open;
    browsingProvider = provider;
    query = '';
    if (open) void loadProviderModels(provider);
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
    open = false;
  }
</script>

<div class="relative flex min-w-0 items-center gap-1.5" bind:this={root} data-chat-model-controls>
  <button
    type="button"
    class="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-app-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
    onclick={togglePicker}
    {disabled}
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
      value={displayedReasoningEffort}
      onchange={(event) => onchange(provider, model, event.currentTarget.value as ReasoningEffort)}
      {disabled}
      title="Reasoning level"
    >
      {#each reasoningEfforts as effort (effort)}
        <option value={effort}>Reasoning: {effort[0].toUpperCase()}{effort.slice(1)}</option>
      {/each}
    </select>
  {/if}

  {#if open}
    <div class="absolute bottom-[calc(100%+8px)] left-0 z-[var(--z-float)] flex max-h-[26rem] w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-[0_12px_36px_rgba(0,0,0,0.32)]">
      <div class="flex gap-1 overflow-x-auto border-b border-border-subtle p-2">
        {#each availableProviders as candidateProvider (candidateProvider)}
          <button type="button" class="shrink-0 rounded-md px-2 py-1 text-app-xs" class:bg-accent-primary-subtle={candidateProvider === browsingProvider} class:text-accent-primary={candidateProvider === browsingProvider} class:text-text-tertiary={candidateProvider !== browsingProvider} onclick={() => browse(candidateProvider)}>{getProviderLabel(candidateProvider)}</button>
        {/each}
      </div>
      <div class="border-b border-border-subtle p-2">
        <input class="h-8 w-full rounded-md border border-border-default bg-surface-base px-2.5 text-app-sm text-text-primary outline-none focus:border-border-strong" bind:value={query} placeholder="Search models" aria-label="Search models" />
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
              {#if candidate.compatibility === 'unknown'}<span class="shrink-0 text-[10px] text-accent-warning">Compatibility unknown</span>{/if}
            </button>
          {/each}
        {/if}
      </div>
      <div class="flex items-center justify-between border-t border-border-subtle px-2 py-1.5">
        <span class="truncate text-[10px] text-accent-warning">{modelCatalogState.errors[browsingProvider] ?? ''}</span>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={() => void loadProviderModels(browsingProvider, true)}><Icon icon={RotateCcw} size={11} /> Refresh</button>
          <button type="button" class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={() => { open = false; void openSettings(); }}><Icon icon={Settings} size={11} /> Providers</button>
        </div>
      </div>
    </div>
  {/if}
</div>
