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
    getAssetWaveform,
    getMissingProjectAssets
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
  import { timelineState, setError, clearSelection as clearTimelineSelection } from '../state/timeline.svelte';
  import { initKeyboardShortcuts } from '../state/keyboard.svelte';
  import {
    layoutState,
    loadLayout,
    persistLayout,
    setLeftWidth,
    setRightWidth,
    setPreviewHeight,
    setClipPreviewWidth,
    expandLeft,
    expandChat,
    expandBeat,
  } from '../state/layout.svelte';
  import { buildPlayableAssetUrl, looksLikeExternalStoragePath } from '../utils/media';
  import {
    onTranscriptionProgress,
    transcribeChapter as startChapterTranscription,
    getTranscriptionStatus,
  } from '../api/transcription.js';
  import { getPathForFile, showSaveDialog } from '../api/system.js';
  import { setTranscriptionProgress, setTranscriptionError } from '../state/transcription.svelte';
  import { syncAgentContext } from '../state/agent.svelte';
  import { toAgentChapterId } from './project-detail-helpers.js';
  import {
    createProjectChaptersFromDefinition,
    importProjectFiles,
  } from './project-detail-import.js';
  import {
    exportProjectWithDialog,
  } from './project-detail-export.js';
  import {
    createProjectDetailLayoutController,
  } from './project-detail-layout.js';
  import {
    transcribeMissingChaptersOnReopen,
  } from './project-detail-transcription.js';
  import {
    createChapterWaveformScheduler,
    getAssetAudioTrackCount,
    getWaveformTrackIndices,
    isMkvAsset,
  } from './project-detail-waveforms.js';
  import type { Project, Asset } from '$shared/types/database';
  import type { ProjectAsset } from '$shared/contracts/ipc';
  import Icon from './ui/Icon.svelte';
  import { ArrowLeft, FolderPlus, Share, BookOpen, X } from '../constants';
  
  interface Props {
    project: Project;
    onBack: () => void;
  }

  interface TimelineLane {
    id: string;
    label: string;
    audioUrl: string;
    missing: boolean;
    assetId: number | null;
    editable: boolean;
    clipTrackIndex: number;
    waveformTrackIndex: number;
    createTrackIndex?: number;
  }
  
  let { project, onBack }: Props = $props();
  
  let isDragging = $state(false);
  let showExportDialog = $state(false);
  let selectedExportFormat = $state('fcpxml');
  let showClipPreviewPanel = $state(true);
  let showSourceTracks = $state(false);
  let cleanupKeyboard: (() => void) | null = null;
  let showChapterDefinition = $state(false);
  let vodAssetForDefinition = $state<Asset | null>(null);
  let cleanupTranscription: (() => void) | null = null;
  let editorMainRef = $state<HTMLElement | null>(null);
  let previewTopLayoutRef = $state<HTMLElement | null>(null);
  let previousSelectedChapterId: number | null = null;
  let previousAgentContextKey = $state<string | null>(null);
  let initialChapterLoadEvaluated = $state(false);
  let scheduledMissingChapterTranscription = $state(false);

  const RESIZE_HANDLE_SIZE = 6;
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 520;
  const MIN_RIGHT_WIDTH = 260;
  const MAX_RIGHT_WIDTH = 560;
  const MIN_PREVIEW_HEIGHT = 200;
  const MIN_TIMELINE_HEIGHT = 220;
  const MIN_CLIP_PREVIEW_WIDTH = 240;
  const MIN_CHAPTER_PREVIEW_WIDTH = 360;
  const MIX_TRACK_INDEX = 0;
  const MIX_WAVEFORM_TRACK_INDEX = -1;

  const transcriptionDeps = {
    getTranscriptionStatus,
    startChapterTranscription,
    setTranscriptionError,
  };

  const waveformScheduler = createChapterWaveformScheduler({
    resolveAsset: (assetId) => projectDetail.assets.find((item) => item.id === assetId) ?? null,
    getAssetWaveform,
    generateAssetWaveform,
    isPlaybackActive: () => timelineState.isPlaying,
  });

  const layoutController = createProjectDetailLayoutController({
    getLeftWidth: () => layoutState.leftWidth,
    setLeftWidth,
    getRightWidth: () => layoutState.rightWidth,
    setRightWidth,
    getPreviewHeight: () => layoutState.previewHeight,
    setPreviewHeight,
    getClipPreviewWidth: () => layoutState.clipPreviewWidth,
    setClipPreviewWidth,
    persistLayout,
    getEditorMainRef: () => editorMainRef,
    getPreviewTopLayoutRef: () => previewTopLayoutRef,
  }, {
    resizeHandleSize: RESIZE_HANDLE_SIZE,
    minLeftWidth: MIN_LEFT_WIDTH,
    maxLeftWidth: MAX_LEFT_WIDTH,
    minRightWidth: MIN_RIGHT_WIDTH,
    maxRightWidth: MAX_RIGHT_WIDTH,
    minPreviewHeight: MIN_PREVIEW_HEIGHT,
    minTimelineHeight: MIN_TIMELINE_HEIGHT,
    minClipPreviewWidth: MIN_CLIP_PREVIEW_WIDTH,
    minChapterPreviewWidth: MIN_CHAPTER_PREVIEW_WIDTH,
  });
  
  // Load project data and chapters on mount
  onMount(() => {
    loadLayout();
    loadProjectDetail(project.id);
    loadChapters(project.id);
    cleanupKeyboard = initKeyboardShortcuts();
    
    // Set up transcription progress listener
    cleanupTranscription = onTranscriptionProgress((event: { chapterId: number; progress: { percent: number; status: string } }) => {
      setTranscriptionProgress(event.chapterId, event.progress);
    });

    // Warm transcription runtime for existing projects as soon as detail view loads.
    void getTranscriptionStatus(true).then((status: { success: boolean; data?: { available?: boolean; error?: string }; error?: string }) => {
      if (!status.success || !status.data?.available) {
        console.warn('[Transcription] Runtime not ready during project load:', status.data?.error || status.error);
      }
    });
  });
  
  onDestroy(() => {
    if (cleanupKeyboard) cleanupKeyboard();
    if (cleanupTranscription) cleanupTranscription();
    saveProjectTimelineState();
    clearProjectDetail();
    clearChaptersState();
    void syncAgentContext(null, null);
  });
  
  // Check if project has content (assets or chapters)
  const hasContent = $derived(() => {
    return projectDetail.assets.length > 0 || chaptersState.chapters.length > 0;
  });
  
  // Handle VOD import
  async function handleVODImport(filePath: string) {
    try {
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
      await importProjectFiles(project.id, filePaths, {
        addAssetToProject,
        autoCreateChaptersFromFiles,
        createChapter,
        linkAssetToChapter,
        selectChapter,
        autoTranscribeOnImport: settingsState.settings.autoTranscribeOnImport,
        ...transcriptionDeps,
      });

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
    try {
      await createProjectChaptersFromDefinition(
        project.id,
        vodAssetForDefinition,
        chapterInputs,
        {
          addAssetToProject,
          autoCreateChaptersFromFiles,
          createChapter,
          linkAssetToChapter,
          selectChapter,
          autoTranscribeOnImport: settingsState.settings.autoTranscribeOnImport,
          ...transcriptionDeps,
        }
      );

      showChapterDefinition = false;
      vodAssetForDefinition = null;
      setIsImporting(false);
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

  $effect(() => {
    const chapterId = selectedChapter?.id ?? null;
    if (chapterId === previousSelectedChapterId) return;
    clearTimelineSelection();
    previousSelectedChapterId = chapterId;
  });

  const selectedChapterAssetIds = $derived.by(() => {
    if (!selectedChapter) return [];
    return getAssetsForChapter(selectedChapter.id) ?? [];
  });

  const selectedChapterAssets = $derived.by(() => {
    if (!selectedChapterAssetIds.length) return [];
    return selectedChapterAssetIds
      .map((assetId) => projectDetail.assets.find((asset) => asset.id === assetId))
      .filter((asset): asset is ProjectAsset => Boolean(asset));
  });

  const missingProjectAssets = $derived.by(() => getMissingProjectAssets());
  const missingMediaLooksExternal = $derived.by(() =>
    missingProjectAssets.some((asset) => looksLikeExternalStoragePath(asset.availability.nearestExistingAncestor))
  );

  function getAssetDisplayName(asset: Asset): string {
    const segments = asset.file_path.split(/[\/\\]/);
    return segments[segments.length - 1] || `Asset ${asset.id}`;
  }

  const chapterPreviewAsset = $derived.by(() =>
    selectedChapterAssets.find((asset) => asset.availability.exists !== false) ?? selectedChapterAssets[0] ?? null
  );
  const timelineWaveformAssetIds = $derived.by(() => {
    return selectedChapterAssets
      .filter((asset) => asset.availability.exists !== false)
      .map((asset) => asset.id);
  });
  const canShowSourceTracks = $derived.by(() => {
    return selectedChapterAssets.some((asset) => getAssetAudioTrackCount(asset) > 1);
  });
  const hasChapterAssets = $derived.by(() =>
    selectedChapter ? chaptersState.chapterAssets.has(selectedChapter.id) : false
  );

  const rightHidden = $derived(() => layoutState.chatCollapsed);

  $effect(() => {
    if (!canShowSourceTracks && showSourceTracks) {
      showSourceTracks = false;
    }
  });

  $effect(() => {
    if (selectedChapter && !hasChapterAssets) {
      void loadAssetsForChapter(selectedChapter.id);
    }
  });

  $effect(() => {
    if (initialChapterLoadEvaluated) return;
    if (chaptersState.isLoading) return;

    initialChapterLoadEvaluated = true;

    const chapterIds = chaptersState.chapters.map((chapter) => chapter.id);
    if (chapterIds.length === 0) {
      scheduledMissingChapterTranscription = true;
      return;
    }

    scheduledMissingChapterTranscription = true;
    void transcribeMissingChaptersOnReopen(chapterIds, transcriptionDeps);
  });

  // Update agent chapter context when selection changes
  $effect(() => {
    const projectId = String(project.id);
    const chapterId = toAgentChapterId(selectedChapter?.id ?? null);
    const nextAgentContextKey = `${projectId}:${chapterId ?? "none"}`;
    if (previousAgentContextKey === nextAgentContextKey) {
      return;
    }

    previousAgentContextKey = nextAgentContextKey;
    void syncAgentContext(projectId, chapterId);
  });

  $effect(() => {
    const includeSourceTracks = showSourceTracks && canShowSourceTracks;
    if (timelineWaveformAssetIds.length > 0) {
      void waveformScheduler.ensureChapterWaveforms(
        [...timelineWaveformAssetIds],
        includeSourceTracks,
        MIX_WAVEFORM_TRACK_INDEX
      );
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
    
    for (const file of files) {
      if (file.type.startsWith('video/')) {
        try {
          const filePath = getPathForFile(file);
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
    try {
      const success = await exportProjectWithDialog(
        project.id,
        project.name,
        selectedExportFormat,
        projectDetail.exportFormats,
        {
          showSaveDialog,
          exportProjectToFile,
        }
      );

      if (success) {
        showExportDialog = false;
        alert('Export completed successfully!');
      }
    } catch (error) {
      console.error('Export failed:', error);
      setError(`Export failed: ${(error as Error).message}`);
    }
  }

  $effect(() => {
    if (!showClipPreviewPanel || !previewTopLayoutRef) return;

    layoutController.clampClipPreviewWidth();

    const observer = new ResizeObserver(() => {
      if (!showClipPreviewPanel) return;
      layoutController.clampClipPreviewWidth();
    });

    observer.observe(previewTopLayoutRef);

    return () => {
      observer.disconnect();
    };
  });
  
  const timelineLanes = $derived.by(() => {
    if (selectedChapterAssets.length === 0) {
      return [] as TimelineLane[];
    }

    const includeAssetNames = selectedChapterAssets.length > 1;
    const lanes: TimelineLane[] = [];

    for (const asset of selectedChapterAssets) {
      const sourceTrackCount = getAssetAudioTrackCount(asset);
      const assetLabelSuffix = includeAssetNames ? ` - ${getAssetDisplayName(asset)}` : '';

      lanes.push({
        id: `mix-${asset.id}`,
        label: `Mix${assetLabelSuffix}`,
        audioUrl: buildPlayableAssetUrl(asset),
        missing: asset.availability.exists === false,
        assetId: asset.id,
        editable: true,
        clipTrackIndex: -1,
        waveformTrackIndex: MIX_WAVEFORM_TRACK_INDEX,
        createTrackIndex: MIX_TRACK_INDEX,
      });

      if (showSourceTracks && sourceTrackCount > 1) {
        for (let index = 0; index < sourceTrackCount; index += 1) {
          lanes.push({
            id: `a${index + 1}-${asset.id}`,
            label: `A${index + 1}${assetLabelSuffix}`,
            audioUrl: buildPlayableAssetUrl(asset),
            missing: asset.availability.exists === false,
            assetId: asset.id,
            editable: false,
            clipTrackIndex: -1,
            waveformTrackIndex: index,
            createTrackIndex: MIX_TRACK_INDEX,
          });
        }
      }
    }

    return lanes;
  });

  const selectedChapterClips = $derived.by(() => {
    if (!selectedChapter) return [];
    if (selectedChapterAssetIds.length === 0) return [];
    const assetIds = new Set(selectedChapterAssetIds);
    const chapterStart = selectedChapter.start_time;
    const chapterEnd = selectedChapter.end_time;
    if (!Number.isFinite(chapterEnd) || chapterEnd <= chapterStart) return [];

    return timelineState.clips.filter((clip) => {
      if (!assetIds.has(clip.asset_id)) return false;
      const duration = clip.out_point - clip.in_point;
      if (!Number.isFinite(duration) || duration <= 0) return false;
      const clipStart = clip.start_time;
      const clipEnd = clip.start_time + duration;
      return clipEnd > chapterStart && clipStart < chapterEnd;
    });
  });

  const selectedChapterDuration = $derived.by(() => {
    if (!selectedChapter) return null;
    return Math.max(0.01, selectedChapter.end_time - selectedChapter.start_time);
  });
</script>

<div 
  class="project-detail"
  class:dragging={isDragging}
  role="presentation"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <!-- Header -->
  <div class="detail-header">
    <div class="header-left">
      <button class="back-btn" onclick={onBack}><Icon icon={ArrowLeft} size={16} /> Back</button>
      <h2>{project.name}</h2>
    </div>
    <div class="header-actions">
      {#if hasContent()}
        <button class="import-btn" onclick={() => setIsImporting(true)}>
          <Icon icon={FolderPlus} size={16} /> Import More
        </button>
      {/if}
      <button class="export-btn" onclick={() => showExportDialog = true}>
        <Icon icon={Share} size={16} /> Export
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
      {#if missingProjectAssets.length > 0}
        <div class="missing-media-banner">
          <div class="missing-media-header">
            <h3>Missing project media</h3>
            <span>{missingProjectAssets.length} asset{missingProjectAssets.length === 1 ? '' : 's'} unavailable</span>
          </div>
          <div class="missing-media-list">
            {#each missingProjectAssets as asset (asset.id)}
              <div class="missing-media-item">
                <p class="missing-media-name">{getAssetDisplayName(asset)}</p>
                <p class="missing-media-path">{asset.availability.savedPath}</p>
                {#if asset.availability.nearestExistingAncestor}
                  <p class="missing-media-ancestor">
                    Nearest existing path: {asset.availability.nearestExistingAncestor}
                  </p>
                {/if}
              </div>
            {/each}
          </div>
          <p class="missing-media-guidance">Mount the original storage and reload the project.</p>
          {#if missingMediaLooksExternal}
            <p class="missing-media-guidance secondary">This looks like external or network storage.</p>
          {/if}
        </div>
      {/if}

      <div class="project-layout">
        <!-- Chapter Panel Sidebar -->
        {#if !layoutState.leftCollapsed}
          <aside class="chapters-sidebar" style="width: {layoutState.leftWidth}px">
            <div class="left-sidebar-stack">
              <div class="left-sidebar-chapters">
                <ChapterPanel
                  projectAssets={projectDetail.assets}
                  onImportClick={() => setIsImporting(true)}
                />
              </div>

              {#if !layoutState.beatCollapsed}
                <div class="left-sidebar-clips">
                  <BeatPanel
                    clips={selectedChapterClips}
                    chapterStartTime={selectedChapter?.start_time ?? 0}
                    chapterDuration={selectedChapterDuration}
                  />
                </div>
              {/if}
            </div>
          </aside>
          <div
            class="resize-handle-vertical"
            role="separator"
            aria-orientation="vertical"
            onpointerdown={layoutController.handleLeftResize}
          ></div>
        {/if}
        
        <!-- Main Content Area -->
        <main class="main-content">
          <div class="editor-layout">
            <section class="editor-main" bind:this={editorMainRef}>
              <div class="editor-top-fixed" style="height: {layoutState.previewHeight}px">
                <div class="preview-top-toolbar">
                  <button
                    class="preview-toggle-btn"
                    onclick={() => showClipPreviewPanel = !showClipPreviewPanel}
                  >
                    {showClipPreviewPanel ? 'Hide Clip Player' : 'Show Clip Player'}
                  </button>
                </div>
                <div class="preview-top-layout" bind:this={previewTopLayoutRef}>
                  {#if showClipPreviewPanel}
                    <div class="clip-preview-pane" style="width: {layoutState.clipPreviewWidth}px">
                      <ClipPreview />
                    </div>

                    <div
                      class="resize-handle-vertical clip-preview-resize"
                      role="separator"
                      aria-orientation="vertical"
                      onpointerdown={layoutController.handleClipPreviewResize}
                    ></div>
                  {/if}

                  <div class="chapter-preview-pane">
                    <ChapterPreview
                      chapter={selectedChapter}
                      asset={chapterPreviewAsset}
                      clips={selectedChapterClips}
                    />
                  </div>
                </div>
              </div>
              <div
                class="resize-handle-horizontal"
                role="separator"
                aria-orientation="horizontal"
                onpointerdown={layoutController.handlePreviewResize}
              ></div>

              {#if chaptersState.selectedChapterId}
                <div class="editor-bottom-scrollable scrollbar-thin">
                  <div class="timeline-wrapper">
                    <div class="timeline-toolbar-row">
                      <div class="timeline-toolbar-main">
                        <TimelineToolbar />
                      </div>
                      {#if canShowSourceTracks}
                        <button
                          class="source-tracks-toggle"
                          class:active={showSourceTracks}
                          onclick={() => showSourceTracks = !showSourceTracks}
                        >
                          {showSourceTracks ? 'Hide Source Tracks' : 'Show Source Tracks'}
                        </button>
                      {/if}
                    </div>
                    <div class="timeline-container scrollbar-thin">
                      <Timeline 
                        projectId={project.id}
                        lanes={timelineLanes}
                        clips={timelineState.clips}
                        displayClips={selectedChapterClips}
                        chapterDuration={selectedChapterDuration}
                      />
                    </div>
                  </div>
                </div>
              {:else}
                <div class="editor-bottom-scrollable empty-selection">
                  <div class="empty-icon"><Icon icon={BookOpen} size={40} /></div>
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
                onpointerdown={layoutController.handleRightResize}
              ></div>
              <aside class="editor-side" style="width: {layoutState.rightWidth}px">
                <div class="side-panel chat-panel-wrapper full-height">
                  <ChatPanel />
                </div>
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
        <p class="progress-title">Generating waveforms... {Math.round(projectDetail.waveformProgress.percent)}%</p>
        <div class="progress-bar">
          <div class="progress-fill" style="width: {projectDetail.waveformProgress.percent}%"></div>
        </div>
        <p class="progress-status">{projectDetail.waveformProgress.status}</p>
      </div>
    </div>
  {/if}
  
  <!-- Export Dialog -->
  {#if showExportDialog}
    <div
      class="dialog-overlay"
      role="button"
      tabindex="0"
      aria-label="Close export dialog"
      onclick={() => showExportDialog = false}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault();
          showExportDialog = false;
        }
      }}
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export project"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <h3>Export Project</h3>
        <p class="dialog-description">Export your timeline to use in professional NLE software</p>
        
        <div class="format-list">
          {#each projectDetail.exportFormats as format (format.id)}
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
      <button onclick={() => setError(null)}><Icon icon={X} size={14} /></button>
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
  {#if !layoutState.leftCollapsed && layoutState.beatCollapsed}
    <button class="floating-toggle left clips" onclick={expandBeat}>
      Show Clips
    </button>
  {/if}
</div>

<style>
  .project-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-page);
    color: var(--text-primary);
    position: relative;
  }

  .project-detail.dragging {
    background: var(--surface-base);
    border: 2px dashed var(--accent-primary);
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-4) var(--space-6);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-normal);
  }

  .back-btn:hover {
    background: var(--surface-active);
    border-color: var(--border-strong);
  }

  .header-actions {
    display: flex;
    gap: var(--space-3);
  }

  .import-btn, .export-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    transition: all var(--transition-normal);
    border: none;
  }

  .import-btn {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .import-btn:hover {
    background: var(--border-strong);
  }

  .export-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
  }

  .export-btn:hover {
    background: var(--accent-primary-hover);
  }

  .detail-content {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .missing-media-banner {
    margin: var(--space-4) var(--space-4) 0;
    padding: var(--space-4);
    border: 1px solid var(--accent-warning);
    border-radius: var(--radius-lg);
    background: linear-gradient(180deg, #2a1f12 0%, #1b1610 100%);
    color: #f0d3a1;
  }

  .missing-media-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .missing-media-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-md);
  }

  .missing-media-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .missing-media-item {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.18);
  }

  .missing-media-name,
  .missing-media-path,
  .missing-media-ancestor,
  .missing-media-guidance {
    margin: 0;
  }

  .missing-media-name {
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
    margin-bottom: var(--space-1);
  }

  .missing-media-path,
  .missing-media-ancestor,
  .missing-media-guidance {
    font-size: var(--text-sm);
    line-height: 1.4;
    color: #d2c0a4;
    word-break: break-all;
  }

  .missing-media-guidance {
    margin-top: var(--space-3);
  }

  .missing-media-guidance.secondary {
    margin-top: var(--space-1);
    color: #c9b38d;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-4);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border-default);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .project-layout {
    display: flex;
    height: 100%;
    min-height: 0;
  }

  .chapters-sidebar {
    width: 300px;
    flex-shrink: 0;
    flex: 0 0 auto;
    border-right: 1px solid var(--border-default);
    overflow: hidden;
    min-height: 0;
  }

  .left-sidebar-stack {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .left-sidebar-chapters {
    flex: 1 1 auto;
    min-height: 220px;
    overflow: hidden;
  }

  .left-sidebar-clips {
    flex: 1 1 auto;
    min-height: 220px;
    overflow: hidden;
    border-top: 1px solid var(--border-default);
  }

  .chapters-sidebar :global(.chapter-panel) {
    height: 100%;
    border-right: none;
  }

  .chapters-sidebar :global(.beat-panel) {
    width: 100%;
    height: 100%;
    border-left: none;
    border-top: none;
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
    padding: var(--space-4);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .preview-top-toolbar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex: 0 0 auto;
  }

  .preview-toggle-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--surface-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  }

  .preview-toggle-btn:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .preview-top-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0;
    align-items: stretch;
  }

  .clip-preview-pane {
    flex: 0 0 auto;
    min-width: 220px;
    min-height: 0;
    overflow: hidden;
  }

  .clip-preview-resize {
    align-self: stretch;
  }

  .chapter-preview-pane {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    padding-left: var(--space-3);
  }

  .preview-top-layout :global(.clip-preview),
  .preview-top-layout :global(.chapter-preview) {
    height: 100%;
    min-height: 0;
  }

  @media (max-width: 980px) {
    .preview-top-layout {
      flex-direction: column;
      gap: var(--space-3);
    }

    .clip-preview-pane {
      flex: 1 1 45%;
      min-width: 0;
      width: auto !important;
    }

    .clip-preview-resize {
      display: none;
    }

    .chapter-preview-pane {
      flex: 1 1 55%;
      padding-left: 0;
    }
  }

  .editor-bottom-scrollable {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    padding-top: var(--space-2);
  }

  .editor-side {
    width: 360px;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border-default);
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

  .chat-panel-wrapper.full-height {
    flex: 1 1 auto;
    min-height: 0;
  }

  .editor-side :global(.chat-panel) {
    flex: 1;
    border-left: none;
    height: 100%;
  }

  .timeline-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 220px;
  }

  .timeline-toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .timeline-toolbar-main {
    flex: 1;
    min-width: 0;
  }

  .source-tracks-toggle {
    flex: 0 0 auto;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.2;
  }

  .source-tracks-toggle:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .source-tracks-toggle.active {
    background: var(--accent-primary-subtle);
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  .timeline-container {
    flex: 1;
    overflow: auto;
  }

  .resize-handle-vertical {
    width: 6px;
    flex: 0 0 6px;
    cursor: col-resize;
    background: var(--surface-page);
    transition: background var(--transition-normal);
    touch-action: none;
  }

  .resize-handle-vertical:hover {
    background: var(--surface-hover);
  }

  .resize-handle-horizontal {
    height: 6px;
    flex: 0 0 6px;
    cursor: row-resize;
    background: var(--surface-page);
    transition: background var(--transition-normal);
    touch-action: none;
  }

  .resize-handle-horizontal:hover {
    background: var(--surface-hover);
  }

  .empty-selection {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-disabled);
    text-align: center;
    padding: var(--space-8);
  }

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-4);
    opacity: 0.5;
  }

  .empty-selection h3 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-tertiary);
  }

  .empty-selection p {
    margin: 0;
    font-size: var(--text-base);
  }

  .floating-toggle {
    position: absolute;
    top: 96px;
    z-index: var(--z-float);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }

  .floating-toggle:hover {
    background: var(--surface-hover);
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

  .floating-toggle.left.clips {
    top: 140px;
  }

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
    z-index: var(--z-overlay);
  }

  .progress-dialog {
    background: var(--surface-raised);
    padding: var(--space-8);
    border-radius: var(--radius-lg);
    min-width: 300px;
  }

  .progress-title {
    margin: 0;
  }

  .progress-bar {
    height: 8px;
    background: var(--border-default);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin: var(--space-4) 0;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-primary);
  }

  .progress-status {
    font-size: var(--text-base);
    color: var(--text-tertiary);
    margin: 0;
  }

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
    z-index: var(--z-overlay);
  }

  .dialog {
    background: var(--surface-raised);
    padding: var(--space-8);
    border-radius: var(--radius-lg);
    min-width: 400px;
    max-width: 90vw;
  }

  .dialog h3 {
    margin: 0 0 var(--space-2) 0;
  }

  .dialog-description {
    color: var(--text-tertiary);
    margin: 0 0 var(--space-6) 0;
  }

  .format-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-6);
  }

  .format-option {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--surface-elevated);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-normal);
  }

  .format-option:hover,
  .format-option.selected {
    background: var(--surface-active);
  }

  .format-info {
    display: flex;
    flex-direction: column;
  }

  .format-name {
    font-weight: var(--weight-medium);
  }

  .format-desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .dialog-actions button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    border: none;
  }

  .dialog-actions .secondary {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .dialog-actions .primary {
    background: var(--accent-primary);
    color: var(--text-primary);
  }

  .error-toast {
    position: fixed;
    bottom: var(--space-4);
    right: var(--space-4);
    background: var(--accent-destructive);
    color: var(--text-primary);
    padding: var(--space-4);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    z-index: var(--z-overlay);
  }

  .error-toast button {
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    padding: 0;
  }
</style>
