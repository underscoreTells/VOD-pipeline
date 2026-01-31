<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Timeline from './Timeline.svelte';
  import TimelineToolbar from './TimelineToolbar.svelte';
  import BeatPanel from './BeatPanel.svelte';
  import { 
    projectDetail, 
    loadProjectDetail, 
    addAssetToProject, 
    clearProjectDetail,
    saveProjectTimelineState,
    exportProjectToFile,
    generateAssetWaveform
  } from '../state/project-detail.svelte';
  import { timelineState, setError } from '../state/timeline.svelte';
  import { initKeyboardShortcuts } from '../state/keyboard.svelte';
  import type { Project } from '../../../shared/types/database';
  
  interface Props {
    project: Project;
    onBack: () => void;
  }
  
  let { project, onBack }: Props = $props();
  
  let isDragging = $state(false);
  let showExportDialog = $state(false);
  let selectedExportFormat = $state('fcpxml');
  let cleanupKeyboard: (() => void) | null = null;
  
  // Load project data on mount
  onMount(() => {
    loadProjectDetail(project.id);
    cleanupKeyboard = initKeyboardShortcuts();
  });
  
  onDestroy(() => {
    if (cleanupKeyboard) cleanupKeyboard();
    saveProjectTimelineState();
    clearProjectDetail();
  });
  
  // Handle drag and drop
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }
  
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }
  
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    
    const files = e.dataTransfer?.files;
    if (!files) return;
    
    // Use Electron's webUtils to get file paths
    const webUtils = (window as any).electronAPI?.webUtils;
    
    for (const file of files) {
      if (file.type.startsWith('video/')) {
        try {
          const filePath = webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file as any).path;
          if (filePath) {
            const asset = await addAssetToProject(project.id, filePath);
            if (asset) {
              // Auto-generate waveform for the asset
              await generateAssetWaveform(asset.id, 0);
            }
          }
        } catch (error) {
          console.error('Failed to import file:', error);
          setError(`Failed to import ${file.name}: ${(error as Error).message}`);
        }
      }
    }
  }
  
  // Handle file input
  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    
    // Use Electron's webUtils to get file paths
    const webUtils = (window as any).electronAPI?.webUtils;
    
    for (const file of files) {
      if (file.type.startsWith('video/')) {
        try {
          const filePath = webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file as any).path;
          if (filePath) {
            const asset = await addAssetToProject(project.id, filePath);
            if (asset) {
              await generateAssetWaveform(asset.id, 0);
            }
          }
        } catch (error) {
          console.error('Failed to import file:', error);
          setError(`Failed to import ${file.name}: ${(error as Error).message}`);
        }
      }
    }
  }
  
  // Export project
  async function handleExport() {
    const format = projectDetail.exportFormats.find(f => f.id === selectedExportFormat);
    if (!format) return;
    
    try {
      // Use electron's dialog via IPC
      const result = await (window as any).electronAPI.dialog.showSaveDialog({
        defaultPath: `${project.name}${format.extension}`,
        filters: [{ name: format.name, extensions: [format.extension.replace('.', '')] }]
      });
      
      if (!result.canceled && result.filePath) {
        const success = await exportProjectToFile(project.id, selectedExportFormat, result.filePath);
        if (success) {
          showExportDialog = false;
          alert('Export completed successfully!');
        }
      }
    } catch (error) {
      console.error('Export failed:', error);
      setError(`Export failed: ${(error as Error).message}`);
    }
  }
  
  // Get audio URLs for timeline (platform-safe file URLs)
  const audioUrls = $derived.by(() => {
    return projectDetail.assets.map(asset => {
      // Use URL API to create proper file URLs with encoding
      const fileUrl = new URL(`file://${asset.file_path}`);
      return fileUrl.href;
    });
  });
</script>

<div 
  class="project-detail"
  class:dragging={isDragging}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Header -->
  <div class="detail-header">
    <div class="header-left">
      <button class="back-btn" onclick={onBack}>← Back</button>
      <h2>{project.name}</h2>
    </div>
    <div class="header-actions">
      <label class="import-btn">
        <input 
          type="file" 
          accept="video/*" 
          multiple 
          onchange={handleFileSelect}
          style="display: none;"
        />
        📁 Import Video
      </label>
      <button class="export-btn" onclick={() => showExportDialog = true}>
        📤 Export
      </button>
    </div>
  </div>
  
  <!-- Main Content -->
  <div class="detail-content">
    {#if projectDetail.isLoadingAssets || projectDetail.isLoadingClips}
      <div class="loading">
        <span class="spinner"></span>
        <p>Loading project...</p>
      </div>
    {:else if projectDetail.assets.length === 0}
      <div class="empty-state">
        <p>📹 Drop video files here to get started</p>
        <p class="hint">or click "Import Video" to browse</p>
      </div>
    {:else}
      <div class="timeline-wrapper">
        <TimelineToolbar />
        <div class="timeline-container">
          <Timeline 
            projectId={project.id}
            {audioUrls}
            clips={timelineState.clips}
          />
        </div>
      </div>
      
      <BeatPanel clips={timelineState.clips} />
    {/if}
  </div>
  
  <!-- Waveform Generation Progress -->
  {#if projectDetail.isGeneratingWaveform}
    <div class="progress-overlay">
      <div class="progress-dialog">
        <p>Generating waveforms...</p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {projectDetail.waveformProgress.percent}%"></div>
        </div>
        <p class="progress-status">{projectDetail.waveformProgress.status}</p>
      </div>
    </div>
  {/if}
  
  <!-- Export Dialog -->
  {#if showExportDialog}
    <div class="dialog-overlay" onclick={() => showExportDialog = false}>
      <div class="dialog" onclick={(e) => e.stopPropagation()}>
        <h3>Export Project</h3>
        <p class="dialog-description">Export your timeline to use in professional NLE software</p>
        
        <div class="format-list">
          {#each projectDetail.exportFormats as format}
            <label class="format-option" class:selected={selectedExportFormat === format.id}>
              <input 
                type="radio" 
                name="format" 
                value={format.id}
                bind:group={selectedExportFormat}
              />
              <div class="format-info">
                <span class="format-name">{format.name}</span>
                <span class="format-desc">{format.description}</span>
              </div>
            </label>
          {/each}
        </div>
        
        <div class="dialog-actions">
          <button class="secondary" onclick={() => showExportDialog = false}>Cancel</button>
          <button class="primary" onclick={handleExport}>Export</button>
        </div>
      </div>
    </div>
  {/if}
  
  <!-- Error Display -->
  {#if timelineState.error}
    <div class="error-toast">
      <p>{timelineState.error}</p>
      <button onclick={() => setError(null)}>✕</button>
    </div>
  {/if}
</div>

<style>
  .project-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f0f;
    color: #fff;
  }
  
  .project-detail.dragging {
    background: #1a1a2e;
    border: 2px dashed #007bff;
  }
  
  /* Header */
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: #1e1e1e;
    border-bottom: 1px solid #333;
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .back-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #555;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .back-btn:hover {
    background: #333;
    border-color: #666;
  }
  
  .detail-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }
  
  .header-actions {
    display: flex;
    gap: 0.75rem;
  }
  
  .import-btn, .export-btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }
  
  .import-btn {
    background: #28a745;
    color: white;
  }
  
  .import-btn:hover {
    background: #218838;
  }
  
  .export-btn {
    background: #007bff;
    color: white;
  }
  
  .export-btn:hover {
    background: #0056b3;
  }
  
  /* Content */
  .detail-content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
  
  .timeline-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .timeline-container {
    flex: 1;
    overflow: hidden;
    padding: 0 1rem 1rem;
  }
  
  /* Empty State */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #666;
  }
  
  .empty-state p:first-child {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }
  
  .hint {
    font-size: 0.875rem;
    color: #888;
  }
  
  /* Loading */
  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #888;
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #007bff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Progress Overlay */
  .progress-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .progress-dialog {
    background: #1e1e1e;
    padding: 2rem;
    border-radius: 8px;
    min-width: 300px;
    text-align: center;
  }
  
  .progress-bar {
    width: 100%;
    height: 8px;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
    margin: 1rem 0;
  }
  
  .progress-fill {
    height: 100%;
    background: #007bff;
    transition: width 0.3s;
  }
  
  .progress-status {
    font-size: 0.875rem;
    color: #888;
    margin: 0;
  }
  
  /* Dialog */
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .dialog {
    background: #1e1e1e;
    padding: 1.5rem;
    border-radius: 8px;
    min-width: 400px;
    max-width: 500px;
  }
  
  .dialog h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.25rem;
  }
  
  .dialog-description {
    margin: 0 0 1.5rem 0;
    color: #888;
    font-size: 0.875rem;
  }
  
  .format-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .format-option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: #252525;
    border: 2px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .format-option:hover {
    background: #2a2a2a;
  }
  
  .format-option.selected {
    border-color: #007bff;
    background: #007bff20;
  }
  
  .format-info {
    display: flex;
    flex-direction: column;
  }
  
  .format-name {
    font-weight: 600;
    color: #fff;
  }
  
  .format-desc {
    font-size: 0.75rem;
    color: #888;
  }
  
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }
  
  .dialog-actions button {
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }
  
  .dialog-actions .secondary {
    background: transparent;
    border: 1px solid #555;
    color: #ccc;
  }
  
  .dialog-actions .secondary:hover {
    background: #333;
  }
  
  .dialog-actions .primary {
    background: #007bff;
    color: white;
  }
  
  .dialog-actions .primary:hover {
    background: #0056b3;
  }
  
  /* Error Toast */
  .error-toast {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: #dc3545;
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 1rem;
    z-index: 1001;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  
  .error-toast button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 1.25rem;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
