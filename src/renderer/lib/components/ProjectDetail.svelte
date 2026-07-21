<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import ChapterCutTimeline from './chapter-cut/ChapterCutTimeline.svelte';
  import CutListPanel from './CutListPanel.svelte';
  import ImportChoice from './ImportChoice.svelte';
  import ChapterDefinition from './ChapterDefinition.svelte';
  import ChapterPanel from './ChapterPanel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import ChapterEditorViewer from './ChapterEditorViewer.svelte';
  import { prewarmProjectProxies } from '../api/projects.js';
  import { 
    projectDetail, 
    loadProjectDetail, 
    addAssetToProject, 
    deleteProjectAsset,
    clearProjectDetail,
    saveProjectTimelineState,
    exportProjectToFile,
    getMissingProjectAssets
  } from '../state/project-detail.svelte';
  import { 
    chaptersState, 
    loadChapters, 
    clearChaptersState,
    autoCreateChaptersFromFiles,
    setImportChoice,
    setIsImporting,
    selectChapter,
    updateChapter,
    loadAssetsForChapter,
    getSelectedChapter,
    getAssetsForChapter
  } from '../state/chapters.svelte';
  import { settingsState } from '../state/settings.svelte';
  import { buildProxyOptions } from '../state/settings-helpers.js';
  import {
    timelineState,
    setError,
    clearTimelineNotice,
    clearSelection as clearTimelineSelection,
  } from '../state/timeline.svelte';
  import { initKeyboardShortcuts } from '../state/keyboard.svelte';
  import {
    layoutState,
    loadLayout,
    persistLayout,
    setLeftWidth,
    setRightWidth,
    setPreviewHeight,
    setClipPreviewWidth,
    setLeftBottomHeight,
    expandLeft,
    expandChat,
    expandBeat,
  } from '../state/layout.svelte';
  import { looksLikeExternalStoragePath } from '../utils/media';
  import {
    onTranscriptionProgress,
    transcribeChapter as startChapterTranscription,
    getTranscriptionStatus,
  } from '../api/transcription.js';
  import { getPathForFile, showSaveDialog } from '../api/system.js';
  import { setTranscriptionProgress, setTranscriptionError } from '../state/transcription.svelte';
  import {
    agentState,
    applyAllSuggestions,
    applySuggestion,
    cancelActiveAgentTurn,
    focusSuggestion,
    rejectAllSuggestions,
    rejectSuggestion,
    syncAgentContext,
  } from '../state/agent.svelte';
  import { toAgentChapterId } from './project-detail-helpers.js';
  import {
    importProjectFiles,
  } from './project-detail-import.js';
  import { commitVodCut } from '../api/vod-cuts.js';
  import {
    exportProjectWithDialog,
  } from './project-detail-export.js';
  import {
    createProjectDetailLayoutController,
  } from './project-detail-layout.js';
  import {
    autoTranscribeChapters,
    transcribeMissingChaptersOnReopen,
  } from './project-detail-transcription.js';
  import {
    clipOverlapsChapterSourceRange,
    compareClipsBySourceTime,
  } from '../../../shared/utils/clip-timing.js';
  import ProjectEditorHeader from './ProjectEditorHeader.svelte';
  import Icon from './ui/Icon.svelte';
  import { BookOpen, Check, X, ChevronLeft, ChevronRight } from '../constants';
  import type { Project, Asset, VodCutRange } from '$shared/types/database';
  import type { ProjectAsset } from '$shared/contracts/ipc';
  
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
  let cleanupTranscription: (() => void) | null = null;
  let editorMainRef = $state<HTMLElement | null>(null);
  let previewTopLayoutRef = $state<HTMLElement | null>(null);
  let leftSidebarStackRef = $state<HTMLElement | null>(null);
  let previousSelectedChapterId: number | null = null;
  let previousAgentContextKey = $state<string | null>(null);
  let initialChapterLoadEvaluated = $state(false);
  let scheduledMissingChapterTranscription = $state(false);
  let vodResumeEvaluated = $state(false);
  let pendingChapterSelection = $state<number | null>(null);
  let pendingChapterCompletion = $state<number | null>(null);
  let pendingNavigationBack = $state(false);
  let isCancellingAgentTurn = $state(false);
  let pinnedDragAsset = $state<ProjectAsset | null>(null);

  const RESIZE_HANDLE_SIZE = 6;
  const MIN_LEFT_WIDTH = 220;
  const MAX_LEFT_WIDTH = 520;
  const MIN_RIGHT_WIDTH = 260;
  const MAX_RIGHT_WIDTH = 560;
  const MIN_PREVIEW_HEIGHT = 200;
  const MIN_TIMELINE_HEIGHT = 220;
  const MIN_LEFT_SIDEBAR_SECTION_HEIGHT = 220;
  const MIN_CLIP_PREVIEW_WIDTH = 240;
  const MIN_CHAPTER_PREVIEW_WIDTH = 360;

  const transcriptionDeps = {
    getTranscriptionStatus,
    startChapterTranscription,
    setTranscriptionError,
  };

  const layoutController = createProjectDetailLayoutController({
    getLeftWidth: () => layoutState.leftWidth,
    setLeftWidth,
    getRightWidth: () => layoutState.rightWidth,
    setRightWidth,
    getPreviewHeight: () => layoutState.previewHeight,
    setPreviewHeight,
    getClipPreviewWidth: () => layoutState.clipPreviewWidth,
    setClipPreviewWidth,
    getLeftBottomHeight: () => layoutState.leftBottomHeight,
    setLeftBottomHeight,
    persistLayout,
    getEditorMainRef: () => editorMainRef,
    getPreviewTopLayoutRef: () => previewTopLayoutRef,
    getLeftSidebarStackRef: () => leftSidebarStackRef,
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
    minLeftTopHeight: MIN_LEFT_SIDEBAR_SECTION_HEIGHT,
    minLeftBottomHeight: MIN_LEFT_SIDEBAR_SECTION_HEIGHT,
  });
  
  // Load project data and chapters on mount
  onMount(() => {
    loadLayout();
    loadProjectDetail(project.id);
    loadChapters(project.id);
    if (settingsState.settings.autoGenerateProxies) {
      void prewarmProjectProxies(project.id, buildProxyOptions(settingsState.settings)).then((result) => {
        if (!result.success) {
          console.warn('[ProjectPrewarm] Failed to schedule project proxies:', result.error);
        }
      }).catch((error) => {
        console.warn('[ProjectPrewarm] Failed to schedule project proxies:', error);
      });
    }
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
    if (agentState.activeTurn) void cancelActiveAgentTurn();
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
        selectChapter: requestChapterSelection,
        autoTranscribeOnImport: settingsState.settings.autoTranscribeOnImport,
        ...transcriptionDeps,
      }, getChapterImportProxyOptions());

      setIsImporting(false);
    } catch (error) {
      console.error('Failed to import files:', error);
      setError(`Failed to import files: ${(error as Error).message}`);
      setIsImporting(false);
    }
  }
  
  // Handle chapter creation from ChapterDefinition
  async function handleChaptersDefined(ranges: VodCutRange[]) {
    if (!vodAssetForDefinition) return;
    try {
      const result = await commitVodCut({
        projectId: project.id,
        assetId: vodAssetForDefinition.id,
        ranges: ranges.map((range) => ({
          title: range.title,
          startTime: range.start_time,
          endTime: range.end_time,
        })),
        prewarmProxy: settingsState.settings.proxyGenerationOnImport,
        proxyOptions: buildProxyOptions(settingsState.settings),
      });
      if (!result.success || !result.data?.length) {
        throw new Error(result.error || 'Failed to create chapters');
      }

      await loadChapters(project.id);
      requestChapterSelection(result.data[0].id);
      if (settingsState.settings.autoTranscribeOnImport) {
        await autoTranscribeChapters(
          result.data.map((chapter) => chapter.id),
          transcriptionDeps,
          { awaitCompletion: false, background: true },
        );
      }

      showChapterDefinition = false;
      vodAssetForDefinition = null;
      setIsImporting(false);
    } catch (error) {
      console.error('Failed to create chapters:', error);
      setError(`Failed to create chapters: ${(error as Error).message}`);
      setIsImporting(false);
      throw error;
    }
  }
  
  // Handle cancel from ChapterDefinition
  async function handleChapterDefinitionCancel() {
    await onBack();
  }

  async function handleChapterDefinitionDiscard() {
    if (!vodAssetForDefinition) return;
    const deleted = await deleteProjectAsset(vodAssetForDefinition.id);
    if (!deleted) throw new Error('Failed to discard imported VOD');
    showChapterDefinition = false;
    vodAssetForDefinition = null;
    setIsImporting(false);
  }

  const selectedChapter = $derived.by(() => getSelectedChapter());
  const completedChapterCount = $derived(
    chaptersState.chapters.filter((chapter) => Boolean(chapter.rough_cut_completed_at)).length
  );
  const pendingAgentSuggestions = $derived(
    agentState.suggestions.filter((suggestion) => suggestion.status === 'pending')
  );
  const selectedSuggestionIndex = $derived(
    pendingAgentSuggestions.findIndex((suggestion) => suggestion.id === agentState.selectedSuggestionId)
  );

  function reviewAdjacentSuggestion(direction: -1 | 1) {
    if (pendingAgentSuggestions.length === 0) return;
    const current = selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0;
    const next = (current + direction + pendingAgentSuggestions.length) % pendingAgentSuggestions.length;
    focusSuggestion(pendingAgentSuggestions[next].id);
  }

  async function persistChapterCompletion(chapterId: number, isComplete: boolean) {
    const updated = await updateChapter(chapterId, {
      roughCutCompletedAt: isComplete ? null : new Date().toISOString(),
    });
    if (!updated || isComplete) return;

    const ordered = [...chaptersState.chapters].sort(
      (left, right) => left.display_order - right.display_order || left.start_time - right.start_time
    );
    const index = ordered.findIndex((chapter) => chapter.id === chapterId);
    const next = ordered[index + 1];
    if (next) requestChapterSelection(next.id);
  }

  async function toggleSelectedChapterCompletion() {
    if (!selectedChapter) return;
    const chapterId = selectedChapter.id;
    const isComplete = Boolean(selectedChapter.rough_cut_completed_at);
    if (!isComplete && agentState.suggestions.some((suggestion) => suggestion.status === 'pending')) {
      const proceed = window.confirm('This chapter still has pending suggested cuts. Mark it complete anyway?');
      if (!proceed) return;
    }
    if (!isComplete && agentState.activeTurn) {
      pendingChapterCompletion = chapterId;
      pendingChapterSelection = null;
      pendingNavigationBack = false;
      return;
    }
    await persistChapterCompletion(chapterId, isComplete);
  }

  function finishChapterSelection(chapterId: number) {
    clearTimelineSelection();
    selectChapter(chapterId);
  }

  function requestChapterSelection(chapterId: number) {
    if (chaptersState.selectedChapterId === chapterId) return;
    if (agentState.activeTurn) {
      pendingChapterSelection = chapterId;
      pendingNavigationBack = false;
      return;
    }
    finishChapterSelection(chapterId);
  }

  function requestBackNavigation() {
    if (agentState.activeTurn) {
      pendingChapterSelection = null;
      pendingNavigationBack = true;
      return;
    }
    void onBack();
  }

  function dismissAgentCancelDialog() {
    if (isCancellingAgentTurn) return;
    pendingChapterSelection = null;
    pendingChapterCompletion = null;
    pendingNavigationBack = false;
  }

  async function confirmAgentCancellation() {
    if (isCancellingAgentTurn) return;
    isCancellingAgentTurn = true;
    try {
      const cancelled = await cancelActiveAgentTurn();
      if (!cancelled) return;

      const chapterId = pendingChapterSelection;
      const completionChapterId = pendingChapterCompletion;
      const shouldNavigateBack = pendingNavigationBack;
      pendingChapterSelection = null;
      pendingChapterCompletion = null;
      pendingNavigationBack = false;

      if (completionChapterId !== null) {
        await persistChapterCompletion(completionChapterId, false);
      } else if (chapterId !== null) {
        finishChapterSelection(chapterId);
      } else if (shouldNavigateBack) {
        await onBack();
      }
    } finally {
      isCancellingAgentTurn = false;
    }
  }

  function getChapterImportProxyOptions() {
    return {
      prewarmProxy: settingsState.settings.proxyGenerationOnImport,
      proxyOptions: buildProxyOptions(settingsState.settings),
    };
  }

  $effect(() => {
    const chapterId = selectedChapter?.id ?? null;
    if (chapterId === previousSelectedChapterId) return;
    clearTimelineSelection();
    pinnedDragAsset = null;
    previousSelectedChapterId = chapterId;
  });

  $effect(() => {
    if (vodResumeEvaluated) return;
    if (projectDetail.projectId !== project.id) return;
    if (projectDetail.isLoadingAssets || chaptersState.isLoading || chaptersState.isImporting) return;
    vodResumeEvaluated = true;
    if (chaptersState.chapters.length > 0) return;
    const resumableAsset = projectDetail.assets.find((asset) => asset.file_type === 'video');
    if (!resumableAsset) return;
    vodAssetForDefinition = resumableAsset;
    showChapterDefinition = true;
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

  const chapterPreviewAsset = $derived.by(() => {
    const selectedIds = timelineState.selectedClipIds;
    const selectedClipId = selectedIds.size === 1 ? [...selectedIds][0] : null;
    const selectedClip = selectedClipId === null
      ? null
      : timelineState.clips.find((clip) => clip.id === selectedClipId);
    const selectedClipAsset = selectedClip
      ? selectedChapterAssets.find((asset) => asset.id === selectedClip.asset_id)
      : null;
    const selectedSuggestion = agentState.suggestions.find(
      (suggestion) => suggestion.id === agentState.selectedSuggestionId
    );
    let selectedSuggestionAssetId: number | null = null;
    if (selectedSuggestion?.target_clip_id) {
      selectedSuggestionAssetId = timelineState.clips.find(
        (clip) => clip.id === selectedSuggestion.target_clip_id
      )?.asset_id ?? null;
    } else if (selectedSuggestion?.action_payload_json) {
      try {
        const payload = JSON.parse(selectedSuggestion.action_payload_json) as {
          create?: { assetId?: number };
        };
        if (typeof payload.create?.assetId === 'number') {
          selectedSuggestionAssetId = payload.create.assetId;
        }
      } catch {
        // Malformed action payloads are handled when the suggestion is applied.
      }
    }
    // Mirror the sole-linked-video rule used by validation and
    // createSuggestionTimelineClip so the reviewed footage matches the applied clip.
    if (selectedSuggestionAssetId === null && selectedSuggestion) {
      const chapterVideoAssets = selectedChapterAssets.filter((asset) => asset.file_type === 'video');
      if (chapterVideoAssets.length === 1) {
        selectedSuggestionAssetId = chapterVideoAssets[0]?.id ?? null;
      }
    }
    const selectedSuggestionAsset = selectedSuggestionAssetId === null
      ? null
      : selectedChapterAssets.find((asset) => asset.id === selectedSuggestionAssetId);
    // An active create drag pins the viewed asset before clearing selection;
    // keep the viewer on it for the drag's duration.
    return pinnedDragAsset
      ?? selectedClipAsset
      ?? selectedSuggestionAsset
      ?? selectedChapterAssets.find((asset) => asset.availability.exists !== false)
      ?? selectedChapterAssets[0]
      ?? null;
  });
  const hasChapterAssets = $derived.by(() =>
    selectedChapter ? chaptersState.chapterAssets.has(selectedChapter.id) : false
  );

  const showLeftDock = $derived.by(() => layoutState.leftCollapsed);
  const showRightDock = $derived.by(() => layoutState.chatCollapsed);
  const showClipsDock = $derived.by(() => !layoutState.leftCollapsed && layoutState.beatCollapsed);

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
              const created = await autoCreateChaptersFromFiles(
                project.id,
                [asset],
                getChapterImportProxyOptions()
              );
              if (created.length > 0) {
                requestChapterSelection(created[0].id);
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
    if (showLeftDock || showClipsDock || !leftSidebarStackRef) return;

    layoutController.clampLeftBottomHeight();

    const observer = new ResizeObserver(() => {
      if (showLeftDock || showClipsDock) return;
      layoutController.clampLeftBottomHeight();
    });

    observer.observe(leftSidebarStackRef);

    return () => {
      observer.disconnect();
    };
  });
  
  const selectedChapterClips = $derived.by(() => {
    if (!selectedChapter) return [];
    if (selectedChapterAssetIds.length === 0) return [];
    const assetIds = new Set(selectedChapterAssetIds);
    if (!Number.isFinite(selectedChapter.end_time) || selectedChapter.end_time <= selectedChapter.start_time) return [];

    return timelineState.clips
      .filter((clip) => assetIds.has(clip.asset_id))
      .filter((clip) => clipOverlapsChapterSourceRange(clip, selectedChapter))
      .sort(compareClipsBySourceTime);
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
    onBack={requestBackNavigation}
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
        onDiscard={handleChapterDefinitionDiscard}
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
            <div class="left-sidebar-stack flex h-full min-h-0 flex-col" bind:this={leftSidebarStackRef}>
              <div
                class="left-sidebar-chapters min-h-0 flex-1 overflow-hidden"
                style="min-height: {MIN_LEFT_SIDEBAR_SECTION_HEIGHT}px"
              >
                <ChapterPanel
                  class="h-full border-r-0"
                  projectAssets={projectDetail.assets}
                  onImportClick={() => setIsImporting(true)}
                  onChapterSelect={requestChapterSelection}
                />
              </div>

              {#if !showClipsDock}
                <div
                  class="resize-handle-horizontal h-[6px] flex-[0_0_6px] cursor-row-resize touch-none bg-surface-page transition-colors hover:bg-surface-hover"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize clips panel"
                  onpointerdown={layoutController.handleLeftSectionResize}
                ></div>
                <div
                  class="left-sidebar-clips min-h-0 shrink-0 overflow-hidden border-t border-border-default"
                  style="height: {layoutState.leftBottomHeight}px; min-height: {MIN_LEFT_SIDEBAR_SECTION_HEIGHT}px"
                >
                  <CutListPanel
                    class="h-full w-full border-l-0"
                    clips={selectedChapterClips}
                    chapterStartTime={selectedChapter?.start_time ?? 0}
                    chapterEndTime={selectedChapter?.end_time}
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
              <span class="text-app-xs font-medium tracking-[0.04em] [text-orientation:mixed] [writing-mode:vertical-rl]">
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
                <div class="flex shrink-0 items-center justify-between gap-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <h2 class="m-0 truncate text-app-base font-semibold text-text-primary">{selectedChapter?.title || 'Select a chapter'}</h2>
                      {#if selectedChapter?.rough_cut_completed_at}
                        <span class="inline-flex items-center gap-1 rounded-sm border border-accent-primary bg-accent-primary-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-accent-primary"><Icon icon={Check} size={11} /> Complete</span>
                      {/if}
                    </div>
                    <p class="m-0 mt-0.5 text-app-xs text-text-tertiary">{completedChapterCount} of {chaptersState.chapters.length} chapters complete</p>
                  </div>
                  {#if selectedChapter}
                    <button
                      type="button"
                      class="shrink-0 rounded-md border border-border-default bg-surface-raised px-3 py-1.5 text-app-xs font-semibold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text-primary"
                      onclick={toggleSelectedChapterCompletion}
                    >
                      {selectedChapter.rough_cut_completed_at ? 'Reopen rough cut' : 'Complete & next'}
                    </button>
                  {/if}
                </div>
                <div
                  class="preview-top-layout flex flex-1 min-h-0 items-stretch"
                  bind:this={previewTopLayoutRef}
                >
                  <div class="chapter-preview-pane min-h-0 min-w-0 flex-1 overflow-hidden">
                    <ChapterEditorViewer
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
                  <div class="timeline-wrapper flex min-h-[260px] flex-1 flex-col overflow-hidden">
                    {#if pendingAgentSuggestions.length > 0}
                      <div class="mb-2 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-accent-warning/40 bg-accent-warning-subtle px-3 py-2">
                        <div class="min-w-0">
                          <p class="m-0 text-app-xs font-semibold text-accent-warning">Suggested cuts · {pendingAgentSuggestions.length} pending</p>
                          <p class="m-0 mt-0.5 truncate text-app-xs text-text-secondary">
                            {pendingAgentSuggestions[selectedSuggestionIndex >= 0 ? selectedSuggestionIndex : 0]?.description || 'Select a dashed range to review it'}
                          </p>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <button type="button" class="rounded-sm border border-border-default bg-surface-base px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover" onclick={() => reviewAdjacentSuggestion(-1)}>Previous</button>
                          <button type="button" class="rounded-sm border border-border-default bg-surface-base px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover" onclick={() => reviewAdjacentSuggestion(1)}>Next</button>
                          {#if agentState.selectedSuggestionId !== null}
                            <button type="button" class="rounded-sm border border-accent-destructive px-2 py-1 text-app-xs text-accent-destructive hover:bg-accent-destructive hover:text-white" onclick={() => rejectSuggestion(agentState.selectedSuggestionId!)}>Reject</button>
                            <button type="button" class="rounded-sm border border-accent-primary bg-accent-primary px-2 py-1 text-app-xs font-semibold text-white hover:bg-accent-primary-hover" onclick={() => applySuggestion(agentState.selectedSuggestionId!)}>Accept</button>
                          {/if}
                          <button type="button" class="rounded-sm px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={rejectAllSuggestions}>Reject all</button>
                          <button type="button" class="rounded-sm px-2 py-1 text-app-xs font-semibold text-accent-primary hover:bg-accent-primary-subtle" onclick={applyAllSuggestions}>Accept all</button>
                        </div>
                      </div>
                    {/if}
                    {#if selectedChapter}
                      <ChapterCutTimeline
                        projectId={project.id}
                        chapter={selectedChapter}
                        assets={selectedChapterAssets}
                        clips={selectedChapterClips}
                        suggestions={agentState.suggestions}
                        playbackAvailable={chapterPreviewAsset !== null && chapterPreviewAsset.availability.exists !== false}
                        activeAsset={chapterPreviewAsset}
                        onPinnedAssetChange={(asset) => (pinnedDragAsset = asset)}
                      />
                    {/if}
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
                  <span class="text-app-xs font-medium tracking-[0.04em] [text-orientation:mixed] [writing-mode:vertical-rl]">
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
  {#if pendingChapterSelection !== null || pendingChapterCompletion !== null || pendingNavigationBack}
    <div
      class="dialog-overlay fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-black/60 px-4"
      role="presentation"
      onclick={dismissAgentCancelDialog}
    >
      <div
        class="w-full max-w-[460px] rounded-lg border border-border-default bg-surface-base p-6 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-agent-turn-title"
        tabindex="-1"
        onclick={(event) => event.stopPropagation()}
        onkeydown={(event) => event.stopPropagation()}
      >
        <p class="mb-2 text-app-xs font-semibold uppercase tracking-[0.08em] text-accent-warning">Agent response in progress</p>
        <h2 id="cancel-agent-turn-title" class="m-0 text-app-lg font-semibold text-text-primary">
          {pendingChapterCompletion !== null ? 'Cancel this response before completing?' : 'Cancel this response before leaving?'}
        </h2>
        <p class="mb-0 mt-3 text-app-sm leading-[1.6] text-text-secondary">
          The response belongs to {selectedChapter?.title || 'this chapter'}. Cancelling keeps your message in the conversation so you can reroll it later.
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-border-default bg-transparent px-4 py-2 text-app-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            onclick={dismissAgentCancelDialog}
            disabled={isCancellingAgentTurn}
          >
            Stay here
          </button>
          <button
            type="button"
            class="rounded-md border border-accent-destructive bg-accent-destructive px-4 py-2 text-app-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            onclick={confirmAgentCancellation}
            disabled={isCancellingAgentTurn}
          >
            {isCancellingAgentTurn ? 'Cancelling...' : pendingChapterCompletion !== null ? 'Cancel response & complete' : 'Cancel response & leave'}
          </button>
        </div>
      </div>
    </div>
  {/if}

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
  
  {#if timelineState.notice || timelineState.error}
    <div class="pointer-events-none fixed right-4 bottom-4 z-[var(--z-toast)] flex max-w-sm flex-col gap-2">
      {#if timelineState.notice}
        <div class="pointer-events-auto flex items-start gap-3 rounded-sm border border-border-subtle bg-surface-raised px-3 py-2 text-app-sm text-text-secondary shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          <p class="m-0 min-w-0 flex-1">{timelineState.notice.message}</p>
          <button
            class="inline-flex shrink-0 items-center bg-transparent p-0 text-text-tertiary transition-opacity hover:opacity-80"
            onclick={clearTimelineNotice}
            aria-label="Dismiss timeline notice"
          >
            <Icon icon={X} size={14} />
          </button>
        </div>
      {/if}

      {#if timelineState.error}
        <div class="error-toast pointer-events-auto flex items-center gap-4 rounded-sm border border-accent-destructive bg-surface-base px-4 py-3 text-accent-destructive">
          <p class="m-0 min-w-0 flex-1">{timelineState.error}</p>
          <button
            class="inline-flex shrink-0 items-center bg-transparent p-0 text-accent-destructive hover:opacity-80"
            onclick={() => setError(null)}
          >
            <Icon icon={X} size={14} />
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
