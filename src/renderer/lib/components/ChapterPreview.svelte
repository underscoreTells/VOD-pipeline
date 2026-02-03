<script lang="ts">
  import type { Chapter, Asset } from '$shared/types/database';
  import { buildAssetUrl } from '../utils/media';
  import { formatTime } from '../utils/time';

  interface Props {
    chapter: Chapter | null;
    asset: Asset | null;
  }

  let { chapter, asset }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let currentTime = $state(0);

  const hasPreview = $derived(() => Boolean(chapter && asset));
  const previewTitle = $derived(() => chapter?.title || 'No chapter selected');

  function handleTimeUpdate() {
    if (!videoRef) return;
    currentTime = videoRef.currentTime;

    if (chapter && videoRef.currentTime >= chapter.end_time) {
      videoRef.pause();
      videoRef.currentTime = chapter.end_time;
      currentTime = chapter.end_time;
    }
  }

  function handleLoadedMetadata() {
    if (!videoRef || !chapter) return;
    const duration = videoRef.duration || chapter.end_time;
    const start = Math.max(0, Math.min(duration, chapter.start_time));
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
      const duration = videoRef.duration || chapter.end_time;
      const start = Math.max(0, Math.min(duration, chapter.start_time));
      videoRef.currentTime = start;
      currentTime = start;
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
</style>
