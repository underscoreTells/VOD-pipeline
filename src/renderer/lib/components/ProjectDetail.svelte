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
  import {
    layoutState,
    loadLayout,
    persistLayout,
    setLeftWidth,
    setRightWidth,
    setPreviewHeight,
    setChatHeight,
    expandLeft,
    expandChat,
    expandBeat,
  } from '../state/layout.svelte';
  import { buildAssetUrl } from '../utils/media';
  import { onTranscriptionProgress } from '../state/electron.svelte';
  import { setTranscriptionProgress, setTranscriptionError } from '../state/transcription.svelte';
  import { setProjectContext, setChapterContext } from '../state/agent.svelte';
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
  let cleanupTranscription: (() => void) | null = null;
  let editorMainRef = $state<HTMLElement | null>(null);
  let editorSideRef = $state<HTMLElement | null>(null);

  const RESIZE_HANDLE_SIZE = 6;
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 520;
  const MIN_RIGHT_WIDTH = 260;
  const MAX_RIGHT_WIDTH = 560;
  const MIN_PREVIEW_HEIGHT = 200;
  const MIN_TIMELINE_HEIGHT = 220;
  const MIN_CHAT_HEIGHT = 240;
  const MIN_BEAT_HEIGHT = 220;
  
  // Load project data and chapters on mount
  onMount(() => {
    loadLayout();
    loadProjectDetail(project.id);
    loadChapters(project.id);
    cleanupKeyboard = initKeyboardShortcuts();
    
    // Set agent project context
    setProjectContext(String(project.id));
    
    // Set up transcription progress listener
    cleanupTranscription = onTranscriptionProgress((event: { chapterId: number; progress: { percent: number; status: string } }) => {
      setTranscriptionProgress(event.chapterId, event.progress);
    });
  });
  
  onDestroy(() => {
    if (cleanupKeyboard) cleanupKeyboard();
    if (cleanupTranscription) cleanupTranscription();
    saveProjectTimelineState();
    clearProjectDetail();
    clearChaptersState();
    setProjectContext(null);
    setChapterContext(null, null);
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

  const rightHidden = $derived(() => layoutState.chatCollapsed && layoutState.beatCollapsed);

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

  // Update agent chapter context when selection changes
  $effect(() => {
    const chapterId = selectedChapter?.id ? String(selectedChapter.id) : null;
    setChapterContext(chapterId, null);
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

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function startPointerDrag(
    event: PointerEvent,
    cursor: 'col-resize' | 'row-resize',
    onMove: (moveEvent: PointerEvent) => void,
    onEnd?: () => void
  ) {
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      onMove(moveEvent);
    };

    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onEnd?.();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleLeftResize(event: PointerEvent) {
    const startX = event.clientX;
    const startWidth = layoutState.leftWidth;
    startPointerDrag(event, 'col-resize', (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = clamp(startWidth + delta, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH);
      setLeftWidth(next);
    }, persistLayout);
  }

  function handleRightResize(event: PointerEvent) {
    const startX = event.clientX;
    const startWidth = layoutState.rightWidth;
    startPointerDrag(event, 'col-resize', (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = clamp(startWidth + delta, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH);
      setRightWidth(next);
    }, persistLayout);
  }

  function handlePreviewResize(event: PointerEvent) {
    if (!editorMainRef) return;
    const startY = event.clientY;
    const startHeight = layoutState.previewHeight;
    const containerHeight = editorMainRef.clientHeight;
    const maxHeight = Math.max(
      MIN_PREVIEW_HEIGHT,
      containerHeight - MIN_TIMELINE_HEIGHT - RESIZE_HANDLE_SIZE
    );
    startPointerDrag(event, 'row-resize', (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = clamp(startHeight + delta, MIN_PREVIEW_HEIGHT, maxHeight);
      setPreviewHeight(next);
    }, persistLayout);
  }

  function handleChatResize(event: PointerEvent) {
    if (!editorSideRef) return;
    const startY = event.clientY;
    const startHeight = layoutState.chatHeight;
    const containerHeight = editorSideRef.clientHeight;
    const maxHeight = Math.max(
      MIN_CHAT_HEIGHT,
      containerHeight - MIN_BEAT_HEIGHT - RESIZE_HANDLE_SIZE
    );
    startPointerDrag(event, 'row-resize', (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const next = clamp(startHeight + delta, MIN_CHAT_HEIGHT, maxHeight);
      setChatHeight(next);
    }, persistLayout);
  }
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
        {#if !layoutState.leftCollapsed}
          <aside class="chapters-sidebar" style="width: {layoutState.leftWidth}px">
            <ChapterPanel
              projectAssets={projectDetail.assets}
              onImportClick={() => setIsImporting(true)}
            />
          </aside>
          <div
            class="resize-handle-vertical"
            role="separator"
            aria-orientation="vertical"
            onpointerdown={handleLeftResize}
          ></div>
        {/if}
        
        <!-- Main Content Area -->
        <main class="main-content">
          <div class="editor-layout">
            <section class="editor-main" bind:this={editorMainRef}>
              <div class="editor-top-fixed" style="height: {layoutState.previewHeight}px">
                <ChapterPreview
                  chapter={selectedChapter}
                  asset={chapterPreviewAsset}
                />
              </div>
              <div
                class="resize-handle-horizontal"
                role="separator"
                aria-orientation="horizontal"
                onpointerdown={handlePreviewResize}
              ></div>

              {#if chaptersState.selectedChapterId}
                <div class="editor-bottom-scrollable">
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

                  <ClipPreview />
                </div>
              {:else}
                <div class="editor-bottom-scrollable empty-selection">
                  <div class="empty-icon">📖</div>
                  <h3>Select a Chapter</h3>
                  <p>Choose a chapter from the sidebar to view its timeline and beats</p>
                </div>
              {/if}
            </section>

            {#if !rightHidden()}
              <div
                class="resize-handle-vertical"
                role="separator"
                aria-orientation="vertical"
                onpointerdown={handleRightResize}
              ></div>
              <aside class="editor-side" style="width: {layoutState.rightWidth}px" bind:this={editorSideRef}>
                {#if !layoutState.chatCollapsed}
                  <div
                    class="side-panel chat-panel-wrapper"
                    style={layoutState.beatCollapsed
                      ? 'flex: 1 1 auto;'
                      : `flex: 0 0 ${layoutState.chatHeight}px;`}
                  >
                    <ChatPanel />
                  </div>
                {/if}

                {#if !layoutState.chatCollapsed && !layoutState.beatCollapsed}
                  <div
                    class="resize-handle-horizontal"
                    role="separator"
                    aria-orientation="horizontal"
                    onpointerdown={handleChatResize}
                  ></div>
                {/if}

                {#if !layoutState.beatCollapsed}
                  <div class="side-panel beat-panel-wrapper">
                    <BeatPanel clips={timelineState.clips} />
                  </div>
                {/if}
              </aside>
            {/if}
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

  {#if layoutState.leftCollapsed}
    <button class="floating-toggle left" onclick={expandLeft}>
      Show Chapters
    </button>
  {/if}

  {#if layoutState.chatCollapsed}
    <button class="floating-toggle right chat" onclick={expandChat}>
      Show Chat
    </button>
  {/if}
  {#if layoutState.beatCollapsed}
    <button class="floating-toggle right beat" onclick={expandBeat}>
      Show Beats
    </button>
  {/if}
</div>

<style>
  .project-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f0f;
    color: #fff;
    position: relative;
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
    min-height: 0;
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
    min-height: 0;
  }
  
  .chapters-sidebar {
    width: 300px;
    flex-shrink: 0;
    flex: 0 0 auto;
    border-right: 1px solid #333;
    overflow-y: auto;
    min-height: 0;
  }
  
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .editor-layout {
    flex: 1;
    display: flex;
    gap: 0;
    overflow: hidden;
    min-height: 0;
  }

  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    min-width: 0;
  }

  .editor-top-fixed {
    flex: 0 0 auto;
    padding: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #2a2a2a;
    overflow: hidden;
  }

  .editor-bottom-scrollable {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    padding-top: 0.5rem;
  }

  .editor-side {
    width: 360px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid #333;
    overflow: hidden;
    min-height: 0;
    min-width: 0;
    flex: 0 0 auto;
  }

  .side-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .chat-panel-wrapper {
    min-height: 240px;
  }

  .beat-panel-wrapper {
    flex: 1 1 auto;
    min-height: 220px;
  }

  .editor-side :global(.chat-panel) {
    flex: 1;
    border-left: none;
    height: 100%;
  }

  .editor-side :global(.beat-panel) {
    width: 100%;
    border-left: none;
    border-top: 1px solid #333;
    flex: 1 1 auto;
    height: 100%;
  }
  
  .timeline-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 220px;
  }
  
  .timeline-container {
    flex: 1;
    overflow: auto;
  }

  .resize-handle-vertical {
    width: 6px;
    flex: 0 0 6px;
    cursor: col-resize;
    background: #141414;
    transition: background 0.2s;
    touch-action: none;
  }

  .resize-handle-vertical:hover {
    background: #2a2a2a;
  }

  .resize-handle-horizontal {
    height: 6px;
    flex: 0 0 6px;
    cursor: row-resize;
    background: #141414;
    transition: background 0.2s;
    touch-action: none;
  }

  .resize-handle-horizontal:hover {
    background: #2a2a2a;
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

  .floating-toggle {
    position: absolute;
    top: 96px;
    z-index: 20;
    background: #1e1e1e;
    border: 1px solid #333;
    color: #fff;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }

  .floating-toggle:hover {
    background: #2a2a2a;
  }

  .floating-toggle.left {
    left: 12px;
  }

  .floating-toggle.right {
    right: 12px;
  }

  .floating-toggle.right.chat {
    top: 96px;
  }

  .floating-toggle.right.beat {
    top: 140px;
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
