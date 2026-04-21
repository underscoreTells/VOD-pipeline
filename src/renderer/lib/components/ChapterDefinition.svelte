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

<div class="chapter-definition" bind:this={definitionContainer}>
  <div class="definition-top-fixed" style="height: {definitionTopHeight}px">
    <div class="header">
      <h2>Define Chapters - {asset.file_path.split(/[/\\]/).pop()}</h2>
      <p class="duration">Duration: {formatTime(duration)}</p>
    </div>

    <div class="video-preview">
      {#if assetUnavailable}
        <div class="unavailable-state">
          <p class="unavailable-title">Chapter source file is unavailable</p>
          <p class="unavailable-path">{asset.availability?.savedPath ?? asset.file_path}</p>
          {#if asset.availability?.nearestExistingAncestor}
            <p class="unavailable-ancestor">
              Nearest existing path: {asset.availability.nearestExistingAncestor}
            </p>
          {/if}
        </div>
      {:else}
        <video
          bind:this={videoRef}
          class="definition-video"
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
    class="definition-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    onpointerdown={handleDefinitionResize}
  ></div>
  <div class="definition-scroll scrollbar-thin">
    <!-- Timeline Scrubber -->
    <div class="timeline-section">
    <div class="scrubber-container" onclick={handleScrubberClick} onkeydown={handleScrubberKeydown} role="slider" tabindex="0" aria-label="Timeline scrubber" aria-valuenow={Math.round(playheadTime)} aria-valuemin={0} aria-valuemax={Math.round(duration)}>
      <div class="timeline-bar">
        <!-- Playhead -->
          <div
            class="playhead"
            style="left: {playheadPercent}%"
          >
          <div class="playhead-marker"></div>
        </div>

        <!-- Selection highlight -->
        {#if hasSelection}
          <div
            class="selection-highlight"
            style="left: {selectionStartPercent}%; width: {selectionWidthPercent}%"
          ></div>
        {/if}

        <!-- Time markers -->
        <div class="time-markers">
          <span>0:00</span>
          <span>{formatTime(duration / 2)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>

    <div class="time-display">
      Playhead: <strong>{formatTime(playheadTime)}</strong>
    </div>

    <!-- Controls -->
    <div class="controls">
      <button class="control-btn" onclick={markStart} disabled={assetUnavailable}>
        Mark Start @ {formatTime(playheadTime)}
      </button>
      <button class="control-btn" onclick={markEnd} disabled={assetUnavailable}>
        Mark End
      </button>
      <button class="control-btn secondary" onclick={previewSelection} disabled={!hasSelection || assetUnavailable}>
        Preview
      </button>
      <button class="control-btn secondary" onclick={clearSelection} disabled={assetUnavailable}>
        Clear
      </button>
    </div>

    <!-- Selection Info -->
    <div class="selection-info">
      {#if hasSelection}
        <span class="selection-text">
          Selection: {formatTime(selectionStart)} - {formatTime(selectionEnd)} ({formatTime(selectionDuration)})
        </span>
        <button class="add-btn" onclick={addChapter} disabled={assetUnavailable}>
          + Add Chapter
        </button>
      {:else}
        <span class="no-selection">No selection made. Mark start and end points.</span>
      {/if}
    </div>
    </div>

    <!-- Draft Chapters List -->
    <div class="chapters-list">
    <h3>Defined Chapters ({draftChapters.length})</h3>
    
    {#if draftChapters.length === 0}
      <p class="empty-message">No chapters defined yet. Use the timeline above to create chapters.</p>
    {:else}
      <div class="chapters">
        {#each draftChapters as chapter, i (chapter.id)}
          <div class="chapter-item">
            <span class="chapter-number">{i + 1}.</span>
            
            {#if editingChapterId === chapter.id}
              <input
                type="text"
                bind:value={editTitle}
                onkeydown={(e) => {
                  if (e.key === "Enter") saveEdit(chapter.id);
                  if (e.key === "Escape") cancelEdit();
                }}
                class="edit-input"
              />
              <IconButton icon={Check} size={14} onclick={() => saveEdit(chapter.id)} title="Save" />
              <IconButton icon={X} size={14} onclick={cancelEdit} title="Cancel" />
            {:else}
              <span class="chapter-title">{chapter.title}</span>
              <span class="chapter-time">
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
    <div class="footer">
      <button class="back-btn" onclick={onCancel}>
        Back
      </button>
      <button
        class="create-btn"
        onclick={handleCreateAll}
        disabled={draftChapters.length === 0}
      >
        Create {draftChapters.length} Chapter{draftChapters.length !== 1 ? "s" : ""} <Icon icon={ArrowRight} size={14} />
      </button>
    </div>
  </div>
</div>

<style>
  .chapter-definition {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface-raised);
    overflow: hidden;
  }

  .definition-top-fixed {
    flex: 0 0 auto;
    padding: var(--space-6);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    overflow: hidden;
  }

  .definition-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-6);
    padding-top: var(--space-4);
  }

  .definition-resize-handle {
    height: 6px;
    flex: 0 0 6px;
    cursor: row-resize;
    background: var(--surface-page);
    transition: background var(--transition-normal);
    touch-action: none;
  }

  .definition-resize-handle:hover {
    background: var(--surface-hover);
  }

  .header {
    margin-bottom: 0;
  }

  .header h2 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-xl);
  }

  .duration {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--text-base);
  }

  .video-preview {
    background: var(--surface-page);
    border-radius: var(--radius-lg);
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .definition-video {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
    object-fit: contain;
  }

  .unavailable-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
    padding: var(--space-5);
    box-sizing: border-box;
    background: linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%);
    color: var(--text-secondary);
  }

  .unavailable-title {
    margin: 0;
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
  }

  .unavailable-path,
  .unavailable-ancestor {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.4;
    color: var(--text-tertiary);
    word-break: break-all;
  }

  .timeline-section {
    background: var(--surface-elevated);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }

  .scrubber-container {
    position: relative;
    height: 60px;
    background: var(--surface-base);
    border-radius: var(--radius-md);
    cursor: pointer;
    margin-bottom: var(--space-4);
  }

  .timeline-bar {
    position: relative;
    height: 100%;
    background: linear-gradient(to bottom, var(--surface-hover) 0%, var(--surface-base) 100%);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent-primary);
    transform: translateX(-50%);
    z-index: 10;
  }

  .playhead-marker {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 8px solid var(--accent-primary);
  }

  .selection-highlight {
    position: absolute;
    top: 20px;
    bottom: 20px;
    background: rgba(74, 222, 128, 0.3);
    border: 1px solid var(--accent-success);
    border-radius: var(--radius-sm);
    z-index: 5;
  }

  .time-markers {
    position: absolute;
    bottom: 4px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-disabled);
  }

  .time-display {
    color: var(--text-tertiary);
    font-size: var(--text-base);
    margin-bottom: var(--space-4);
  }

  .time-display strong {
    color: var(--text-primary);
  }

  .controls {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    flex-wrap: wrap;
  }

  .control-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    transition: background var(--transition-normal);
  }

  .control-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }

  .control-btn:disabled {
    background: var(--border-strong);
    cursor: not-allowed;
  }

  .control-btn.secondary {
    background: var(--surface-active);
    color: var(--text-secondary);
  }

  .control-btn.secondary:hover:not(:disabled) {
    background: var(--border-strong);
  }

  .selection-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-3);
    background: var(--surface-base);
    border-radius: var(--radius-sm);
  }

  .selection-text {
    color: var(--accent-success);
    font-size: var(--text-base);
  }

  .no-selection {
    color: var(--text-disabled);
    font-size: var(--text-base);
    font-style: italic;
  }

  .add-btn {
    background: var(--accent-success);
    color: var(--text-inverse);
    border: none;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
  }

  .add-btn:hover {
    filter: brightness(0.9);
  }

  .chapters-list {
    margin-bottom: var(--space-6);
  }

  .chapters-list h3 {
    margin: 0 0 var(--space-4) 0;
    color: var(--text-primary);
    font-size: var(--text-md);
  }

  .empty-message {
    color: var(--text-disabled);
    font-style: italic;
    text-align: center;
    padding: var(--space-8);
  }

  .chapters {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-hover);
    border-radius: var(--radius-md);
  }

  .chapter-number {
    color: var(--text-disabled);
    font-size: var(--text-base);
    min-width: 24px;
  }

  .chapter-title {
    flex: 1;
    color: var(--text-primary);
    font-size: var(--text-base);
  }

  .chapter-time {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
  }

  .edit-input {
    flex: 1;
    background: var(--surface-raised);
    border: 1px solid var(--accent-primary);
    color: var(--text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-default);
  }

  .back-btn {
    background: none;
    border: 1px solid var(--border-strong);
    color: var(--text-tertiary);
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-base);
  }

  .back-btn:hover {
    border-color: var(--text-disabled);
    color: var(--text-primary);
  }

  .create-btn {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
  }

  .create-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }

  .create-btn:disabled {
    background: var(--border-strong);
    cursor: not-allowed;
  }
</style>
