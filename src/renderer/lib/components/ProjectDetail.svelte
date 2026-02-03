<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Timeline from './Timeline.svelte';
  import TimelineToolbar from './TimelineToolbar.svelte';
  import BeatPanel from './BeatPanel.svelte';
  import ImportChoice from './ImportChoice.svelte';
  import ChapterDefinition from './ChapterDefinition.svelte';
  import ChapterPanel from './ChapterPanel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import ClipPreview from './ClipPreview.svelte';
  import ChapterPreview from './ChapterPreview.svelte';
  import { 
    projectDetail, 
    loadProjectDetail, 
    addAssetToProject, 
    clearProjectDetail,
    saveProjectTimelineState,
    exportProjectToFile,
    generateAssetWaveform,
    getAssetWaveform
  } from '../state/project-detail.svelte';
  import { 
    chaptersState, 
    loadChapters, 
    clearChaptersState,
    createChapter,
    linkAssetToChapter,
    autoCreateChaptersFromFiles,
    setImportChoice,
    setIsImporting,
    selectChapter,
    loadAssetsForChapter,
    getSelectedChapter,
    getAssetsForChapter
  } from '../state/chapters.svelte';
  import { settingsState } from '../state/settings.svelte';
  import { timelineState, setError } from '../state/timeline.svelte';
  import { initKeyboardShortcuts } from '../state/keyboard.svelte';
  import { buildAssetUrl } from '../utils/media';
  import type { Project, Asset } from '$shared/types/database';
  
  interface Props {
    project: Project;
    onBack: () => void;
  }
  
  let { project, onBack }: Props = $props();
  
  let isDragging = $state(false);
  let showExportDialog = $state(false);
  let selectedExportFormat = $state('fcpxml');
  let cleanupKeyboard: (() => void) | null = null;
  let showChapterDefinition = $state(false);
  let vodAssetForDefinition = $state<Asset | null>(null);
  let waveformCheckToken = 0;
  const waveformInFlight = new Set<number>();
  
  // Load project data and chapters on mount
  onMount(() => {
    loadProjectDetail(project.id);
    loadChapters(project.id);
    cleanupKeyboard = initKeyboardShortcuts();
  });
  
  onDestroy(() => {
    if (cleanupKeyboard) cleanupKeyboard();
    saveProjectTimelineState();
    clearProjectDetail();
    clearChaptersState();
  });
  
  // Check if project has content (assets or chapters)
  const hasContent = $derived(() => {
    return projectDetail.assets.length > 0 || chaptersState.chapters.length > 0;
  });
  
  // Handle VOD import
  async function handleVODImport(filePath: string) {
    try {
      // Create asset for VOD
      const asset = await addAssetToProject(project.id, filePath);
      if (asset) {
        vodAssetForDefinition = asset;
        showChapterDefinition = true;
      }
    } catch (error) {
      console.error('Failed to import VOD:', error);
      setError(`Failed to import VOD: ${(error as Error).message}`);
      setIsImporting(false);
    }
  }
  
  // Handle files import
  async function handleFilesImport(filePaths: string[]) {
    try {
      const assets: Asset[] = [];
      
      // Create assets for all files
      for (const filePath of filePaths) {
        const asset = await addAssetToProject(project.id, filePath);
        if (asset) {
          assets.push(asset);
        }
      }
      
      // Auto-create chapters from files
      if (assets.length > 0) {
        const created = await autoCreateChaptersFromFiles(project.id, assets);
        if (created.length > 0) {
          selectChapter(created[0].id);
        }
      }
      
      setIsImporting(false);
    } catch (error) {
      console.error('Failed to import files:', error);
      setError(`Failed to import files: ${(error as Error).message}`);
      setIsImporting(false);
    }
  }
  
  // Handle chapter creation from ChapterDefinition
  async function handleChaptersDefined(chapterInputs: Array<{ title: string; startTime: number; endTime: number }>) {
    if (!vodAssetForDefinition) return;
    let firstChapterId: number | null = null;
    try {
      for (const input of chapterInputs) {
        // Create chapter
        const chapter = await createChapter(
          project.id,
          input.title,
          input.startTime,
          input.endTime
        );
        
        if (chapter) {
          if (!firstChapterId) {
            firstChapterId = chapter.id;
          }
          // Link VOD asset to chapter
          await linkAssetToChapter(chapter.id, vodAssetForDefinition.id);
          
          // Start transcription if enabled
          if (settingsState.settings.autoTranscribeOnImport) {
            // Start transcription asynchronously
            (window.electronAPI as any)?.transcription?.transcribe(chapter.id).catch((error: Error) => {
              console.error('Failed to start transcription:', error);
            });
          }
        }
      }
      
      showChapterDefinition = false;
      vodAssetForDefinition = null;
      setIsImporting(false);
      if (firstChapterId) {
        selectChapter(firstChapterId);
      }
    } catch (error) {
      console.error('Failed to create chapters:', error);
      setError(`Failed to create chapters: ${(error as Error).message}`);
      setIsImporting(false);
    }
  }
  
  // Handle cancel from ChapterDefinition
  function handleChapterDefinitionCancel() {
    showChapterDefinition = false;
    vodAssetForDefinition = null;
    setIsImporting(false);
    // Optionally delete the VOD asset that was created
  }

  const selectedChapter = $derived.by(() => getSelectedChapter());

  const selectedChapterAssetIds = $derived.by(() => {
    if (!selectedChapter) return [];
    return getAssetsForChapter(selectedChapter.id) ?? [];
  });

  const selectedChapterAssets = $derived.by(() => {
    if (!selectedChapterAssetIds.length) return [];
    return selectedChapterAssetIds
      .map((assetId) => projectDetail.assets.find((asset) => asset.id === assetId))
      .filter((asset): asset is Asset => Boolean(asset));
  });

  const chapterPreviewAsset = $derived.by(() => selectedChapterAssets[0] ?? null);
  const hasChapterAssets = $derived.by(() =>
    selectedChapter ? chaptersState.chapterAssets.has(selectedChapter.id) : false
  );

  async function ensureChapterWaveforms(assetIds: number[]) {
    const token = ++waveformCheckToken;
    for (const assetId of assetIds) {
      if (token !== waveformCheckToken) return;
      if (waveformInFlight.has(assetId)) continue;

      const cached = await getAssetWaveform(assetId, 0, 1);
      if (token !== waveformCheckToken) return;
      if (cached) continue;

      waveformInFlight.add(assetId);
      try {
        await generateAssetWaveform(assetId, 0);
      } finally {
        waveformInFlight.delete(assetId);
      }
    }
  }

  $effect(() => {
    if (selectedChapter && !hasChapterAssets) {
      void loadAssetsForChapter(selectedChapter.id);
    }
  });

  $effect(() => {
    if (selectedChapterAssetIds.length > 0) {
      void ensureChapterWaveforms([...selectedChapterAssetIds]);
    }
  });
  
  // Handle drag and drop for additional imports
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
    
    const webUtils = window.electronAPI?.webUtils;
    
    for (const file of files) {
      if (file.type.startsWith('video/')) {
        try {
          const filePath = webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file as any).path;
          if (filePath) {
            // Add as individual file chapter
            const asset = await addAssetToProject(project.id, filePath);
            if (asset) {
              const created = await autoCreateChaptersFromFiles(project.id, [asset]);
              if (created.length > 0) {
                selectChapter(created[0].id);
              }
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
      const result = await window.electronAPI.dialog.showSaveDialog({
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
  
  // Get audio URLs for timeline
  const audioUrls = $derived.by(() => {
    if (selectedChapterAssetIds.length === 0) return [];
    return selectedChapterAssetIds.map((assetId) => buildAssetUrl(assetId));
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
      {#if hasContent()}
        <button class="import-btn" onclick={() => setIsImporting(true)}>
          📁 Import More
        </button>
      {/if}
      <button class="export-btn" onclick={() => showExportDialog = true}>
        📤 Export
      </button>
    </div>
  </div>
  
  <!-- Main Content -->
  <div class="detail-content">
    {#if projectDetail.isLoadingAssets || projectDetail.isLoadingClips || chaptersState.isLoading}
      <div class="loading">
        <span class="spinner"></span>
        <p>Loading project...</p>
      </div>
    {:else if showChapterDefinition && vodAssetForDefinition}
      <!-- Chapter Definition Mode -->
      <ChapterDefinition
        asset={vodAssetForDefinition}
        projectId={project.id}
        onComplete={handleChaptersDefined}
        onCancel={handleChapterDefinitionCancel}
      />
    {:else if chaptersState.isImporting}
      <!-- Import Choice Mode -->
      <ImportChoice
        projectId={project.id}
        onVODImport={handleVODImport}
        onFilesImport={handleFilesImport}
      />
    {:else if !hasContent()}
      <!-- Empty State - Show ImportChoice -->
      <ImportChoice
        projectId={project.id}
        onVODImport={handleVODImport}
        onFilesImport={handleFilesImport}
      />
    {:else}
      <!-- Chapters-First Layout -->
      <div class="project-layout">
        <!-- Chapter Panel Sidebar -->
        <aside class="chapters-sidebar">
          <ChapterPanel
            projectAssets={projectDetail.assets}
            onImportClick={() => setIsImporting(true)}
          />
        </aside>
        
        <!-- Main Content Area -->
        <main class="main-content">
          <div class="editor-layout">
            <section class="editor-main">
              <ChapterPreview
                chapter={selectedChapter}
                asset={chapterPreviewAsset}
              />

              {#if chaptersState.selectedChapterId}
                <div class="timeline-wrapper">
                  <TimelineToolbar />
                  <div class="timeline-container">
                    <Timeline 
                      projectId={project.id}
                      {audioUrls}
                      trackAssetIds={selectedChapterAssetIds}
                      clips={timelineState.clips}
                    />
                  </div>
                </div>
              {:else}
                <div class="empty-selection">
                  <div class="empty-icon">📖</div>
                  <h3>Select a Chapter</h3>
                  <p>Choose a chapter from the sidebar to view its timeline and beats</p>
                </div>
              {/if}

              <ClipPreview />
            </section>

            <aside class="editor-side">
              <ChatPanel />
              <BeatPanel clips={timelineState.clips} />
            </aside>
          </div>
        </main>
      </div>
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
    flex-shrink: 0;
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
  
  .header-actions {
    display: flex;
    gap: 0.75rem;
  }
  
  .import-btn, .export-btn {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
    border: none;
  }
  
  .import-btn {
    background: #333;
    color: #fff;
  }
  
  .import-btn:hover {
    background: #444;
  }
  
  .export-btn {
    background: #007bff;
    color: #fff;
  }
  
  .export-btn:hover {
    background: #0056b3;
  }
  
  /* Main Content */
  .detail-content {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
  
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #007bff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Project Layout */
  .project-layout {
    display: flex;
    height: 100%;
  }
  
  .chapters-sidebar {
    width: 300px;
    flex-shrink: 0;
    border-right: 1px solid #333;
    overflow-y: auto;
  }
  
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-layout {
    flex: 1;
    display: flex;
    gap: 0;
    overflow: hidden;
  }

  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    overflow: hidden;
  }

  .editor-side {
    width: 360px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #333;
    overflow: hidden;
  }

  .editor-side :global(.chat-panel) {
    flex: 1;
    border-left: none;
  }

  .editor-side :global(.beat-panel) {
    width: 100%;
    border-left: none;
    border-top: 1px solid #333;
    flex: 0 0 320px;
  }
  
  .timeline-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 280px;
  }
  
  .timeline-container {
    flex: 1;
    overflow: auto;
  }
  
  /* Empty Selection State */
  .empty-selection {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    padding: 2rem;
  }
  
  .empty-icon {
    font-size: 4rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }
  
  .empty-selection h3 {
    margin: 0 0 0.5rem 0;
    color: #888;
  }
  
  .empty-selection p {
    margin: 0;
    font-size: 0.875rem;
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
  }
  
  .progress-bar {
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
    padding: 2rem;
    border-radius: 8px;
    min-width: 400px;
    max-width: 90vw;
  }
  
  .dialog h3 {
    margin: 0 0 0.5rem 0;
  }
  
  .dialog-description {
    color: #888;
    margin: 0 0 1.5rem 0;
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
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .format-option:hover,
  .format-option.selected {
    background: #333;
  }
  
  .format-info {
    display: flex;
    flex-direction: column;
  }
  
  .format-name {
    font-weight: 500;
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
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    border: none;
  }
  
  .dialog-actions .secondary {
    background: #333;
    color: #fff;
  }
  
  .dialog-actions .primary {
    background: #007bff;
    color: #fff;
  }
  
  /* Error Toast */
  .error-toast {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    background: #dc3545;
    color: #fff;
    padding: 1rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 1rem;
    z-index: 1000;
  }
  
  .error-toast button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 1.25rem;
  }
</style>
