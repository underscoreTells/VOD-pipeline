<script lang="ts">
  import type { Chapter, Asset } from '$shared/types/database';
  import { buildAssetUrl } from '../utils/media';
  import { formatTime } from '../utils/time';
  import {
    clampToChapter,
    getChapterDuration,
    toChapterGlobalTime,
    toChapterLocalTime,
  } from '../utils/chapter-time';
  import {
    timelineState,
    setPlayhead,
    setPlaying,
    togglePlayback,
  } from '../state/timeline.svelte';
  import {
    clipBuilderState,
    clearSelection,
    hasCompleteSelection,
  } from '../state/clip-builder.svelte';
  import { createProjectClip, projectDetail } from '../state/project-detail.svelte';

  interface Props {
    chapter: Chapter | null;
    asset: Asset | null;
  }

  let { chapter, asset }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let currentTime = $state(0);
  let isCreatingFromSelection = $state(false);
  let lastChapterId = $state<number | null>(null);

  const hasPreview = $derived(() => Boolean(chapter && asset));
  const previewTitle = $derived(() => chapter?.title || 'No chapter selected');

  const chapterDuration = $derived(() => getChapterDuration(chapter));
  const localTime = $derived(() => toChapterLocalTime(chapter, currentTime));

  function handleSeeking() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(chapter, videoRef.currentTime);
    if (Math.abs(next - videoRef.currentTime) > 0.01) {
      videoRef.currentTime = next;
    }
  }

  function handleTimeUpdate() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(chapter, videoRef.currentTime);
    if (next !== videoRef.currentTime) {
      videoRef.pause();
      videoRef.currentTime = next;
      setPlaying(false);
    }
    currentTime = next;
    setPlayhead(next);
  }

  function handleLoadedMetadata() {
    if (!videoRef || !chapter) return;
    const start = clampToChapter(chapter, chapter.start_time);
    videoRef.currentTime = start;
    currentTime = start;
    setPlayhead(start);
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
    const chapterId = chapter?.id ?? null;
    if (chapterId !== lastChapterId) {
      clearSelection();
      lastChapterId = chapterId;
    }
  });

  $effect(() => {
    if (!videoRef || !chapter) return;
    if (videoRef.readyState >= 1) {
      const start = clampToChapter(chapter, chapter.start_time);
      videoRef.currentTime = start;
      currentTime = start;
      setPlayhead(start);
    }
  });

  $effect(() => {
    if (!videoRef) return;
    if (timelineState.isPlaying) {
      if (videoRef.paused) {
        void videoRef.play().catch(() => {
          setPlaying(false);
        });
      }
    } else if (!videoRef.paused) {
      videoRef.pause();
    }
  });

  async function handleSelectionAutoCreate() {
    if (!projectDetail.projectId || !chapter || !asset) return;
    if (!hasCompleteSelection()) return;
    if (isCreatingFromSelection) return;

    const inPoint = clipBuilderState.inPoint;
    const outPoint = clipBuilderState.outPoint;

    if (inPoint === null || outPoint === null) return;

    isCreatingFromSelection = true;

    try {
      await createProjectClip(
        projectDetail.projectId,
        asset.id,
        0,
        inPoint,
        inPoint,
        outPoint,
        undefined,
        undefined,
        true
      );
    } finally {
      clearSelection();
      isCreatingFromSelection = false;
    }
  }

  function handleScrubInput(event: Event) {
    if (!videoRef || !chapter) return;
    const value = Number((event.target as HTMLInputElement).value);
    const next = toChapterGlobalTime(chapter, value);
    videoRef.currentTime = next;
    currentTime = next;
    setPlayhead(next);
  }

  $effect(() => {
    if (hasCompleteSelection()) {
      void handleSelectionAutoCreate();
    }
  });
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

  {#if chapter && asset}
    <div class="preview-controls">
      <button class="play-toggle" onclick={togglePlayback}>
        {timelineState.isPlaying ? 'Pause' : 'Play'}
      </button>
      <div class="time-display">
        <span class="time-current">{formatTime(localTime())}</span>
        <span class="time-divider">/</span>
        <span class="time-total">{formatTime(chapterDuration())}</span>
      </div>
      <input
        class="scrubber"
        type="range"
        min="0"
        max={chapterDuration()}
        step="0.01"
        value={localTime()}
        oninput={handleScrubInput}
      />
    </div>
  {/if}

  <div class="preview-footer">
    {#if chapter}
      <span class="range">{formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}</span>
    {:else}
      <span class="range">No chapter selected</span>
    {/if}
    <span class="timecode">{formatTime(localTime())}</span>
  </div>
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
    height: 100%;
    min-height: 0;
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
    flex: 1;
    min-height: 0;
  }

  .video-frame.empty {
    background: linear-gradient(180deg, #1f1f1f 0%, #0f0f0f 100%);
  }

  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
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

  .preview-controls {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    gap: 0.5rem 1rem;
    align-items: center;
    padding: 0.5rem 0;
  }

  .play-toggle {
    grid-row: 1 / span 2;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid #2b2b2b;
    background: #1e1e1e;
    color: #fff;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }

  .play-toggle:hover {
    background: #2a2a2a;
    border-color: #3a3a3a;
  }

  .time-display {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.8rem;
    color: #ccc;
  }

  .time-divider {
    color: #666;
  }

  .scrubber {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: #2a2a2a;
    border-radius: 999px;
    outline: none;
  }

  .scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #4f46e5;
    border: 2px solid #0f0f0f;
    cursor: pointer;
  }

  .scrubber::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #4f46e5;
    border: 2px solid #0f0f0f;
    cursor: pointer;
  }
</style>
