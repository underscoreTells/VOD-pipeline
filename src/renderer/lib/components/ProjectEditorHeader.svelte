<script lang="ts">
  import { openSettings } from '../state/settings.svelte';
  import { themeState, toggleTheme } from '../state/theme.svelte';
  import { ArrowLeft, FolderPlus, Moon, Settings, Share, Sun, Video } from '../constants';
  import Button from './ui/Button.svelte';
  import Icon from './ui/Icon.svelte';
  import IconButton from './ui/IconButton.svelte';

  interface Props {
    projectName: string;
    showImportMore: boolean;
    onBack: () => void;
    onImportMore: () => void;
    onExport: () => void;
  }

  let {
    projectName,
    showImportMore,
    onBack,
    onImportMore,
    onExport,
  }: Props = $props();
</script>

<header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-page px-4 py-2.5 md:px-5">
  <div class="header-left min-w-0 flex flex-1 items-center gap-2.5">
    <div class="brand-lockup flex shrink-0 items-center gap-2.5">
      <div class="flex h-7 w-7 items-center justify-center rounded-md border border-border-default bg-surface-raised">
        <Icon icon={Video} size={14} class="text-text-primary" />
      </div>
      <span class="text-app-base font-semibold tracking-tight text-text-primary max-[720px]:hidden">VOD Pipeline</span>
    </div>

    <div class="h-5 w-px shrink-0 bg-border-default"></div>

    <Button variant="ghost" size="sm" icon={ArrowLeft} class="shrink-0" onclick={onBack}>
      Back
    </Button>

    <div class="min-w-0 flex-1">
      <h1 class="min-w-0 truncate text-app-base font-semibold tracking-tight text-text-primary md:text-app-md" title={projectName}>
        {projectName}
      </h1>
    </div>
  </div>

  <div class="header-actions flex shrink-0 items-center gap-2 max-[980px]:w-full max-[980px]:justify-end">
    {#if showImportMore}
      <Button variant="secondary" size="sm" icon={FolderPlus} onclick={onImportMore}>
        Import More
      </Button>
    {/if}

    <Button variant="primary" size="sm" icon={Share} onclick={onExport}>
      Export
    </Button>

    <div class="h-5 w-px shrink-0 bg-border-default"></div>

    <IconButton
      icon={themeState.current === 'dark' ? Sun : Moon}
      size={15}
      onclick={toggleTheme}
      title="Toggle theme"
      class="h-8 w-8 rounded-md border border-border-default bg-surface-base text-text-secondary hover:bg-surface-hover hover:text-text-primary"
    />

    <Button
      variant="ghost"
      size="sm"
      icon={Settings}
      onclick={openSettings}
      class="h-8 border border-border-default bg-surface-base px-3 hover:bg-surface-hover"
    >
      Settings
    </Button>
  </div>
</header>
