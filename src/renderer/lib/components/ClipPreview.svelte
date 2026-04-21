<script lang="ts">
  import type { Clip } from '$shared/types/database';
  import { getSelectedClips, getClipById } from '../state/timeline.svelte';
  import { chaptersState } from '../state/chapters.svelte';
  import { formatTimecode } from '../state/keyboard.svelte';
  import { executeResizeClip, executeUpdateClipTiming, projectDetail } from '../state/project-detail.svelte';
  import { toChapterLocalTime } from '../utils/chapter-time';
  import { buildPlayableAssetUrl } from '../utils/media';
  import Icon from './ui/Icon.svelte';
  import { ChevronLeft, ChevronRight, Play, Pause, Repeat } from '../constants';

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

  const isSelectedAssetUnavailable = $derived.by(() => selectedAsset?.availability.exists === false);

  const clipDescription = $derived.by(() => selectedClip?.description || '');
  
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
    <!-- Header: role badge left, title right with description tooltip -->
    <header class="preview-header" title={clipDescription}>
      <span class="role-badge" data-role={selectedClip.role}>
        {selectedClip.role || 'unassigned'}
      </span>
      <span class="clip-title">Clip Preview · Track {selectedClip.track_index + 1}</span>
    </header>
    
    <div class="player-stage">
      <!-- Video Container -->
      <div class="video-container" class:with-dock={!isSelectedAssetUnavailable}>
      {#if isSelectedAssetUnavailable}
        <div class="unavailable-state">
          <p class="unavailable-title">Source unavailable</p>
          <p class="unavailable-path">{selectedAsset?.availability.savedPath ?? selectedAsset?.file_path}</p>
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

      {#if !isSelectedAssetUnavailable}
        <div class="player-dock">
          <div class="transport-bar">
            <button
              class="play-btn"
              onclick={togglePlayback}
              disabled={isSelectedAssetUnavailable}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              <Icon icon={isPlaying ? Pause : Play} size={14} />
            </button>
            <input
              class="scrubber"
              type="range"
              min="0"
              max={Math.max(0.01, clipDuration)}
              step="0.01"
              value={clipLocalTime}
              disabled={clipDuration <= 0 || isSelectedAssetUnavailable}
              oninput={handleScrubInput}
            />
            <span class="transport-time">{formatTimecode(timelineCurrentTime)}</span>
          </div>

          <div class="trim-grid">
            <span class="trim-label">IN</span>
            <span class="trim-time">{formatTimecode(timelineInTime)}</span>
            <div class="trim-actions">
              <button class="nudge-btn" onclick={() => nudgeInPoint(-1)} title="-1 frame">
                <Icon icon={ChevronLeft} size={12} />
              </button>
              <button class="nudge-btn" onclick={() => nudgeInPoint(1)} title="+1 frame">
                <Icon icon={ChevronRight} size={12} />
              </button>
            </div>

            <span class="trim-label">OUT</span>
            <span class="trim-time">{formatTimecode(timelineOutTime)}</span>
            <div class="trim-actions">
              <button class="nudge-btn" onclick={() => nudgeOutPoint(-1)} title="-1 frame">
                <Icon icon={ChevronLeft} size={12} />
              </button>
              <button class="nudge-btn" onclick={() => nudgeOutPoint(1)} title="+1 frame">
                <Icon icon={ChevronRight} size={12} />
              </button>
              <button
                class="loop-btn"
                class:active={isLooping}
                onclick={() => isLooping = !isLooping}
                title={isLooping ? 'Disable loop' : 'Enable loop'}
                aria-label="Toggle loop"
              >
                <Icon icon={Repeat} size={12} />
              </button>
            </div>
          </div>
        </div>
      {/if}
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
    gap: var(--space-2);
    background: var(--surface-base);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    min-height: 0;
    height: 100%;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: hidden;
  }
  
  /* Header */
  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    cursor: default;
  }
  
  .role-badge {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--surface-active);
    color: var(--text-tertiary);
    text-transform: capitalize;
    line-height: 1.4;
  }
  
  .role-badge[data-role="setup"] { background: var(--role-setup-subtle); color: var(--role-setup); }
  .role-badge[data-role="escalation"] { background: var(--role-escalation-subtle); color: var(--role-escalation); }
  .role-badge[data-role="twist"] { background: var(--role-twist-subtle); color: var(--role-twist); }
  .role-badge[data-role="payoff"] { background: var(--role-payoff-subtle); color: var(--role-payoff); }
  .role-badge[data-role="transition"] { background: var(--role-transition-subtle); color: var(--role-transition); }
  
  .clip-title {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .player-stage {
    --player-dock-height: 110px;
    position: relative;
    flex: 1;
    min-height: 0;
  }
  
  /* Video Container */
  .video-container {
    position: relative;
    background: #000;
    border-radius: var(--radius-sm);
    overflow: hidden;
    min-height: 0;
  }

  .player-stage .video-container {
    position: absolute;
    inset: 0;
  }

  .video-container.with-dock {
    bottom: calc(var(--player-dock-height) + var(--space-2));
  }

  .player-dock {
    position: absolute;
    left: var(--space-1);
    right: var(--space-1);
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: var(--space-2);
    min-height: var(--player-dock-height);
  }
  
  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  .unavailable-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    padding: var(--space-3);
    box-sizing: border-box;
    background: linear-gradient(180deg, #1f1f1f 0%, #121212 100%);
    color: var(--text-secondary);
    text-align: center;
  }

  .unavailable-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
  }

  .unavailable-path {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 1.3;
    color: var(--text-tertiary);
    word-break: break-all;
    max-width: 100%;
  }
  
  /* Transport Bar */
  .transport-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    background: rgba(18, 18, 18, 0.86);
    backdrop-filter: blur(8px);
  }

  .play-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-default);
    background: var(--surface-raised);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  
  .play-btn:hover:not(:disabled) {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .play-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .scrubber {
    flex: 1;
    min-width: 0;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--surface-hover);
    border-radius: var(--radius-pill);
    outline: none;
  }

  .scrubber:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .scrubber::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    border: 2px solid var(--surface-base);
    cursor: pointer;
  }

  .scrubber::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-primary);
    border: 2px solid var(--surface-base);
    cursor: pointer;
  }

  .transport-time {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  
  /* Trim Controls */
  .trim-grid {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-1) var(--space-2);
    align-items: center;
    padding: var(--space-2);
    background: rgba(18, 18, 18, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(8px);
  }
  
  .trim-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  
  .trim-time {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  
  .trim-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  
  .nudge-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--border-default);
    background: var(--surface-base);
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  
  .nudge-btn:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .loop-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: var(--space-1);
    border: 1px solid var(--border-default);
    background: var(--surface-base);
    color: var(--text-tertiary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .loop-btn:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  .loop-btn.active {
    background: var(--accent-primary-subtle);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
  
  /* Empty State */
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 120px;
    color: var(--text-disabled);
    font-size: var(--text-sm);
  }

  .empty-state p {
    margin: 0;
  }
</style>
