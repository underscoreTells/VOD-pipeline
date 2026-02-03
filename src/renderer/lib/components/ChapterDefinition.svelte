<script lang="ts">
  import type { Asset } from "../../../shared/types/database";
  import { createChapter, linkAssetToChapter, chaptersState } from "../state/chapters.svelte";
  import { settingsState } from "../state/settings.svelte";
  import { buildAssetUrl } from "../utils/media";
  import { formatTime } from "../utils/time";

  interface Props {
    asset: Asset;
    projectId: number;
    onComplete: (chapters: Array<{ title: string; startTime: number; endTime: number }>) => void;
    onCancel: () => void;
  }

  let { asset, projectId, onComplete, onCancel }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let isPreviewing = $state(false);

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
  const duration = $derived(asset.duration || 0);

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
    if (playheadTime > videoRef.duration) {
      playheadTime = videoRef.duration;
    }
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ChapterDefinition] Video playback error', error);
  }

  $effect(() => {
    if (videoRef) {
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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    playheadTime = Math.max(0, Math.min(duration, percentage * duration));
    stopPreview();
    seekVideo(playheadTime);
  }

  function handleScrubberKeydown(e: KeyboardEvent) {
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
    if (!videoRef || !hasSelection) return;
    isPreviewing = true;
    videoRef.currentTime = selectionStart;
    videoRef.play().catch(() => {
      isPreviewing = false;
    });
  }

  // Calculate selection width for visual feedback
  const selectionDuration = $derived(selectionEnd - selectionStart);
  const hasSelection = $derived(selectionDuration > 0);
</script>

<div class="chapter-definition">
  <div class="header">
    <h2>Define Chapters - {asset.file_path.split(/[/\\]/).pop()}</h2>
    <p class="duration">Duration: {formatTime(duration)}</p>
  </div>

  <div class="video-preview">
    <video
      bind:this={videoRef}
      class="definition-video"
      src={buildAssetUrl(asset.id)}
      ontimeupdate={handleVideoTimeUpdate}
      onloadedmetadata={handleVideoLoadedMetadata}
      onerror={handleVideoError}
      controls
      preload="metadata"
      playsinline
    >
      <track kind="captions" />
    </video>
  </div>

  <!-- Timeline Scrubber -->
  <div class="timeline-section">
    <div class="scrubber-container" onclick={handleScrubberClick} onkeydown={handleScrubberKeydown} role="slider" tabindex="0" aria-label="Timeline scrubber" aria-valuenow={Math.round(playheadTime)} aria-valuemin={0} aria-valuemax={Math.round(duration)}>
      <div class="timeline-bar">
        <!-- Playhead -->
        <div
          class="playhead"
          style="left: {(playheadTime / duration) * 100}%"
        >
          <div class="playhead-marker">▲</div>
        </div>

        <!-- Selection highlight -->
        {#if hasSelection}
          <div
            class="selection-highlight"
            style="left: {(selectionStart / duration) * 100}%; width: {((selectionEnd - selectionStart) / duration) * 100}%"
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
      <button class="control-btn" onclick={markStart}>
        Mark Start @ {formatTime(playheadTime)}
      </button>
      <button class="control-btn" onclick={markEnd}>
        Mark End
      </button>
      <button class="control-btn secondary" onclick={previewSelection} disabled={!hasSelection}>
        Preview
      </button>
      <button class="control-btn secondary" onclick={clearSelection}>
        Clear
      </button>
    </div>

    <!-- Selection Info -->
    <div class="selection-info">
      {#if hasSelection}
        <span class="selection-text">
          Selection: {formatTime(selectionStart)} - {formatTime(selectionEnd)} ({formatTime(selectionDuration)})
        </span>
        <button class="add-btn" onclick={addChapter}>
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
              <button class="icon-btn" onclick={() => saveEdit(chapter.id)}>✓</button>
              <button class="icon-btn" onclick={cancelEdit}>✕</button>
            {:else}
              <span class="chapter-title">{chapter.title}</span>
              <span class="chapter-time">
                {formatTime(chapter.startTime)} - {formatTime(chapter.endTime)}
              </span>
              <button
                class="icon-btn"
                onclick={() => startEditing(chapter)}
                title="Edit title"
              >
                ✎
              </button>
              <button
                class="icon-btn delete"
                onclick={() => deleteDraftChapter(chapter.id)}
                title="Delete"
              >
                🗑
              </button>
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
      Create {draftChapters.length} Chapter{draftChapters.length !== 1 ? "s" : ""} →
    </button>
  </div>
</div>

<style>
  .chapter-definition {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1.5rem;
    background: #1e1e1e;
  }

  .header {
    margin-bottom: 1.5rem;
  }

  .header h2 {
    margin: 0 0 0.5rem 0;
    color: #fff;
    font-size: 1.25rem;
  }

  .duration {
    margin: 0;
    color: #888;
    font-size: 0.875rem;
  }

  .video-preview {
    background: #111;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 1.5rem;
    aspect-ratio: 16 / 9;
  }

  .definition-video {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
  }

  .timeline-section {
    background: #252525;
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .scrubber-container {
    position: relative;
    height: 60px;
    background: #1a1a1a;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 1rem;
  }

  .timeline-bar {
    position: relative;
    height: 100%;
    background: linear-gradient(to bottom, #2a2a2a 0%, #1a1a1a 100%);
    border-radius: 6px;
    overflow: hidden;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #2563eb;
    transform: translateX(-50%);
    z-index: 10;
  }

  .playhead-marker {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    color: #2563eb;
    font-size: 8px;
  }

  .selection-highlight {
    position: absolute;
    top: 20px;
    bottom: 20px;
    background: rgba(74, 222, 128, 0.3);
    border: 1px solid #4ade80;
    border-radius: 4px;
    z-index: 5;
  }

  .time-markers {
    position: absolute;
    bottom: 4px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    padding: 0 8px;
    font-size: 0.625rem;
    color: #666;
  }

  .time-display {
    color: #888;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .time-display strong {
    color: #fff;
  }

  .controls {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .control-btn {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s;
  }

  .control-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .control-btn:disabled {
    background: #444;
    cursor: not-allowed;
  }

  .control-btn.secondary {
    background: #333;
    color: #ccc;
  }

  .control-btn.secondary:hover:not(:disabled) {
    background: #444;
  }

  .selection-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: #1a1a1a;
    border-radius: 4px;
  }

  .selection-text {
    color: #4ade80;
    font-size: 0.875rem;
  }

  .no-selection {
    color: #666;
    font-size: 0.875rem;
    font-style: italic;
  }

  .add-btn {
    background: #4ade80;
    color: #000;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .add-btn:hover {
    background: #22c55e;
  }

  .chapters-list {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 1.5rem;
  }

  .chapters-list h3 {
    margin: 0 0 1rem 0;
    color: #fff;
    font-size: 1rem;
  }

  .empty-message {
    color: #666;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .chapters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #2a2a2a;
    border-radius: 6px;
  }

  .chapter-number {
    color: #666;
    font-size: 0.875rem;
    min-width: 24px;
  }

  .chapter-title {
    flex: 1;
    color: #fff;
    font-size: 0.875rem;
  }

  .chapter-time {
    color: #888;
    font-size: 0.75rem;
    font-family: monospace;
  }

  .edit-input {
    flex: 1;
    background: #1e1e1e;
    border: 1px solid #2563eb;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.875rem;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0.25rem;
    font-size: 0.875rem;
    border-radius: 4px;
  }

  .icon-btn:hover {
    background: #333;
    color: #fff;
  }

  .icon-btn.delete:hover {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 1rem;
    border-top: 1px solid #333;
  }

  .back-btn {
    background: none;
    border: 1px solid #444;
    color: #888;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .back-btn:hover {
    border-color: #666;
    color: #fff;
  }

  .create-btn {
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 0.625rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .create-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .create-btn:disabled {
    background: #444;
    cursor: not-allowed;
  }
</style>
