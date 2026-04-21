<script lang="ts">
  import type { Clip } from '$shared/types/database';
  import { getSelectedClips, getClipById } from '../state/timeline.svelte';
  import { chaptersState } from '../state/chapters.svelte';
  import { formatTime, formatTimecode } from '../state/keyboard.svelte';
  import { executeResizeClip, executeUpdateClipTiming, projectDetail } from '../state/project-detail.svelte';
  import { toChapterLocalTime } from '../utils/chapter-time';
  import { buildPlayableAssetUrl } from '../utils/media';
  import Icon from './ui/Icon.svelte';
  import { ChevronLeft, ChevronRight } from '../constants';

  const CLIP_END_EPSILON = 0.01;
  const NUDGE_FPS = 30;
  const MIN_CLIP_DURATION = 1 / NUDGE_FPS;
  const NUDGE_EPSILON = 0.0001;
  
  // Get selected clip
  const selectedClip = $derived.by(() => {
    const selected = getSelectedClips();
    return selected.length === 1 ? selected[0] : null;
  });

  const selectedAsset = $derived.by(() => {
    if (!selectedClip) return null;
    return projectDetail.assets.find((asset) => asset.id === selectedClip.asset_id) ?? null;
  });

  const selectedChapter = $derived.by(() => {
    const chapterId = chaptersState.selectedChapterId;
    if (!chapterId) return null;
    return chaptersState.chapters.find((chapter) => chapter.id === chapterId) ?? null;
  });

  const videoSrc = $derived.by(() => {
    return selectedAsset ? buildPlayableAssetUrl(selectedAsset) : '';
  });

  const isSelectedAssetUnavailable = $derived(() => selectedAsset?.availability.exists === false);
  
  // Video player state
  let videoRef: HTMLVideoElement | null = $state(null);
  let isLooping = $state(true);
  let isPlaying = $state(false);
  let currentTime = $state(0);
  let lastVideoSrc = '';
  let nudgeQueue: Promise<void> = Promise.resolve();

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function getAssetDuration(assetId: number): number | null {
    const asset = projectDetail.assets.find((item) => item.id === assetId);
    if (!asset) return null;
    const duration = asset.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }
    return duration;
  }

  function queueNudge(
    clipId: number,
    computeNext: (clip: Clip) => { startTime?: number; inPoint: number; outPoint: number }
  ) {
    nudgeQueue = nudgeQueue
      .then(async () => {
        const clip = getClipById(clipId);
        if (!clip) return;

        const next = computeNext(clip);
        const nextStartTime = next.startTime ?? clip.start_time;
        const nextInPoint = next.inPoint;
        const nextOutPoint = next.outPoint;
        const startChanged = Math.abs(nextStartTime - clip.start_time) > NUDGE_EPSILON;
        const inChanged = Math.abs(nextInPoint - clip.in_point) > NUDGE_EPSILON;
        const outChanged = Math.abs(nextOutPoint - clip.out_point) > NUDGE_EPSILON;
        if (!startChanged && !inChanged && !outChanged) return;

        if (startChanged) {
          await executeUpdateClipTiming(
            clip.id,
            clip.start_time,
            clip.in_point,
            clip.out_point,
            nextStartTime,
            nextInPoint,
            nextOutPoint
          );
          return;
        }

        await executeResizeClip(
          clip.id,
          clip.in_point,
          clip.out_point,
          nextInPoint,
          nextOutPoint
        );
      })
      .catch((error) => {
        console.error('[ClipPreview] Failed to nudge clip points', error);
      });
  }

  function clampToClip(time: number): number {
    if (!selectedClip) return time;
    return clamp(time, selectedClip.in_point, selectedClip.out_point);
  }
  
  // Derived values
  const clipDuration = $derived.by(() => {
    if (!selectedClip) return 0;
    return Math.max(0, selectedClip.out_point - selectedClip.in_point);
  });

  const clipLocalTime = $derived.by(() => {
    if (!selectedClip) return 0;
    return clamp(currentTime - selectedClip.in_point, 0, clipDuration);
  });

  const timelineCurrentTime = $derived.by(() => {
    if (!selectedClip) return 0;
    const timelineTime = selectedClip.start_time + clipLocalTime;
    return toChapterLocalTime(selectedChapter, timelineTime);
  });

  const timelineInTime = $derived.by(() => {
    if (!selectedClip) return 0;
    return toChapterLocalTime(selectedChapter, selectedClip.start_time);
  });

  const timelineOutTime = $derived.by(() => {
    if (!selectedClip) return 0;
    const timelineOut = selectedClip.start_time + clipDuration;
    return toChapterLocalTime(selectedChapter, timelineOut);
  });
  
  // Handle nudge buttons
  function nudgeInPoint(delta: number) {
    if (!selectedClip) return;
    const clipId = selectedClip.id;
    const frameDuration = 1 / NUDGE_FPS;

    queueNudge(clipId, (clip) => {
      const minIn = 0;
      const maxIn = Math.max(minIn, clip.out_point - MIN_CLIP_DURATION);
      const proposedIn = clamp(clip.in_point + (delta * frameDuration), minIn, maxIn);
      const requestedDelta = proposedIn - clip.in_point;
      const boundedDelta = Math.max(-clip.start_time, requestedDelta);
      const inPoint = clip.in_point + boundedDelta;
      const startTime = clip.start_time + boundedDelta;
      return {
        startTime,
        inPoint,
        outPoint: clip.out_point,
      };
    });
  }
  
  function nudgeOutPoint(delta: number) {
    if (!selectedClip) return;
    const clipId = selectedClip.id;
    const frameDuration = 1 / NUDGE_FPS;

    queueNudge(clipId, (clip) => {
      const minOut = clip.in_point + MIN_CLIP_DURATION;
      const assetDuration = getAssetDuration(clip.asset_id);
      const maxOut = assetDuration !== null
        ? Math.max(minOut, assetDuration)
        : Number.POSITIVE_INFINITY;
      const outPoint = clamp(clip.out_point + (delta * frameDuration), minOut, maxOut);
      return {
        inPoint: clip.in_point,
        outPoint,
      };
    });
  }
  
  // Video event handlers
  function handleTimeUpdate() {
    if (!videoRef) return;

    if (!selectedClip) {
      currentTime = videoRef.currentTime;
      return;
    }

    const clipEnd = selectedClip.out_point;
    if (videoRef.currentTime >= clipEnd - CLIP_END_EPSILON) {
      if (isLooping) {
        videoRef.currentTime = selectedClip.in_point;
        currentTime = selectedClip.in_point;
        void videoRef.play().catch(() => undefined);
      } else {
        videoRef.pause();
        videoRef.currentTime = clipEnd;
        currentTime = clipEnd;
        isPlaying = false;
      }
      return;
    }

    currentTime = clampToClip(videoRef.currentTime);
  }

  function handleEnded() {
    if (isLooping && videoRef && selectedClip) {
      videoRef.currentTime = selectedClip.in_point;
      currentTime = selectedClip.in_point;
      void videoRef.play().catch(() => undefined);
    } else {
      isPlaying = false;
    }
  }

  function handleSeeking() {
    if (!videoRef || !selectedClip) return;
    const next = clampToClip(videoRef.currentTime);
    if (Math.abs(next - videoRef.currentTime) > CLIP_END_EPSILON) {
      videoRef.currentTime = next;
    }
    currentTime = next;
  }

  function handlePlay() {
    isPlaying = true;
  }

  function handlePause() {
    isPlaying = false;
  }

  function handleVideoLoadedMetadata() {
    if (!videoRef || !selectedClip) return;
    if (videoRef.currentTime < selectedClip.in_point || videoRef.currentTime > selectedClip.out_point) {
      videoRef.currentTime = selectedClip.in_point;
      currentTime = selectedClip.in_point;
    }
  }

  function togglePlayback() {
    if (!videoRef || !selectedClip) return;
    if (videoRef.paused) {
      if (videoRef.currentTime >= selectedClip.out_point - CLIP_END_EPSILON) {
        videoRef.currentTime = selectedClip.in_point;
      }
      void videoRef.play().catch(() => undefined);
      return;
    }
    videoRef.pause();
  }

  function handleScrubInput(event: Event) {
    if (!videoRef || !selectedClip) return;
    const value = Number((event.target as HTMLInputElement).value);
    const local = clamp(value, 0, clipDuration);
    const nextTime = selectedClip.in_point + local;
    videoRef.currentTime = nextTime;
    currentTime = nextTime;
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ClipPreview] Video playback error', error);
  }

  $effect(() => {
    if (!videoRef) return;
    if (videoSrc && videoSrc !== lastVideoSrc) {
      lastVideoSrc = videoSrc;
      videoRef.load();
    }
  });
  
  // Load clip into video player when selection changes
  $effect(() => {
    if (!videoRef) return;
    if (!selectedClip || !selectedAsset) {
      videoRef.pause();
      currentTime = 0;
      isPlaying = false;
      return;
    }

    const seekToClipStart = () => {
      if (!videoRef || !selectedClip) return;
      videoRef.currentTime = selectedClip.in_point;
      currentTime = selectedClip.in_point;
      isPlaying = false;
    };

    if (videoRef.readyState >= 1) {
      seekToClipStart();
    } else {
      const onLoaded = () => {
        seekToClipStart();
        videoRef?.removeEventListener('loadedmetadata', onLoaded);
      };
      videoRef.addEventListener('loadedmetadata', onLoaded);
      return () => videoRef?.removeEventListener('loadedmetadata', onLoaded);
    }
  });
</script>

<div class="clip-preview scrollbar-thin">
  {#if selectedClip}
    <div class="preview-header">
      <h4>Clip Preview</h4>
      <span class="role-badge" data-role={selectedClip.role}>
        {selectedClip.role || 'No role'}
      </span>
    </div>
    
    <div class="video-container">
      {#if isSelectedAssetUnavailable()}
        <div class="unavailable-state">
          <p class="unavailable-title">Clip source file is unavailable</p>
          <p class="unavailable-path">{selectedAsset?.availability.savedPath ?? selectedAsset?.file_path}</p>
          {#if selectedAsset?.availability.nearestExistingAncestor}
            <p class="unavailable-ancestor">
              Nearest existing path: {selectedAsset.availability.nearestExistingAncestor}
            </p>
          {/if}
        </div>
      {:else}
        <video
          bind:this={videoRef}
          src={videoSrc}
          onseeking={handleSeeking}
          ontimeupdate={handleTimeUpdate}
          onended={handleEnded}
          onplay={handlePlay}
          onpause={handlePause}
          onloadedmetadata={handleVideoLoadedMetadata}
          onerror={handleVideoError}
          class="preview-video"
          preload="metadata"
          playsinline
        >
          <track kind="captions" />
        </video>
      {/if}
    </div>
    
    <div class="clip-controls">
      <div class="trim-controls">
        <div class="trim-row">
          <span class="trim-label">In:</span>
          <span class="trim-time">{formatTimecode(timelineInTime)}</span>
          <div class="trim-buttons">
            <button onclick={() => nudgeInPoint(-1)} title="-1 frame"><Icon icon={ChevronLeft} size={14} /></button>
            <button onclick={() => nudgeInPoint(1)} title="+1 frame"><Icon icon={ChevronRight} size={14} /></button>
          </div>
        </div>

        <div class="trim-row">
          <span class="trim-label">Out:</span>
          <span class="trim-time">{formatTimecode(timelineOutTime)}</span>
          <div class="trim-buttons">
            <button onclick={() => nudgeOutPoint(-1)} title="-1 frame"><Icon icon={ChevronLeft} size={14} /></button>
            <button onclick={() => nudgeOutPoint(1)} title="+1 frame"><Icon icon={ChevronRight} size={14} /></button>
          </div>
        </div>
      </div>
      
      <div class="playback-controls">
        <div class="playback-top-row">
          <button class="play-toggle" onclick={togglePlayback} disabled={isSelectedAssetUnavailable()}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <span class="playback-time">{formatTimecode(timelineCurrentTime)} / {formatTimecode(timelineOutTime)}</span>
        </div>
        <input
          class="clip-scrubber"
          type="range"
          min="0"
          max={Math.max(0.01, clipDuration)}
          step="0.01"
          value={clipLocalTime}
          disabled={clipDuration <= 0 || isSelectedAssetUnavailable()}
          oninput={handleScrubInput}
        />
        <div class="playback-meta-row">
          <label class="loop-toggle">
            <input type="checkbox" bind:checked={isLooping} />
            <span>Loop</span>
          </label>
          <span class="duration">Duration: {formatTime(clipDuration)}</span>
        </div>
      </div>
    </div>
    
    <div class="clip-info">
      {#if selectedClip.description}
        <p class="description">{selectedClip.description}</p>
      {:else}
        <p class="description empty">No description</p>
      {/if}
      
      <div class="meta">
        <span>Track {selectedClip.track_index + 1}</span>
        <span>•</span>
        <span>{selectedClip.is_essential ? 'Essential' : 'Optional'}</span>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <p>Select a clip to preview</p>
    </div>
  {/if}
</div>

<style>
  .clip-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--surface-base);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
  }
  
  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .preview-header h4 {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .role-badge {
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border-radius: 12px;
    background: var(--surface-active);
    color: var(--text-tertiary);
    text-transform: capitalize;
  }
  
  .role-badge[data-role="setup"] { background: var(--role-setup-subtle); color: var(--role-setup); }
  .role-badge[data-role="escalation"] { background: var(--role-escalation-subtle); color: var(--role-escalation); }
  .role-badge[data-role="twist"] { background: var(--role-twist-subtle); color: var(--role-twist); }
  .role-badge[data-role="payoff"] { background: var(--role-payoff-subtle); color: var(--role-payoff); }
  .role-badge[data-role="transition"] { background: var(--role-transition-subtle); color: var(--role-transition); }
  
  .video-container {
    position: relative;
    background: #000;
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex: 0 0 auto;
    aspect-ratio: 16/9;
  }
  
  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
  }

  .unavailable-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
    padding: var(--space-4);
    box-sizing: border-box;
    background: linear-gradient(180deg, #1f1f1f 0%, #121212 100%);
    color: var(--text-secondary);
  }

  .unavailable-title {
    margin: 0;
    font-weight: 600;
    color: var(--text-primary);
  }

  .unavailable-path,
  .unavailable-ancestor {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: #a0a0a0;
    word-break: break-all;
  }
  
  .clip-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  
  .trim-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  
  .trim-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .trim-label {
    width: 40px;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-transform: uppercase;
  }
  
  .trim-time {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-secondary);
  }
  
  .trim-buttons {
    display: flex;
    gap: var(--space-1);
  }
  
  .trim-buttons button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-strong);
    background: var(--surface-hover);
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-sm);
    transition: all 0.15s;
  }
  
  .trim-buttons button:hover {
    background: var(--surface-active);
    border-color: #555;
    color: var(--text-primary);
  }
  
  .playback-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-default);
  }

  .playback-top-row,
  .playback-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .play-toggle {
    padding: 0.35rem var(--space-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.8rem;
  }

  .play-toggle:hover {
    background: var(--surface-active);
    border-color: #555;
    color: var(--text-primary);
  }

  .playback-time {
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .clip-scrubber {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--surface-hover);
    border-radius: var(--radius-pill);
    outline: none;
  }

  .clip-scrubber:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .clip-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #4f46e5;
    border: 2px solid #0f0f0f;
    cursor: pointer;
  }

  .clip-scrubber::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #4f46e5;
    border: 2px solid #0f0f0f;
    cursor: pointer;
  }
  
  .loop-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-base);
    color: var(--text-tertiary);
    cursor: pointer;
  }
  
  .loop-toggle input {
    cursor: pointer;
  }
  
  .duration {
    font-size: var(--text-sm);
    color: var(--text-disabled);
    font-family: var(--font-mono);
  }
  
  .clip-info {
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-default);
  }
  
  .description {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-base);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  
  .description.empty {
    color: var(--text-disabled);
    font-style: italic;
  }
  
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
    color: var(--text-disabled);
    font-size: var(--text-base);
  }
</style>
