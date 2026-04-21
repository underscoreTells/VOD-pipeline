<script lang="ts">
  import type { Asset } from "../../../shared/types/database";
  import type { AssetAvailability } from "../../../shared/contracts/ipc";
  import { createChapter, linkAssetToChapter, chaptersState } from "../state/chapters.svelte";
  import { settingsState } from "../state/settings.svelte";
  import { buildPlayableAssetUrl } from "../utils/media";
  import { formatTime } from "../utils/time";
  import Icon from './ui/Icon.svelte';
  import IconButton from './ui/IconButton.svelte';
  import { Check, X, Pencil, Trash2, ArrowRight } from '../constants';

  type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };

  interface Props {
    asset: AvailabilityAwareAsset;
    projectId: number;
    onComplete: (chapters: Array<{ title: string; startTime: number; endTime: number }>) => void;
    onCancel: () => void;
  }

  let { asset, projectId, onComplete, onCancel }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let isPreviewing = $state(false);
  let videoDuration = $state(0);
  let definitionContainer = $state<HTMLElement | null>(null);
  let definitionTopHeight = $state(320);
  const assetUnavailable = $derived(asset.availability?.exists === false);
  const videoSrc = $derived(buildPlayableAssetUrl(asset));

  const RESIZE_HANDLE_SIZE = 6;
  const MIN_DEFINITION_TOP = 220;
  const MIN_DEFINITION_BOTTOM = 240;

  // Draft chapters state
  let draftChapters = $state<
    Array<{ id: number; title: string; startTime: number; endTime: number }>
  >([]);
  
  // Current selection state
  let selectionStart = $state(0);
  let selectionEnd = $state(0);
  let playheadTime = $state(0);
  let isPlaying = $state(false);
  
  // Editing state
  let editingChapterId = $state<number | null>(null);
  let editTitle = $state("");

  // Duration in seconds - use $derived to stay reactive
  const duration = $derived(videoDuration || asset.duration || 0);
  const playheadPercent = $derived(duration > 0 ? (playheadTime / duration) * 100 : 0);
  const selectionStartPercent = $derived(duration > 0 ? (selectionStart / duration) * 100 : 0);
  const selectionWidthPercent = $derived(
    duration > 0 ? ((selectionEnd - selectionStart) / duration) * 100 : 0
  );

  function seekVideo(time: number) {
    if (!videoRef) return;
    const maxDuration = videoRef.duration || duration;
    const clampedTime = maxDuration > 0
      ? Math.max(0, Math.min(maxDuration, time))
      : Math.max(0, time);
    videoRef.currentTime = clampedTime;
  }

  function stopPreview() {
    if (!videoRef) return;
    if (!videoRef.paused) {
      videoRef.pause();
    }
    isPreviewing = false;
  }

  function handleVideoTimeUpdate() {
    if (!videoRef) return;
    playheadTime = videoRef.currentTime;

    if (isPreviewing && hasSelection && videoRef.currentTime >= selectionEnd) {
      videoRef.pause();
      isPreviewing = false;
      videoRef.currentTime = selectionEnd;
      playheadTime = selectionEnd;
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

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ChapterDefinition] Video playback error', error);
  }

  $effect(() => {
    if (videoRef && videoSrc) {
      videoRef.load();
    }
  });

  function markStart() {
    selectionStart = playheadTime;
    if (selectionEnd < selectionStart) {
      selectionEnd = selectionStart;
    }
  }

  function markEnd() {
    selectionEnd = playheadTime;
    if (selectionEnd < selectionStart) {
      // Swap if end is before start
      const temp = selectionStart;
      selectionStart = selectionEnd;
      selectionEnd = temp;
    }
  }

  function addChapter() {
    if (selectionEnd <= selectionStart) {
      return;
    }

    const newChapter = {
      id: Date.now(),
      title: `Chapter ${draftChapters.length + 1}`,
      startTime: selectionStart,
      endTime: selectionEnd,
    };

    draftChapters = [...draftChapters, newChapter];
    
    // Clear selection
    selectionStart = 0;
    selectionEnd = 0;
  }

  function clearSelection() {
    selectionStart = 0;
    selectionEnd = 0;
  }

  function deleteDraftChapter(id: number) {
    draftChapters = draftChapters.filter((c) => c.id !== id);
  }

  function startEditing(chapter: { id: number; title: string }) {
    editingChapterId = chapter.id;
    editTitle = chapter.title;
  }

  function saveEdit(chapterId: number) {
    draftChapters = draftChapters.map((c) =>
      c.id === chapterId ? { ...c, title: editTitle } : c
    );
    editingChapterId = null;
    editTitle = "";
  }

  function cancelEdit() {
    editingChapterId = null;
    editTitle = "";
  }

  function handleScrubberClick(e: MouseEvent) {
    if (duration <= 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    playheadTime = Math.max(0, Math.min(duration, percentage * duration));
    stopPreview();
    seekVideo(playheadTime);
  }

  function handleScrubberKeydown(e: KeyboardEvent) {
    if (duration <= 0) return;
    const step = duration / 100; // 1% of duration per step
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      playheadTime = Math.max(0, playheadTime - step);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      playheadTime = Math.min(duration, playheadTime + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      playheadTime = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      playheadTime = duration;
    }
    stopPreview();
    seekVideo(playheadTime);
  }

  function handleCreateAll() {
    if (draftChapters.length === 0) return;

    const chapters = draftChapters.map((c) => ({
      title: c.title,
      startTime: c.startTime,
      endTime: c.endTime,
    }));

    onComplete(chapters);
  }

  function previewSelection() {
    if (!videoRef || !hasSelection || assetUnavailable) return;
    isPreviewing = true;
    videoRef.currentTime = selectionStart;
    videoRef.play().catch(() => {
      isPreviewing = false;
    });
  }

  // Calculate selection width for visual feedback
  const selectionDuration = $derived(selectionEnd - selectionStart);
  const hasSelection = $derived(selectionDuration > 0);

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
      const next = clamp(startHeight + delta, MIN_DEFINITION_TOP, maxHeight);
      definitionTopHeight = next;
    });
  }
</script>

<div class="chapter-definition flex h-full flex-col overflow-hidden bg-surface-raised" bind:this={definitionContainer}>
  <div class="definition-top-fixed flex shrink-0 flex-col gap-4 overflow-hidden border-b border-border-default px-6 pt-6 pb-3" style="height: {definitionTopHeight}px">
    <div class="header">
      <h2 class="mb-2 mt-0 text-app-xl text-text-primary">Define Chapters - {asset.file_path.split(/[/\\]/).pop()}</h2>
      <p class="duration m-0 text-app-base text-text-tertiary">Duration: {formatTime(duration)}</p>
    </div>

    <div class="video-preview flex-1 min-h-0 overflow-hidden rounded-md bg-surface-page">
      {#if assetUnavailable}
        <div class="unavailable-state flex h-full w-full flex-col justify-center gap-2 bg-linear-to-b from-surface-raised to-surface-page p-5 text-text-secondary">
          <p class="unavailable-title m-0 font-semibold text-text-primary">Chapter source file is unavailable</p>
          <p class="unavailable-path m-0 break-all text-app-sm leading-[1.4] text-text-tertiary">{asset.availability?.savedPath ?? asset.file_path}</p>
          {#if asset.availability?.nearestExistingAncestor}
            <p class="unavailable-ancestor m-0 break-all text-app-sm leading-[1.4] text-text-tertiary">
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
    <!-- Timeline Scrubber -->
    <div class="timeline-section mb-6 rounded-md bg-surface-raised p-6">
    <div class="scrubber-container relative mb-4 h-[60px] cursor-pointer rounded-md bg-surface-base" onclick={handleScrubberClick} onkeydown={handleScrubberKeydown} role="slider" tabindex="0" aria-label="Timeline scrubber" aria-valuenow={Math.round(playheadTime)} aria-valuemin={0} aria-valuemax={Math.round(duration)}>
      <div class="timeline-bar relative h-full overflow-hidden rounded-md bg-linear-to-b from-surface-hover to-surface-base">
        <!-- Playhead -->
          <div
            class="playhead absolute top-0 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-accent-primary"
            style="left: {playheadPercent}%"
          >
          <div class="playhead-marker absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent border-b-[8px] border-b-accent-primary"></div>
        </div>

        <!-- Selection highlight -->
        {#if hasSelection}
          <div
            class="selection-highlight absolute top-5 bottom-5 z-[5] rounded-sm border border-accent-success bg-accent-success/30"
            style="left: {selectionStartPercent}%; width: {selectionWidthPercent}%"
          ></div>
        {/if}

        <!-- Time markers -->
        <div class="time-markers absolute inset-x-0 bottom-1 flex justify-between px-2 text-app-xs text-text-disabled">
          <span>0:00</span>
          <span>{formatTime(duration / 2)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>

    <div class="time-display mb-4 text-app-base text-text-tertiary">
      Playhead: <strong>{formatTime(playheadTime)}</strong>
    </div>

    <!-- Controls -->
    <div class="controls mb-4 flex flex-wrap gap-2">
      <button class="rounded-sm bg-accent-primary px-4 py-2 text-app-base text-text-primary transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:bg-border-strong" onclick={markStart} disabled={assetUnavailable}>
        Mark Start @ {formatTime(playheadTime)}
      </button>
      <button class="rounded-sm bg-accent-primary px-4 py-2 text-app-base text-text-primary transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:bg-border-strong" onclick={markEnd} disabled={assetUnavailable}>
        Mark End
      </button>
      <button class="rounded-sm bg-surface-active px-4 py-2 text-app-base text-text-secondary transition-colors hover:bg-border-strong disabled:cursor-not-allowed disabled:bg-border-strong" onclick={previewSelection} disabled={!hasSelection || assetUnavailable}>
        Preview
      </button>
      <button class="rounded-sm bg-surface-active px-4 py-2 text-app-base text-text-secondary transition-colors hover:bg-border-strong disabled:cursor-not-allowed disabled:bg-border-strong" onclick={clearSelection} disabled={assetUnavailable}>
        Clear
      </button>
    </div>

    <!-- Selection Info -->
    <div class="selection-info flex items-center justify-between rounded-sm bg-surface-base p-3">
      {#if hasSelection}
        <span class="selection-text text-app-base text-accent-success">
          Selection: {formatTime(selectionStart)} - {formatTime(selectionEnd)} ({formatTime(selectionDuration)})
        </span>
        <button class="add-btn rounded-sm bg-accent-success px-4 py-2 text-app-base font-medium text-text-inverse transition-[filter] hover:brightness-90 disabled:cursor-not-allowed" onclick={addChapter} disabled={assetUnavailable}>
          + Add Chapter
        </button>
      {:else}
        <span class="no-selection text-app-base italic text-text-disabled">No selection made. Mark start and end points.</span>
      {/if}
    </div>
    </div>

    <!-- Draft Chapters List -->
    <div class="chapters-list mb-6">
    <h3 class="mb-4 mt-0 text-app-md text-text-primary">Defined Chapters ({draftChapters.length})</h3>
    
    {#if draftChapters.length === 0}
      <p class="empty-message p-8 text-center italic text-text-disabled">No chapters defined yet. Use the timeline above to create chapters.</p>
    {:else}
      <div class="chapters flex flex-col gap-2">
        {#each draftChapters as chapter, i (chapter.id)}
          <div class="chapter-item flex items-center gap-2 rounded-md bg-surface-hover p-3">
            <span class="chapter-number min-w-6 text-app-base text-text-disabled">{i + 1}.</span>
            
            {#if editingChapterId === chapter.id}
              <input
                type="text"
                bind:value={editTitle}
                onkeydown={(e) => {
                  if (e.key === "Enter") saveEdit(chapter.id);
                  if (e.key === "Escape") cancelEdit();
                }}
                class="edit-input flex-1 rounded-sm border border-accent-primary bg-surface-raised px-2 py-1 text-app-base text-text-primary"
              />
              <IconButton icon={Check} size={14} onclick={() => saveEdit(chapter.id)} title="Save" />
              <IconButton icon={X} size={14} onclick={cancelEdit} title="Cancel" />
            {:else}
              <span class="chapter-title flex-1 text-app-base text-text-primary">{chapter.title}</span>
              <span class="chapter-time font-mono text-app-sm text-text-tertiary">
                {formatTime(chapter.startTime)} - {formatTime(chapter.endTime)}
              </span>
              <IconButton icon={Pencil} size={14} onclick={() => startEditing(chapter)} title="Edit title" />
              <IconButton icon={Trash2} size={14} variant="destructive" onclick={() => deleteDraftChapter(chapter.id)} title="Delete" />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    </div>

    <!-- Footer Actions -->
    <div class="footer flex items-center justify-between border-t border-border-default pt-4">
      <button class="rounded-md border border-border-strong bg-transparent px-5 py-2 text-app-base text-text-tertiary transition-colors hover:border-text-disabled hover:text-text-primary" onclick={onCancel}>
        Back
      </button>
      <button
        class="rounded-md bg-accent-primary px-6 py-2 text-app-base font-medium text-text-primary transition-colors hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:bg-border-strong"
        onclick={handleCreateAll}
        disabled={draftChapters.length === 0}
      >
        Create {draftChapters.length} Chapter{draftChapters.length !== 1 ? "s" : ""} <Icon icon={ArrowRight} size={14} />
      </button>
    </div>
  </div>
</div>
