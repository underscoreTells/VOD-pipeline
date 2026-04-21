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
  import ProjectEditorHeader from './ProjectEditorHeader.svelte';
  import Icon from './ui/Icon.svelte';
  import { BookOpen, X, ChevronLeft, ChevronRight } from '../constants';
  import type { Project, Asset } from '$shared/types/database';
  import type { ProjectAsset } from '$shared/contracts/ipc';
  
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

  const showLeftDock = $derived.by(() => layoutState.leftCollapsed);
  const showRightDock = $derived.by(() => layoutState.chatCollapsed);
  const showClipsDock = $derived.by(() => !layoutState.leftCollapsed && layoutState.beatCollapsed);

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
  class={`project-detail relative flex h-full min-h-0 flex-col bg-surface-page text-text-primary ${isDragging ? 'border-2 border-dashed border-accent-primary bg-surface-base' : ''}`}
  role="presentation"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <ProjectEditorHeader
    projectName={project.name}
    showImportMore={hasContent()}
    onBack={onBack}
    onImportMore={() => setIsImporting(true)}
    onExport={() => showExportDialog = true}
  />
  
  <!-- Main Content -->
  <div class="detail-content relative flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if projectDetail.isLoadingAssets || projectDetail.isLoadingClips || chaptersState.isLoading}
      <div class="loading flex h-full flex-col items-center justify-center gap-4">
        <span class="spinner h-10 w-10 animate-spin rounded-full border-[3px] border-border-default border-t-accent-primary"></span>
        <p class="text-text-secondary">Loading project...</p>
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
        <div class="missing-media-banner mx-4 mt-4 rounded-[4px] border-l-[3px] border-accent-warning bg-surface-raised p-4 text-text-secondary">
          <div class="missing-media-header mb-3 flex items-baseline justify-between gap-4">
            <h3 class="text-app-md text-text-primary">Missing project media</h3>
            <span class="text-app-sm text-text-secondary">
              {missingProjectAssets.length} asset{missingProjectAssets.length === 1 ? '' : 's'} unavailable
            </span>
          </div>
          <div class="missing-media-list flex flex-col gap-3">
            {#each missingProjectAssets as asset (asset.id)}
              <div class="missing-media-item border-b border-border-subtle py-2 last:border-b-0">
                <p class="missing-media-name mb-1 font-medium text-text-primary">{getAssetDisplayName(asset)}</p>
                <p class="missing-media-path break-all text-app-sm leading-[1.4] text-text-secondary">
                  {asset.availability.savedPath}
                </p>
                {#if asset.availability.nearestExistingAncestor}
                  <p class="missing-media-ancestor break-all text-app-sm leading-[1.4] text-text-secondary">
                    Nearest existing path: {asset.availability.nearestExistingAncestor}
                  </p>
                {/if}
              </div>
            {/each}
          </div>
          <p class="missing-media-guidance mt-3 break-all text-app-sm leading-[1.4] text-text-tertiary">
            Mount the original storage and reload the project.
          </p>
          {#if missingMediaLooksExternal}
            <p class="missing-media-guidance secondary mt-1 break-all text-app-sm leading-[1.4] text-text-tertiary">
              This looks like external or network storage.
            </p>
          {/if}
        </div>
      {/if}

      <div class="project-layout flex h-full min-h-0 flex-1">
        <!-- Chapter Panel Sidebar -->
        {#if !showLeftDock}
          <aside
            class="chapters-sidebar min-h-0 flex-[0_0_auto] overflow-hidden border-r border-border-default"
            style="width: {layoutState.leftWidth}px"
          >
            <div class="left-sidebar-stack flex h-full min-h-0 flex-col">
              <div class="left-sidebar-chapters min-h-[220px] flex-[1_1_auto] overflow-hidden">
                <ChapterPanel
                  class="h-full border-r-0"
                  projectAssets={projectDetail.assets}
                  onImportClick={() => setIsImporting(true)}
                />
              </div>

              {#if !showClipsDock}
                <div class="left-sidebar-clips min-h-[220px] flex-[1_1_auto] overflow-hidden border-t border-border-default">
                  <BeatPanel
                    class="h-full w-full border-l-0"
                    clips={selectedChapterClips}
                    chapterStartTime={selectedChapter?.start_time ?? 0}
                    chapterDuration={selectedChapterDuration}
                  />
                </div>
              {:else}
                <div class="clips-panel-dock flex h-14 shrink-0 items-center border-t border-border-default bg-surface-base px-3">
                  <button
                    type="button"
                    class="group inline-flex items-center gap-2 rounded-2xl border border-border-default bg-surface-elevated px-3.5 py-2 text-app-sm font-medium text-text-secondary shadow-[0_16px_30px_-24px_rgba(0,0,0,0.7)] transition-[transform,background-color,border-color,color] duration-200 hover:-translate-y-px hover:border-border-strong hover:bg-surface-hover hover:text-text-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-border-focus"
                    onclick={expandBeat}
                    title="Show clips"
                    aria-label="Show clips panel"
                  >
                    <Icon icon={ChevronRight} size={14} class="text-text-tertiary transition-colors group-hover:text-text-primary" />
                    <span>Show clips</span>
                  </button>
                </div>
              {/if}
            </div>
          </aside>
          <div
            class="resize-handle-vertical w-[6px] flex-[0_0_6px] cursor-col-resize touch-none bg-surface-page transition-colors hover:bg-surface-hover"
            role="separator"
            aria-orientation="vertical"
            onpointerdown={layoutController.handleLeftResize}
          ></div>
        {:else}
          <aside class="left-panel-dock flex min-h-0 w-[52px] shrink-0 items-start justify-center border-r border-border-default bg-surface-page px-2 py-4 max-[980px]:w-11">
            <button
              type="button"
              class="group inline-flex h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border-default bg-surface-elevated px-2 py-3 text-text-secondary shadow-[0_18px_32px_-24px_rgba(0,0,0,0.7)] transition-[transform,background-color,border-color,color] duration-200 hover:-translate-y-px hover:border-border-strong hover:bg-surface-hover hover:text-text-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-border-focus max-[980px]:h-32 max-[980px]:gap-2"
              onclick={expandLeft}
              title="Show chapters"
              aria-label="Show chapters panel"
            >
              <Icon icon={ChevronRight} size={14} class="text-text-tertiary transition-colors group-hover:text-text-primary" />
              <span class="text-[11px] font-medium tracking-[0.08em] [text-orientation:mixed] [writing-mode:vertical-rl]">
                Chapters
              </span>
            </button>
          </aside>
        {/if}
        
        <!-- Main Content Area -->
        <main class="main-content flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="editor-layout flex flex-1 min-h-0 overflow-hidden">
            <section class="editor-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" bind:this={editorMainRef}>
              <div
                class="editor-top-fixed box-border flex shrink-0 flex-col gap-2 overflow-hidden border-b border-border-subtle px-4 pt-4 pb-2"
                style="height: {layoutState.previewHeight}px"
              >
                <div class="preview-top-toolbar flex shrink-0 items-center justify-end">
                  <button
                    class="preview-toggle-btn rounded-[4px] border border-border-default bg-transparent px-2.5 py-1 text-app-sm text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
                    onclick={() => showClipPreviewPanel = !showClipPreviewPanel}
                  >
                    {showClipPreviewPanel ? 'Hide Clip Player' : 'Show Clip Player'}
                  </button>
                </div>
                <div
                  class="preview-top-layout flex flex-1 min-h-0 items-stretch gap-3 max-[980px]:flex-col"
                  bind:this={previewTopLayoutRef}
                >
                  {#if showClipPreviewPanel}
                    <div class="clip-preview-pane min-h-0 min-w-0 flex-1 basis-0 overflow-hidden max-[980px]:flex-auto">
                      <ClipPreview class="h-full min-h-0" />
                    </div>
                  {/if}

                  <div class="chapter-preview-pane min-h-0 min-w-0 flex-1 basis-0 max-[980px]:flex-auto">
                    <ChapterPreview
                      class="h-full min-h-0"
                      chapter={selectedChapter}
                      asset={chapterPreviewAsset}
                      clips={selectedChapterClips}
                    />
                  </div>
                </div>
              </div>
              <div
                class="resize-handle-horizontal h-[6px] flex-[0_0_6px] cursor-row-resize touch-none bg-surface-page transition-colors hover:bg-surface-hover"
                role="separator"
                aria-orientation="horizontal"
                onpointerdown={layoutController.handlePreviewResize}
              ></div>

              {#if chaptersState.selectedChapterId}
                <div class="editor-bottom-scrollable scrollbar-thin flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 pt-2 pb-4">
                  <div class="timeline-wrapper flex min-h-[220px] flex-1 flex-col overflow-hidden">
                    <div class="timeline-toolbar-row flex items-center gap-3">
                      <div class="timeline-toolbar-main min-w-0 flex-1">
                        <TimelineToolbar />
                      </div>
                      {#if canShowSourceTracks}
                        <button
                          class={`source-tracks-toggle flex-none rounded-[4px] border px-2.5 py-1 text-app-sm leading-[1.2] transition-all ${
                            showSourceTracks
                              ? 'border-accent-primary bg-accent-primary-subtle text-accent-primary'
                              : 'border-border-default bg-transparent text-text-secondary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary'
                          }`}
                          onclick={() => showSourceTracks = !showSourceTracks}
                        >
                          {showSourceTracks ? 'Hide Source Tracks' : 'Show Source Tracks'}
                        </button>
                      {/if}
                    </div>
                    <div class="timeline-container scrollbar-thin flex-1 overflow-auto">
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
                <div class="editor-bottom-scrollable empty-selection flex h-full flex-col items-center justify-center px-8 py-8 text-center text-text-disabled">
                  <div class="empty-icon mb-4 flex items-center justify-center opacity-50">
                    <Icon icon={BookOpen} size={40} />
                  </div>
                  <h3 class="mb-2 mt-0 text-text-tertiary">Select a Chapter</h3>
                  <p class="m-0 text-app-base">Choose a chapter from the sidebar to view its timeline and beats</p>
                </div>
              {/if}
            </section>

            {#if !showRightDock}
              <div
                class="resize-handle-vertical w-[6px] flex-[0_0_6px] cursor-col-resize touch-none bg-surface-page transition-colors hover:bg-surface-hover"
                role="separator"
                aria-orientation="vertical"
                onpointerdown={layoutController.handleRightResize}
              ></div>
              <aside
                class="editor-side flex min-h-0 min-w-0 flex-[0_0_auto] flex-col overflow-hidden border-l border-border-default"
                style="width: {layoutState.rightWidth}px"
              >
                <div class="side-panel chat-panel-wrapper flex min-h-[240px] flex-1 flex-col overflow-hidden">
                  <ChatPanel class="h-full flex-1" />
                </div>
              </aside>
            {:else}
              <aside class="right-panel-dock flex min-h-0 w-[52px] shrink-0 items-start justify-center border-l border-border-default bg-surface-page px-2 py-4 max-[980px]:w-11">
                <button
                  type="button"
                  class="group inline-flex h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-border-default bg-surface-elevated px-2 py-3 text-text-secondary shadow-[0_18px_32px_-24px_rgba(0,0,0,0.7)] transition-[transform,background-color,border-color,color] duration-200 hover:-translate-y-px hover:border-border-strong hover:bg-surface-hover hover:text-text-primary active:translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-border-focus max-[980px]:h-32 max-[980px]:gap-2"
                  onclick={expandChat}
                  title="Show chat"
                  aria-label="Show chat panel"
                >
                  <Icon icon={ChevronLeft} size={14} class="text-text-tertiary transition-colors group-hover:text-text-primary" />
                  <span class="text-[11px] font-medium tracking-[0.08em] [text-orientation:mixed] [writing-mode:vertical-rl]">
                    Chat
                  </span>
                </button>
              </aside>
            {/if}
          </div>
        </main>
      </div>
    {/if}
  </div>
  
  <!-- Waveform Generation Progress -->
  {#if projectDetail.isGeneratingWaveform}
    <div class="progress-overlay fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/60">
      <div class="progress-dialog min-w-[300px] rounded-md border border-border-default bg-surface-base p-8">
        <p class="progress-title m-0">Generating waveforms... {Math.round(projectDetail.waveformProgress.percent)}%</p>
        <div class="progress-bar my-4 h-2 overflow-hidden rounded-sm bg-border-default">
          <div
            class="progress-fill h-full bg-accent-primary"
            style="width: {projectDetail.waveformProgress.percent}%"
          ></div>
        </div>
        <p class="progress-status m-0 text-app-base text-text-tertiary">{projectDetail.waveformProgress.status}</p>
      </div>
    </div>
  {/if}
  
  <!-- Export Dialog -->
  {#if showExportDialog}
    <div
      class="dialog-overlay fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/60"
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
        class="dialog min-w-[400px] max-w-[90vw] rounded-md border border-border-default bg-surface-base p-8"
        role="dialog"
        aria-modal="true"
        aria-label="Export project"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <h3 class="mb-2 mt-0">Export Project</h3>
        <p class="dialog-description mb-6 mt-0 text-text-tertiary">
          Export your timeline to use in professional NLE software
        </p>
        
        <div class="format-list mb-6 flex flex-col gap-2">
          {#each projectDetail.exportFormats as format (format.id)}
            <label
              class={`format-option flex cursor-pointer items-center gap-3 rounded-[4px] border p-3 transition-colors ${
                selectedExportFormat === format.id
                  ? 'border-border-default bg-surface-hover'
                  : 'border-transparent bg-surface-raised hover:border-border-default hover:bg-surface-hover'
              }`}
            >
              <input 
                type="radio" 
                name="format" 
                value={format.id}
                bind:group={selectedExportFormat}
              />
              <div class="format-info flex flex-col">
                <span class="format-name font-medium">{format.name}</span>
                <span class="format-desc text-app-sm text-text-tertiary">{format.description}</span>
              </div>
            </label>
          {/each}
        </div>
        
        <div class="dialog-actions flex justify-end gap-3">
          <button
            class="secondary rounded-sm border border-border-default bg-transparent px-4 py-2 font-medium text-text-secondary transition-all hover:bg-surface-hover hover:text-text-primary"
            onclick={() => showExportDialog = false}
          >
            Cancel
          </button>
          <button
            class="primary rounded-sm border border-accent-primary bg-accent-primary px-4 py-2 font-medium text-white transition-all hover:border-accent-primary-hover hover:bg-accent-primary-hover"
            onclick={handleExport}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  {/if}
  
  <!-- Error Display -->
  {#if timelineState.error}
    <div class="error-toast fixed right-4 bottom-4 z-[var(--z-overlay)] flex items-center gap-4 rounded-sm border border-accent-destructive bg-surface-base px-4 py-3 text-accent-destructive">
      <p>{timelineState.error}</p>
      <button
        class="inline-flex items-center bg-transparent p-0 text-accent-destructive hover:opacity-80"
        onclick={() => setError(null)}
      >
        <Icon icon={X} size={14} />
      </button>
    </div>
  {/if}
</div>
