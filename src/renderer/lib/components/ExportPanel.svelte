<script lang="ts">
  import { EXPORT_FORMATS, type ExportFormat } from '../../../pipeline/export/index';
  import { timelineState, getTotalDuration } from '../state/timeline.svelte';
  import { projects } from '../state/project.svelte';
  
  interface Props {
    onExport?: (format: ExportFormat, filePath: string) => Promise<void>;
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
    if (!formatConfig || !onExport) return;
    
    // Show save dialog
    const suggestedFilename = `${projectName}${formatConfig.extension}`;
    
    isExporting = true;
    exportProgress = 0;
    exportError = null;
    exportSuccess = null;
    
    try {
      // For now, use a mock file path - in real implementation this would open a save dialog
      const filePath = suggestedFilename;
      
      // Simulate progress
      const progressInterval = setInterval(() => {
        exportProgress = Math.min(exportProgress + 10, 90);
      }, 100);
      
      await onExport(selectedFormat, filePath);
      
      clearInterval(progressInterval);
      exportProgress = 100;
      exportSuccess = `Exported to ${filePath}`;
    } catch (error) {
      exportError = (error as Error).message || 'Export failed';
    } finally {
      isExporting = false;
    }
  }
  
  // Available frame rates
  const frameRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
</script>

<div class="export-panel">
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
    disabled={isExporting || timelineState.clips.length === 0}
  >
    {isExporting ? 'Exporting...' : 'Export Timeline'}
  </button>
</div>

<style>
  .export-panel {
    background: #1a1a1a;
    border-top: 1px solid #333;
    padding: 1rem;
    min-width: 280px;
  }
  
  h3 {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .form-group {
    margin-bottom: 1rem;
  }
  
  .form-group.checkbox {
    display: flex;
    align-items: center;
  }
  
  .form-group.checkbox label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  
  label {
    display: block;
    font-size: 0.75rem;
    color: #888;
    margin-bottom: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  select, input[type="checkbox"] {
    width: 100%;
    padding: 0.5rem;
    background: #252525;
    border: 1px solid #444;
    border-radius: 4px;
    color: #ccc;
    font-size: 0.875rem;
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
    border-color: #007bff;
  }
  
  .help-text {
    font-size: 0.75rem;
    color: #666;
    margin: 0.25rem 0 0 0;
    font-style: italic;
  }
  
  .export-info {
    background: #252525;
    border-radius: 4px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }
  
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    color: #888;
    margin-bottom: 0.25rem;
  }
  
  .info-row:last-child {
    margin-bottom: 0;
  }
  
  .info-row span:last-child {
    color: #ccc;
    font-family: 'SF Mono', Monaco, monospace;
  }
  
  .progress-section {
    margin-bottom: 1rem;
  }
  
  .progress-bar {
    height: 6px;
    background: #333;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.5rem;
  }
  
  .progress-fill {
    height: 100%;
    background: #007bff;
    transition: width 0.2s;
  }
  
  .progress-text {
    font-size: 0.75rem;
    color: #888;
  }
  
  .alert {
    padding: 0.75rem;
    border-radius: 4px;
    margin-bottom: 1rem;
    font-size: 0.875rem;
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
    padding: 0.75rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .export-btn:hover:not(:disabled) {
    background: #0056b3;
  }
  
  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: #444;
  }
</style>
