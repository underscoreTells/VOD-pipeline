<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Asset } from '../../../shared/types/database';
  import type { AssetAvailability } from '../../../shared/contracts/ipc';
  import { buildPlayableAssetUrl } from '../utils/media';
  import { formatTime } from '../utils/time';
  import Icon from './ui/Icon.svelte';
  import {
    createDraftChapterRange,
    getDraftChapterDuration,
    getDraftChapterRangeById,
    insertDraftChapterRange,
    MIN_DRAFT_CHAPTER_DURATION_SECONDS,
    moveDraftChapterRange,
    removeDraftChapterRange,
    resizeDraftChapterRange,
    type DraftChapterRange,
  } from './chapter-definition-timeline.js';
  import { ArrowRight, Play, Trash2 } from '../constants';

  type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };
  type TimelineDragMode = 'create' | 'move' | 'resize-start' | 'resize-end';

  interface DraftSelectionPreview {
    startTime: number;
    endTime: number;
  }

  interface Props {
    asset: AvailabilityAwareAsset;
    projectId: number;
    onComplete: (chapters: Array<{ title: string; startTime: number; endTime: number }>) => void;
    onCancel: () => void;
  }

  let { asset, projectId, onComplete, onCancel }: Props = $props();

  const RESIZE_HANDLE_SIZE = 6;
  const MIN_DEFINITION_TOP = 220;
  const MIN_DEFINITION_BOTTOM = 240;
  const TIMELINE_DRAG_THRESHOLD_PX = 4;

  let videoRef = $state<HTMLVideoElement | null>(null);
  let timelineTrackRef = $state<HTMLDivElement | null>(null);
  let definitionContainer = $state<HTMLElement | null>(null);
  let definitionTopHeight = $state(320);
  let videoDuration = $state(0);
  let playheadTime = $state(0);
  let draftChapters = $state<DraftChapterRange[]>([]);
  let selectedDraftChapterId = $state<number | null>(null);
  let previewChapterId = $state<number | null>(null);
  let draftSelectionPreview = $state<DraftSelectionPreview | null>(null);
  let nextDraftChapterId = $state(1);

  let activeTimelinePointerId = $state<number | null>(null);
  let activeTimelineMode = $state<TimelineDragMode | null>(null);
  let dragStartClientX = $state(0);
  let dragAnchorTime = $state(0);
  let dragDidMove = $state(false);
  let dragRangeId = $state<number | null>(null);
  let dragMoveOffset = $state(0);
  let clearTimelineDragListeners: (() => void) | null = null;

  const assetUnavailable = $derived(asset.availability?.exists === false);
  const videoSrc = $derived(buildPlayableAssetUrl(asset));
  const duration = $derived(videoDuration || asset.duration || 0);
  const playheadPercent = $derived(duration > 0 ? (playheadTime / duration) * 100 : 0);
  const selectedDraftChapter = $derived.by(
    () => (
      typeof selectedDraftChapterId === 'number'
        ? getDraftChapterRangeById(draftChapters, selectedDraftChapterId)
        : null
    )
  );
  const selectedDraftChapterDuration = $derived(
    selectedDraftChapter ? getDraftChapterDuration(selectedDraftChapter) : 0
  );
  const draftChapterCountLabel = $derived(
    `${draftChapters.length} chapter${draftChapters.length === 1 ? '' : 's'}`
  );
  const timelineMarkers = $derived.by(() => {
    if (duration <= 0) return [0];
    const markerCount = Math.min(10, Math.max(4, Math.floor(duration / 900) + 4));
    return Array.from({ length: markerCount + 1 }, (_, index) => (
      duration * (index / markerCount)
    ));
  });

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function percentForTime(time: number): number {
    if (duration <= 0) return 0;
    return clamp((time / duration) * 100, 0, 100);
  }

  function widthPercentForRange(startTime: number, endTime: number): number {
    return Math.max(0, percentForTime(endTime) - percentForTime(startTime));
  }

  function normalizePreviewRange(startTime: number, endTime: number): DraftSelectionPreview {
    return {
      startTime: Math.min(startTime, endTime),
      endTime: Math.max(startTime, endTime),
    };
  }

  function clearPreviewSession() {
    previewChapterId = null;
    if (!videoRef) return;
    if (!videoRef.paused) {
      videoRef.pause();
    }
  }

  function seekVideo(time: number) {
    if (!videoRef) return;
    const maxDuration = videoRef.duration || duration;
    const clampedTime = maxDuration > 0
      ? clamp(time, 0, maxDuration)
      : Math.max(0, time);
    videoRef.currentTime = clampedTime;
  }

  function updatePlayhead(time: number, options: { syncVideo?: boolean } = {}) {
    playheadTime = clamp(time, 0, duration);
    if (options.syncVideo === false) {
      return;
    }
    previewChapterId = null;
    seekVideo(playheadTime);
  }

  function selectDraftChapter(id: number | null, options: { seekToStart?: boolean } = {}) {
    selectedDraftChapterId = id;
    previewChapterId = null;

    if (id === null) {
      return;
    }

    const chapter = getDraftChapterRangeById(draftChapters, id);
    if (!chapter) {
      return;
    }

    if (options.seekToStart !== false) {
      updatePlayhead(chapter.startTime);
    }
  }

  function getTimelineTimeForClientX(clientX: number): number | null {
    if (!timelineTrackRef || duration <= 0) return null;
    const rect = timelineTrackRef.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return ratio * duration;
  }

  function clearTimelinePointerDrag() {
    clearTimelineDragListeners?.();
    clearTimelineDragListeners = null;
    activeTimelinePointerId = null;
    activeTimelineMode = null;
    dragRangeId = null;
    dragMoveOffset = 0;
    dragDidMove = false;
    draftSelectionPreview = null;
  }

  function beginTimelinePointerDrag(
    event: PointerEvent,
    mode: TimelineDragMode
  ) {
    activeTimelinePointerId = event.pointerId;
    activeTimelineMode = mode;
    dragStartClientX = event.clientX;
    dragDidMove = false;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = mode === 'move'
      ? 'grabbing'
      : mode === 'create'
        ? 'crosshair'
        : 'ew-resize';

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== activeTimelinePointerId) return;
      handleTimelinePointerMove(moveEvent);
    };

    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== activeTimelinePointerId) return;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      finishTimelinePointerDrag(endEvent);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);

    clearTimelineDragListeners = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }

  function handleTimelinePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    if (assetUnavailable || duration <= 0) return;

    const anchorTime = getTimelineTimeForClientX(event.clientX);
    if (anchorTime === null) return;

    event.preventDefault();
    clearPreviewSession();
    selectedDraftChapterId = null;
    dragAnchorTime = anchorTime;
    draftSelectionPreview = { startTime: anchorTime, endTime: anchorTime };
    beginTimelinePointerDrag(event, 'create');
  }

  function handleDraftChapterPointerDown(event: PointerEvent, chapterId: number) {
    if (event.button !== 0) return;
    if (assetUnavailable || duration <= 0) return;
    const chapter = getDraftChapterRangeById(draftChapters, chapterId);
    if (!chapter) return;

    const pointerTime = getTimelineTimeForClientX(event.clientX);
    if (pointerTime === null) return;

    event.preventDefault();
    event.stopPropagation();
    clearPreviewSession();
    selectDraftChapter(chapterId);
    dragRangeId = chapterId;
    dragMoveOffset = clamp(pointerTime - chapter.startTime, 0, getDraftChapterDuration(chapter));
    beginTimelinePointerDrag(event, 'move');
  }

  function handleDraftChapterResizePointerDown(
    event: PointerEvent,
    chapterId: number,
    edge: 'start' | 'end'
  ) {
    if (event.button !== 0) return;
    if (assetUnavailable || duration <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    clearPreviewSession();
    selectDraftChapter(chapterId);
    dragRangeId = chapterId;
    beginTimelinePointerDrag(event, edge === 'start' ? 'resize-start' : 'resize-end');
  }

  function handleTimelinePointerMove(event: PointerEvent) {
    const currentTime = getTimelineTimeForClientX(event.clientX);
    if (currentTime === null || !activeTimelineMode) return;

    if (!dragDidMove && Math.abs(event.clientX - dragStartClientX) >= TIMELINE_DRAG_THRESHOLD_PX) {
      dragDidMove = true;
    }

    if (!dragDidMove) {
      return;
    }

    if (activeTimelineMode === 'create') {
      draftSelectionPreview = normalizePreviewRange(dragAnchorTime, currentTime);
      return;
    }

    if (dragRangeId === null) {
      return;
    }

    if (activeTimelineMode === 'move') {
      draftChapters = moveDraftChapterRange(
        draftChapters,
        dragRangeId,
        currentTime - dragMoveOffset,
        duration
      );
      return;
    }

    draftChapters = resizeDraftChapterRange(
      draftChapters,
      dragRangeId,
      activeTimelineMode === 'resize-start' ? 'start' : 'end',
      currentTime,
      duration
    );
  }

  function finishTimelinePointerDrag(event: PointerEvent) {
    const pointerTime = getTimelineTimeForClientX(event.clientX) ?? dragAnchorTime;
    const mode = activeTimelineMode;
    clearTimelineDragListeners?.();

    if (mode === 'create') {
      if (!dragDidMove) {
        updatePlayhead(pointerTime);
        draftSelectionPreview = null;
        clearTimelinePointerDrag();
        return;
      }

      const createdRange = createDraftChapterRange({
        id: nextDraftChapterId,
        startTime: dragAnchorTime,
        endTime: pointerTime,
        timelineDuration: duration,
      });

      if (createdRange) {
        const nextRanges = insertDraftChapterRange(draftChapters, createdRange);
        if (nextRanges) {
          draftChapters = nextRanges;
          nextDraftChapterId += 1;
          selectDraftChapter(createdRange.id);
        }
      }

      draftSelectionPreview = null;
      clearTimelinePointerDrag();
      return;
    }

    if (!dragDidMove && dragRangeId !== null) {
      selectDraftChapter(dragRangeId);
    }

    clearTimelinePointerDrag();
  }

  function handleVideoTimeUpdate() {
    if (!videoRef) return;
    playheadTime = videoRef.currentTime;

    if (previewChapterId === null) {
      return;
    }

    const previewChapter = getDraftChapterRangeById(draftChapters, previewChapterId);
    if (!previewChapter) {
      previewChapterId = null;
      return;
    }

    if (videoRef.currentTime >= previewChapter.endTime) {
      videoRef.pause();
      videoRef.currentTime = previewChapter.endTime;
      playheadTime = previewChapter.endTime;
      previewChapterId = null;
    }
  }

  function handleVideoLoadedMetadata() {
    if (!videoRef) return;
    if (Number.isFinite(videoRef.duration) && videoRef.duration > 0) {
      videoDuration = videoRef.duration;
    }
    if (playheadTime > videoRef.duration) {
      playheadTime = videoRef.duration;
    }
  }

  function handleVideoPause() {
    if (previewChapterId === null) return;
    previewChapterId = null;
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ChapterDefinition] Video playback error', error);
  }

  function handlePreviewSelectedChapter() {
    if (!selectedDraftChapter || !videoRef || assetUnavailable) return;

    previewChapterId = selectedDraftChapter.id;
    playheadTime = selectedDraftChapter.startTime;
    videoRef.currentTime = selectedDraftChapter.startTime;
    void videoRef.play().catch(() => {
      previewChapterId = null;
    });
  }

  function handleDeleteSelectedChapter() {
    if (!selectedDraftChapter) return;

    if (previewChapterId === selectedDraftChapter.id) {
      clearPreviewSession();
    }

    draftChapters = removeDraftChapterRange(draftChapters, selectedDraftChapter.id);
    selectedDraftChapterId = null;
  }

  function handleCreateAll() {
    if (draftChapters.length === 0) return;

    onComplete(draftChapters.map((chapter) => ({
      title: chapter.title,
      startTime: chapter.startTime,
      endTime: chapter.endTime,
    })));
  }

  function startPointerDrag(event: PointerEvent, onMove: (moveEvent: PointerEvent) => void) {
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      onMove(moveEvent);
    };

    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleDefinitionResize(event: PointerEvent) {
    if (!definitionContainer) return;
    const startY = event.clientY;
    const startHeight = definitionTopHeight;
    const containerHeight = definitionContainer.clientHeight;
    const maxHeight = Math.max(
      MIN_DEFINITION_TOP,
      containerHeight - MIN_DEFINITION_BOTTOM - RESIZE_HANDLE_SIZE
    );

    startPointerDrag(event, (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      definitionTopHeight = clamp(startHeight + delta, MIN_DEFINITION_TOP, maxHeight);
    });
  }

  $effect(() => {
    if (videoRef && videoSrc) {
      videoRef.load();
    }
  });

  $effect(() => {
    if (!selectedDraftChapterId) return;
    if (getDraftChapterRangeById(draftChapters, selectedDraftChapterId)) return;
    selectedDraftChapterId = null;
  });

  onDestroy(() => {
    clearTimelinePointerDrag();
  });
</script>

<div
  class="chapter-definition flex h-full flex-col overflow-hidden bg-surface-raised"
  bind:this={definitionContainer}
  data-project-id={projectId}
>
  <div class="definition-top-fixed flex shrink-0 flex-col gap-4 overflow-hidden border-b border-border-default px-6 pt-6 pb-3" style={`height: ${definitionTopHeight}px`}>
    <div class="header flex items-end justify-between gap-4">
      <div>
        <h2 class="mb-2 mt-0 text-app-xl text-text-primary">Define chapters · {asset.file_path.split(/[/\\]/).pop()}</h2>
        <p class="m-0 text-app-base text-text-tertiary">
          Build every chapter on one master VOD timeline, then create them in one batch.
        </p>
      </div>
      <div class="shrink-0 text-right">
        <p class="m-0 font-mono text-app-sm text-text-secondary">Duration: {formatTime(duration)}</p>
        <p class="m-0 font-mono text-app-sm text-text-secondary">Playhead: {formatTime(playheadTime)}</p>
      </div>
    </div>

    <div class="video-preview flex-1 min-h-0 overflow-hidden rounded-md bg-surface-page">
      {#if assetUnavailable}
        <div class="unavailable-state flex h-full w-full flex-col justify-center gap-2 bg-linear-to-b from-surface-raised to-surface-page p-5 text-text-secondary">
          <p class="m-0 font-semibold text-text-primary">Chapter source file is unavailable</p>
          <p class="m-0 break-all text-app-sm leading-[1.4] text-text-tertiary">{asset.availability?.savedPath ?? asset.file_path}</p>
          {#if asset.availability?.nearestExistingAncestor}
            <p class="m-0 break-all text-app-sm leading-[1.4] text-text-tertiary">
              Nearest existing path: {asset.availability.nearestExistingAncestor}
            </p>
          {/if}
        </div>
      {:else}
        <video
          bind:this={videoRef}
          class="definition-video block h-full w-full bg-black object-contain"
          src={videoSrc}
          ontimeupdate={handleVideoTimeUpdate}
          onloadedmetadata={handleVideoLoadedMetadata}
          onpause={handleVideoPause}
          onerror={handleVideoError}
          controls
          preload="metadata"
          playsinline
        >
          <track kind="captions" />
        </video>
      {/if}
    </div>
  </div>

  <div
    class="definition-resize-handle h-[6px] flex-[0_0_6px] touch-none bg-surface-page transition-colors hover:bg-surface-hover"
    role="separator"
    aria-orientation="horizontal"
    onpointerdown={handleDefinitionResize}
  ></div>

  <div class="definition-scroll scrollbar-thin flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-6">
    <section class="timeline-shell rounded-xl border border-border-default bg-surface-base p-5 shadow-[0_20px_40px_-32px_rgba(0,0,0,0.45)]">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 class="m-0 text-app-md font-semibold text-text-primary">Master VOD timeline</h3>
          <p class="m-0 text-app-sm text-text-secondary">
            Drag on empty space to create chapters. Drag a block to move it. Drag its edges to resize it.
          </p>
        </div>
        <div class="rounded-full border border-border-default bg-surface-raised px-3 py-1 font-mono text-app-xs text-text-secondary">
          {draftChapterCountLabel}
        </div>
      </div>

      <div class="timeline-ruler relative mb-2 h-6">
        {#each timelineMarkers as marker, index (index)}
          <div
            class="absolute top-0 bottom-0"
            style={`left: ${percentForTime(marker)}%; transform: translateX(-50%);`}
          >
            <div class="h-2 w-px bg-border-strong"></div>
            <span class="mt-1 block whitespace-nowrap font-mono text-app-xs text-text-tertiary">{formatTime(marker)}</span>
          </div>
        {/each}
      </div>

      <div
        class="timeline-track relative mt-8 h-28 overflow-hidden rounded-xl border border-border-default bg-linear-to-b from-surface-raised via-surface-base to-surface-page"
        class:cursor-crosshair={!assetUnavailable}
        class:opacity-60={assetUnavailable}
        bind:this={timelineTrackRef}
        role="group"
        aria-label="Master timeline chapter editor"
        onpointerdown={handleTimelinePointerDown}
      >
        <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_55%)]"></div>

        {#each [25, 50, 75] as laneMarker}
          <div
            class="pointer-events-none absolute inset-y-0 border-l border-dashed border-border-subtle"
            style={`left: ${laneMarker}%;`}
          ></div>
        {/each}

        <div
          class="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 -translate-x-1/2 bg-accent-primary"
          style={`left: ${playheadPercent}%;`}
        >
          <div class="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-b-[8px] border-b-accent-primary"></div>
        </div>

        {#if draftSelectionPreview}
          <div
            class="pointer-events-none absolute top-3 bottom-3 z-10 rounded-lg border border-accent-primary bg-accent-primary-subtle"
            style={`left: ${percentForTime(draftSelectionPreview.startTime)}%; width: ${widthPercentForRange(draftSelectionPreview.startTime, draftSelectionPreview.endTime)}%;`}
          ></div>
        {/if}

        {#each draftChapters as chapter (chapter.id)}
          <div
            class="chapter-block absolute top-3 bottom-3 z-15 overflow-hidden rounded-lg border transition-[transform,box-shadow,border-color,background-color] duration-150"
            class:border-accent-primary={selectedDraftChapterId === chapter.id}
            class:border-border-default={selectedDraftChapterId !== chapter.id}
            class:bg-accent-primary-subtle={selectedDraftChapterId === chapter.id}
            class:bg-surface-elevated={selectedDraftChapterId !== chapter.id}
            class:shadow-[0_14px_28px_-20px_rgba(0,0,0,0.7)]={selectedDraftChapterId === chapter.id}
            style={`left: ${percentForTime(chapter.startTime)}%; width: ${widthPercentForRange(chapter.startTime, chapter.endTime)}%;`}
            role="button"
            tabindex="0"
            aria-label={`${chapter.title} ${formatTime(chapter.startTime)} to ${formatTime(chapter.endTime)}`}
            onpointerdown={(event) => handleDraftChapterPointerDown(event, chapter.id)}
            onkeydown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectDraftChapter(chapter.id);
              }
            }}
          >
            <button
              type="button"
              class="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-transparent hover:bg-white/10"
              aria-label={`Resize start of ${chapter.title}`}
              onpointerdown={(event) => handleDraftChapterResizePointerDown(event, chapter.id, 'start')}
            ></button>
            <button
              type="button"
              class="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-transparent hover:bg-white/10"
              aria-label={`Resize end of ${chapter.title}`}
              onpointerdown={(event) => handleDraftChapterResizePointerDown(event, chapter.id, 'end')}
            ></button>

            <div class="pointer-events-none flex h-full flex-col justify-between gap-1 px-3 py-2">
              <span class="truncate text-app-sm font-semibold text-text-primary">{chapter.title}</span>
              <div class="flex items-center justify-between gap-2 font-mono text-app-xs text-text-secondary">
                <span class="truncate">{formatTime(chapter.startTime)} - {formatTime(chapter.endTime)}</span>
                <span class="shrink-0">{formatTime(getDraftChapterDuration(chapter))}</span>
              </div>
            </div>
          </div>
        {/each}

        {#if draftChapters.length === 0 && !draftSelectionPreview}
          <div class="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-app-sm text-text-tertiary">
            Drag anywhere on the master timeline to define your first chapter.
          </div>
        {/if}
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4 py-3">
        <div class="min-w-0 flex-1">
          {#if selectedDraftChapter}
            <p class="m-0 truncate text-app-sm font-medium text-text-primary">
              {selectedDraftChapter.title} · {formatTime(selectedDraftChapter.startTime)} - {formatTime(selectedDraftChapter.endTime)}
            </p>
            <p class="m-0 text-app-xs text-text-tertiary">
              Duration {formatTime(selectedDraftChapterDuration)} · Minimum {formatTime(MIN_DRAFT_CHAPTER_DURATION_SECONDS)}
            </p>
          {:else}
            <p class="m-0 text-app-sm text-text-secondary">
              {draftChapters.length === 0
                ? 'Create chapter blocks on the timeline, then commit them all at once.'
                : `Drafting ${draftChapterCountLabel}. Select a block to preview or delete it.`}
            </p>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          <button
            class="inline-flex items-center gap-2 rounded-md border border-border-default bg-surface-base px-3 py-2 text-app-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            onclick={handlePreviewSelectedChapter}
            disabled={!selectedDraftChapter || assetUnavailable}
          >
            <Icon icon={Play} size={14} />
            <span>Preview chapter</span>
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-md border border-accent-destructive/35 bg-transparent px-3 py-2 text-app-sm font-medium text-accent-destructive transition-colors hover:bg-accent-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
            onclick={handleDeleteSelectedChapter}
            disabled={!selectedDraftChapter}
          >
            <Icon icon={Trash2} size={14} />
            <span>Delete chapter</span>
          </button>
        </div>
      </div>
    </section>

    <div class="mt-6 flex items-center justify-between border-t border-border-default pt-4">
      <button
        class="rounded-md border border-border-strong bg-transparent px-5 py-2 text-app-base text-text-tertiary transition-colors hover:border-text-disabled hover:text-text-primary"
        onclick={onCancel}
      >
        Back
      </button>
      <button
        class="inline-flex items-center gap-2 rounded-md bg-accent-primary px-6 py-2 text-app-base font-medium text-white transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:bg-border-strong"
        onclick={handleCreateAll}
        disabled={draftChapters.length === 0}
      >
        <span>Create {draftChapterCountLabel}</span>
        <Icon icon={ArrowRight} size={14} />
      </button>
    </div>
  </div>
</div>
