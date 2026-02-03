<script lang="ts">
  import type { Chapter, Asset } from '$shared/types/database';
  import { buildAssetUrl } from '../utils/media';
  import { formatTime } from '../utils/time';
  import { 
    clipBuilderState, 
    setInPoint, 
    setOutPoint, 
    clearSelection, 
    hasCompleteSelection,
    getSelectionDuration 
  } from '../state/clip-builder.svelte';
  import { timelineState } from '../state/timeline.svelte';
  import { createProjectClip, projectDetail } from '../state/project-detail.svelte';
  import { chaptersState } from '../state/chapters.svelte';

  interface Props {
    chapter: Chapter | null;
    asset: Asset | null;
  }

  let { chapter, asset }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let currentTime = $state(0);

  const hasPreview = $derived(() => Boolean(chapter && asset));
  const previewTitle = $derived(() => chapter?.title || 'No chapter selected');

  function clampToChapter(time: number): number {
    if (!chapter) return time;
    return Math.max(chapter.start_time, Math.min(time, chapter.end_time));
  }

  function handleSeeking() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(videoRef.currentTime);
    if (Math.abs(next - videoRef.currentTime) > 0.01) {
      videoRef.currentTime = next;
    }
  }

  function handleTimeUpdate() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(videoRef.currentTime);
    if (next !== videoRef.currentTime) {
      videoRef.pause();
      videoRef.currentTime = next;
    }
    currentTime = next;
  }

  function handleLoadedMetadata() {
    if (!videoRef || !chapter) return;
    const start = clampToChapter(chapter.start_time);
    videoRef.currentTime = start;
    currentTime = start;
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ChapterPreview] Video playback error', error);
  }

  $effect(() => {
    if (!videoRef) return;
    if (asset) {
      videoRef.src = buildAssetUrl(asset.id);
      videoRef.load();
    } else {
      videoRef.removeAttribute('src');
      videoRef.load();
      currentTime = 0;
    }
  });

  $effect(() => {
    if (!videoRef || !chapter) return;
    if (videoRef.readyState >= 1) {
      const start = clampToChapter(chapter.start_time);
      videoRef.currentTime = start;
      currentTime = start;
    }
  });

  async function handleCreateClip() {
    if (!projectDetail.projectId || !chapter || !asset) return;
    if (!hasCompleteSelection()) return;

    const inPoint = clipBuilderState.inPoint!;
    const outPoint = clipBuilderState.outPoint!;
    
    // Create clip at the current track position (playheadTime)
    const trackPosition = timelineState.playheadTime;
    
    await createProjectClip(
      projectDetail.projectId,
      asset.id,
      0,
      trackPosition,
      inPoint,
      outPoint,
      undefined,
      undefined,
      true
    );
    clearSelection();
  }
</script>

<div class="chapter-preview">
  <div class="preview-header">
    <h3>Chapter Preview</h3>
    <span class="chapter-title">{previewTitle}</span>
  </div>

  <div class="video-frame" class:empty={!hasPreview()}>
    <video
      bind:this={videoRef}
      class="preview-video"
      onseeking={handleSeeking}
      ontimeupdate={handleTimeUpdate}
      onloadedmetadata={handleLoadedMetadata}
      onerror={handleVideoError}
      controls={Boolean(asset)}
      preload="metadata"
      playsinline
    >
      <track kind="captions" />
    </video>

    {#if !hasPreview()}
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <p>Select a chapter to preview</p>
      </div>
    {/if}
  </div>

  <div class="preview-footer">
    {#if chapter}
      <span class="range">{formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}</span>
    {:else}
      <span class="range">No chapter selected</span>
    {/if}
    <span class="timecode">{formatTime(currentTime)}</span>
  </div>

  <!-- Clip Builder -->
  {#if chapter && asset}
    <div class="clip-builder">
      <div class="selection-info">
        {#if hasCompleteSelection()}
          <span class="selection-range">
            {formatTime(clipBuilderState.inPoint ?? 0)} - {formatTime(clipBuilderState.outPoint ?? 0)}
          </span>
          <span class="selection-duration">({formatTime(getSelectionDuration())})</span>
        {:else if clipBuilderState.inPoint !== null}
          <span class="selection-range">In: {formatTime(clipBuilderState.inPoint)}</span>
          <span class="selection-hint">(Set Out point)</span>
        {:else}
          <span class="selection-hint">Mark In/Out to create clip</span>
        {/if}
      </div>
      
      <div class="clip-builder-controls">
        <button 
          class="mark-btn" 
          class:active={clipBuilderState.inPoint !== null}
          onclick={() => setInPoint(timelineState.playheadTime)}
        >
          Mark In [I]
        </button>
        <button 
          class="mark-btn" 
          class:active={clipBuilderState.outPoint !== null}
          onclick={() => setOutPoint(timelineState.playheadTime)}
        >
          Mark Out [O]
        </button>
        <button class="clear-btn" onclick={clearSelection}>Clear</button>
        <button 
          class="create-btn" 
          disabled={!hasCompleteSelection()}
          onclick={handleCreateClip}
        >
          Create Clip
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .chapter-preview {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 0.75rem;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .preview-header h3 {
    margin: 0;
    font-size: 0.875rem;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chapter-title {
    font-size: 0.875rem;
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .video-frame {
    position: relative;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
    aspect-ratio: 16 / 9;
  }

  .video-frame.empty {
    background: linear-gradient(180deg, #1f1f1f 0%, #0f0f0f 100%);
  }

  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: #777;
    text-align: center;
    pointer-events: none;
  }

  .empty-icon {
    font-size: 2rem;
    opacity: 0.6;
  }

  .preview-footer {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #888;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .timecode {
    color: #ccc;
  }

  /* Clip Builder */
  .clip-builder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid #2a2a2a;
  }

  .selection-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-family: 'SF Mono', Monaco, monospace;
  }

  .selection-range {
    color: #fff;
  }

  .selection-duration {
    color: #4CAF50;
  }

  .selection-hint {
    color: #666;
  }

  .clip-builder-controls {
    display: flex;
    gap: 0.5rem;
  }

  .mark-btn, .clear-btn, .create-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ccc;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .mark-btn:hover, .clear-btn:hover {
    background: #333;
    border-color: #555;
  }

  .mark-btn.active {
    background: #007bff;
    border-color: #007bff;
    color: #fff;
  }

  .create-btn {
    background: #28a745;
    border-color: #28a745;
    color: #fff;
    margin-left: auto;
  }

  .create-btn:hover:not(:disabled) {
    background: #218838;
    border-color: #218838;
  }

  .create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
