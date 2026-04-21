<script lang="ts">
  import { EXPORT_FORMATS, type ExportFormat } from '../../../pipeline/export/index';
  import { timelineState, getTotalDuration } from '../state/timeline.svelte';
  import { projects } from '../state/project.svelte';
  import Button from './ui/Button.svelte';
  import ProgressBar from './ui/ProgressBar.svelte';

  interface Props {
    onExport?: (format: ExportFormat, filePath: string, frameRate: number, includeAudio: boolean) => Promise<void>;
  }

  let { onExport }: Props = $props();

  let selectedFormat = $state<ExportFormat>('fcpxml');
  let frameRate = $state(30);
  let includeAudio = $state(true);
  let isExporting = $state(false);
  let exportProgress = $state(0);
  let exportError = $state<string | null>(null);
  let exportSuccess = $state<string | null>(null);

  const projectName = $derived.by(() => {
    const selected = projects.items.find((p) => p.id === timelineState.projectId);
    return selected?.name || 'untitled';
  });

  const formatConfig = $derived.by(() => {
    return EXPORT_FORMATS.find((f) => f.value === selectedFormat);
  });

  function handleFormatChange(event: Event) {
    selectedFormat = (event.target as HTMLSelectElement).value as ExportFormat;
    exportError = null;
    exportSuccess = null;
  }

  async function handleExport() {
    if (!formatConfig || !onExport) {
      console.warn('Export handler not provided or format not selected');
      return;
    }

    const suggestedFilename = `${projectName}${formatConfig.extension}`;

    isExporting = true;
    exportProgress = 0;
    exportError = null;
    exportSuccess = null;

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const filePath = suggestedFilename;

      progressInterval = setInterval(() => {
        exportProgress = Math.min(exportProgress + 10, 90);
      }, 100);

      await onExport(selectedFormat, filePath, frameRate, includeAudio);

      exportProgress = 100;
      exportSuccess = `Exported to ${filePath}`;
    } catch (error) {
      exportError = (error as Error).message || 'Export failed';
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      isExporting = false;
    }
  }

  const frameRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
</script>

<div class="scrollbar-thin min-w-[280px] border-t border-border-default bg-surface-raised p-4">
  <h3 class="mb-4 text-app-sm uppercase tracking-[0.05em] text-text-primary">Export Timeline</h3>

  <div class="mb-4">
    <label class="mb-1 block text-[0.75rem] uppercase tracking-[0.05em] text-text-tertiary" for="format">Export Format</label>
    <select class="w-full rounded-sm border border-border-strong bg-surface-elevated px-2 py-2 text-app-sm text-text-secondary" id="format" value={selectedFormat} onchange={handleFormatChange} disabled={isExporting}>
      {#each EXPORT_FORMATS as format (format.value)}
        <option value={format.value}>{format.label}</option>
      {/each}
    </select>
    <p class="mt-1 text-[0.75rem] italic text-text-disabled">{formatConfig?.description}</p>
  </div>

  <div class="mb-4">
    <label class="mb-1 block text-[0.75rem] uppercase tracking-[0.05em] text-text-tertiary" for="framerate">Frame Rate</label>
    <select class="w-full rounded-sm border border-border-strong bg-surface-elevated px-2 py-2 text-app-sm text-text-secondary" id="framerate" bind:value={frameRate} disabled={isExporting}>
      {#each frameRates as rate (rate)}
        <option value={rate}>{rate} fps</option>
      {/each}
    </select>
  </div>

  <div class="mb-4 flex items-center">
    <label class="flex cursor-pointer items-center gap-2 text-app-base text-text-secondary">
      <input class="h-4 w-4 rounded border border-border-strong bg-surface-elevated" type="checkbox" bind:checked={includeAudio} disabled={isExporting} />
      Include audio tracks
    </label>
  </div>

  <div class="mb-4 rounded-sm bg-surface-elevated p-3">
    <div class="mb-1 flex justify-between text-app-sm text-text-tertiary">
      <span>Project:</span>
      <span class="font-mono text-text-secondary">{projectName}</span>
    </div>
    <div class="mb-1 flex justify-between text-app-sm text-text-tertiary">
      <span>Clips:</span>
      <span class="font-mono text-text-secondary">{timelineState.clips.length}</span>
    </div>
    <div class="flex justify-between text-app-sm text-text-tertiary">
      <span>Duration:</span>
      <span class="font-mono text-text-secondary">{getTotalDuration().toFixed(2)}s</span>
    </div>
  </div>

  {#if isExporting}
    <div class="mb-4">
      <ProgressBar value={exportProgress} />
      <span class="mt-2 block text-[0.75rem] text-text-tertiary">Exporting... {Math.round(exportProgress)}%</span>
    </div>
  {/if}

  {#if exportError}
    <div class="mb-4 rounded-sm border border-red-500 bg-red-500/10 p-3 text-app-sm text-red-500">
      <p class="m-0">{exportError}</p>
    </div>
  {/if}

  {#if exportSuccess}
    <div class="mb-4 rounded-sm border border-green-500 bg-green-500/10 p-3 text-app-sm text-green-500">
      <p class="m-0">{exportSuccess}</p>
    </div>
  {/if}

  <Button
    class="w-full justify-center py-3"
    variant="primary"
    onclick={handleExport}
    disabled={isExporting || !onExport || timelineState.clips.length === 0}
  >
    {isExporting ? 'Exporting...' : 'Export Timeline'}
  </Button>
</div>
