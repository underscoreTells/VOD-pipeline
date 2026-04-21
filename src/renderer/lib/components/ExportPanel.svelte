<script lang="ts">
  import { EXPORT_FORMATS, type ExportFormat } from '../../../pipeline/export/index';
  import { timelineState, getTotalDuration } from '../state/timeline.svelte';
  import { projects } from '../state/project.svelte';
  
  interface Props {
    onExport?: (format: ExportFormat, filePath: string, frameRate: number, includeAudio: boolean) => Promise<void>;
  }
  
  let { onExport }: Props = $props();
  
  // State
  let selectedFormat = $state<ExportFormat>('fcpxml');
  let frameRate = $state(30);
  let includeAudio = $state(true);
  let isExporting = $state(false);
  let exportProgress = $state(0);
  let exportError = $state<string | null>(null);
  let exportSuccess = $state<string | null>(null);
  
  // Get current project name
  const projectName = $derived.by(() => {
    const selected = projects.items.find(p => p.id === timelineState.projectId);
    return selected?.name || 'untitled';
  });
  
  // Get selected format config
  const formatConfig = $derived.by(() => {
    return EXPORT_FORMATS.find(f => f.value === selectedFormat);
  });
  
  // Handle format change
  function handleFormatChange(event: Event) {
    selectedFormat = (event.target as HTMLSelectElement).value as ExportFormat;
    exportError = null;
    exportSuccess = null;
  }
  
  // Handle export
  async function handleExport() {
    if (!formatConfig || !onExport) {
      console.warn('Export handler not provided or format not selected');
      return;
    }

    // Show save dialog
    const suggestedFilename = `${projectName}${formatConfig.extension}`;

    isExporting = true;
    exportProgress = 0;
    exportError = null;
    exportSuccess = null;

    let progressInterval: ReturnType<typeof setInterval> | null = null;

    try {
      // For now, use a mock file path - in real implementation this would open a save dialog
      const filePath = suggestedFilename;

      // Simulate progress
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
  
  // Available frame rates
  const frameRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
</script>

<div class="export-panel scrollbar-thin">
  <h3>Export Timeline</h3>
  
  <div class="form-group">
    <label for="format">Export Format</label>
    <select id="format" value={selectedFormat} onchange={handleFormatChange} disabled={isExporting}>
      {#each EXPORT_FORMATS as format}
        <option value={format.value}>{format.label}</option>
      {/each}
    </select>
    <p class="help-text">{formatConfig?.description}</p>
  </div>
  
  <div class="form-group">
    <label for="framerate">Frame Rate</label>
    <select id="framerate" bind:value={frameRate} disabled={isExporting}>
      {#each frameRates as rate}
        <option value={rate}>{rate} fps</option>
      {/each}
    </select>
  </div>
  
  <div class="form-group checkbox">
    <label>
      <input type="checkbox" bind:checked={includeAudio} disabled={isExporting} />
      Include audio tracks
    </label>
  </div>
  
  <div class="export-info">
    <div class="info-row">
      <span>Project:</span>
      <span>{projectName}</span>
    </div>
    <div class="info-row">
      <span>Clips:</span>
      <span>{timelineState.clips.length}</span>
    </div>
    <div class="info-row">
      <span>Duration:</span>
      <span>{getTotalDuration().toFixed(2)}s</span>
    </div>
  </div>
  
  {#if isExporting}
    <div class="progress-section">
      <div class="progress-bar">
        <div class="progress-fill" style="width: {exportProgress}%"></div>
      </div>
      <span class="progress-text">Exporting... {Math.round(exportProgress)}%</span>
    </div>
  {/if}
  
  {#if exportError}
    <div class="alert error">
      <p>{exportError}</p>
    </div>
  {/if}
  
  {#if exportSuccess}
    <div class="alert success">
      <p>{exportSuccess}</p>
    </div>
  {/if}
  
  <button
    class="export-btn"
    onclick={handleExport}
    disabled={isExporting || !onExport || timelineState.clips.length === 0}
  >
    {isExporting ? 'Exporting...' : 'Export Timeline'}
  </button>
</div>

<style>
  .export-panel {
    background: var(--surface-raised);
    border-top: 1px solid var(--border-default);
    padding: var(--space-4);
    min-width: 280px;
  }
  
  h3 {
    margin: 0 0 var(--space-4) 0;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .form-group {
    margin-bottom: var(--space-4);
  }
  
  .form-group.checkbox {
    display: flex;
    align-items: center;
  }
  
  .form-group.checkbox label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }
  
  label {
    display: block;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-bottom: var(--space-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  select, input[type="checkbox"] {
    width: 100%;
    padding: var(--space-2);
    background: var(--surface-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  
  input[type="checkbox"] {
    width: auto;
  }
  
  select:disabled, input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .help-text {
    font-size: var(--font-size-xs);
    color: var(--text-disabled);
    margin: var(--space-1) 0 0 0;
    font-style: italic;
  }
  
  .export-info {
    background: var(--surface-elevated);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
  }
  
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
    margin-bottom: var(--space-1);
  }
  
  .info-row:last-child {
    margin-bottom: 0;
  }
  
  .info-row span:last-child {
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }
  
  .progress-section {
    margin-bottom: var(--space-4);
  }
  
  .progress-bar {
    height: 6px;
    background: var(--surface-active);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }
  
  .progress-fill {
    height: 100%;
    background: var(--accent-primary);
    transition: width 0.2s;
  }
  
  .progress-text {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
  
  .alert {
    padding: var(--space-3);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-4);
    font-size: var(--font-size-sm);
  }
  
  .alert.error {
    background: #dc354520;
    border: 1px solid #dc3545;
    color: #dc3545;
  }
  
  .alert.success {
    background: #22c55e20;
    border: 1px solid #22c55e;
    color: #22c55e;
  }
  
  .alert p {
    margin: 0;
  }
  
  .export-btn {
    width: 100%;
    padding: var(--space-3);
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .export-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }
  
  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--surface-active);
  }
</style>
