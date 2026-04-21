<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Clip } from '$shared/types/database';
  import { getSelectedClips, getClipById } from '../state/timeline.svelte';
  import { chaptersState } from '../state/chapters.svelte';
  import { formatTimecode } from '../state/keyboard.svelte';
  import { executeResizeClip, executeUpdateClipTiming, projectDetail } from '../state/project-detail.svelte';
  import { toChapterLocalTime } from '../utils/chapter-time';
  import { buildPlayableAssetUrl } from '../utils/media';
  import { clampPreviewFps, snapToPreviewSample } from '../utils/previewSampling';
  import { createQueuedMediaSeek } from '../utils/queuedMediaSeek';
  import Badge from './ui/Badge.svelte';
  import Icon from './ui/Icon.svelte';
  import { ChevronLeft, ChevronRight, Play, Pause, Repeat } from '../constants';
  import { cn } from '../utils/cn';

  const CLIP_END_EPSILON = 0.01;
  const NUDGE_FPS = 30;
  const MIN_CLIP_DURATION = 1 / NUDGE_FPS;
  const NUDGE_EPSILON = 0.0001;
  const ROLE_BADGE_VARIANTS = {
    setup: 'setup',
    escalation: 'escalation',
    twist: 'twist',
    payoff: 'payoff',
    transition: 'transition',
    unassigned: 'unassigned',
  } as const;

  type RoleBadgeVariant = typeof ROLE_BADGE_VARIANTS[keyof typeof ROLE_BADGE_VARIANTS];

  function getRoleBadgeVariant(role: string | null | undefined): RoleBadgeVariant {
    const normalizedRole = (role ?? 'unassigned') as keyof typeof ROLE_BADGE_VARIANTS;
    return ROLE_BADGE_VARIANTS[normalizedRole] ?? ROLE_BADGE_VARIANTS.unassigned;
  };

  interface Props {
    class?: string;
  }

  let { class: className = '' }: Props = $props();
  
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
  let scrubberRef: HTMLInputElement | null = $state(null);
  let isLooping = $state(true);
  let isPlaying = $state(false);
  let isScrubbing = $state(false);
  let currentTime = $state(0);
  let lastVideoSrc = '';
  let nudgeQueue: Promise<void> = Promise.resolve();
  let resumePlaybackAfterScrub = false;
  let clearScrubListeners: (() => void) | null = null;

  const seekController = createQueuedMediaSeek({
    getVideo: () => videoRef,
    normalizeTime: (time) => clampToClip(time),
    snapPreviewTime: (time) => snapPreviewTime(time),
    epsilon: CLIP_END_EPSILON,
  });

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

  function getPreviewSamplingFps(): number {
    return clampPreviewFps(selectedAsset?.metadata?.fps);
  }

  function snapPreviewTime(time: number): number {
    return clampToClip(snapToPreviewSample(time, getPreviewSamplingFps()));
  }

  function clearScrubPointerListeners() {
    clearScrubListeners?.();
    clearScrubListeners = null;
  }

  function resetScrubSession() {
    clearScrubPointerListeners();
    seekController.reset();
    isScrubbing = false;
    resumePlaybackAfterScrub = false;
  }

  function getScrubTargetTime(input: HTMLInputElement | null): number | null {
    if (!selectedClip) return null;

    const rawValue = input ? Number(input.value) : clipLocalTime;
    const localValue = clamp(
      Number.isFinite(rawValue) ? rawValue : clipLocalTime,
      0,
      clipDuration
    );

    return selectedClip.in_point + localValue;
  }

  function beginScrubSession() {
    if (!videoRef || !selectedClip || isScrubbing) return;

    resumePlaybackAfterScrub = !videoRef.paused;
    if (!videoRef.paused) {
      videoRef.pause();
    }

    isScrubbing = true;
  }

  function finalizeScrubSession(input: HTMLInputElement | null) {
    if (!videoRef || !selectedClip || !isScrubbing) return;

    const nextTime = getScrubTargetTime(input);
    if (nextTime === null) return;

    seekController.commit(nextTime);
    currentTime = nextTime;
    isScrubbing = false;

    const shouldResumePlayback = resumePlaybackAfterScrub;
    resumePlaybackAfterScrub = false;

    if (shouldResumePlayback) {
      void videoRef.play().catch(() => undefined);
    }
  }

  function trackScrubPointer(input: HTMLInputElement) {
    clearScrubPointerListeners();

    const handlePointerEnd = () => {
      finalizeScrubSession(input);
      clearScrubPointerListeners();
    };

    window.addEventListener('pointerup', handlePointerEnd, true);
    window.addEventListener('pointercancel', handlePointerEnd, true);

    clearScrubListeners = () => {
      window.removeEventListener('pointerup', handlePointerEnd, true);
      window.removeEventListener('pointercancel', handlePointerEnd, true);
    };
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

    if (isScrubbing) {
      return;
    }

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
    if (isScrubbing) return;

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

  function handleSeeked() {
    seekController.handleSeeked();
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

    beginScrubSession();

    const input = event.currentTarget instanceof HTMLInputElement
      ? event.currentTarget
      : scrubberRef;
    const nextTime = getScrubTargetTime(input);
    if (nextTime === null) return;

    currentTime = nextTime;
    seekController.preview(nextTime);
  }

  function handleScrubStart(event: PointerEvent) {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;

    beginScrubSession();
    trackScrubPointer(event.currentTarget);
  }

  function handleScrubCommit(event: Event) {
    const input = event.currentTarget instanceof HTMLInputElement
      ? event.currentTarget
      : scrubberRef;

    finalizeScrubSession(input);
    clearScrubPointerListeners();
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ClipPreview] Video playback error', error);
  }

  $effect(() => {
    if (!videoRef) return;
    if (videoSrc && videoSrc !== lastVideoSrc) {
      resetScrubSession();
      lastVideoSrc = videoSrc;
      videoRef.load();
    }
  });
  
  // Load clip into video player when selection changes
  $effect(() => {
    if (!videoRef) return;
    resetScrubSession();
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

  onDestroy(() => {
    resetScrubSession();
  });
</script>

<div
  class={cn(
    'clip-preview scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-md border border-border-default bg-surface-base p-2',
    className,
  )}
>
  {#if selectedClip}
    <!-- Header: role badge left, title right with description tooltip -->
    <header class="preview-header flex cursor-default items-center justify-between gap-2" title={clipDescription}>
      <Badge variant={getRoleBadgeVariant(selectedClip.role)} class="role-badge capitalize">
        {selectedClip.role || 'unassigned'}
      </Badge>
      <span class="clip-title text-app-xs tracking-[0.02em] text-text-tertiary">Clip preview · track {selectedClip.track_index + 1}</span>
    </header>
    
    <div class="player-stage relative flex-1 min-h-0" style="--player-dock-height: 110px;">
      <!-- Video Container -->
      <div
        class="video-container absolute inset-x-0 top-0 min-h-0 overflow-hidden rounded-sm bg-black"
        style={`bottom: ${!isSelectedAssetUnavailable ? 'calc(var(--player-dock-height) + var(--space-2))' : '0px'}`}
      >
      {#if isSelectedAssetUnavailable}
        <div class="unavailable-state flex h-full w-full flex-col items-center justify-center gap-1 bg-linear-to-b from-surface-raised to-surface-page p-3 text-center text-text-secondary">
          <p class="unavailable-title m-0 text-app-sm font-medium text-text-primary">Source unavailable</p>
          <p class="unavailable-path m-0 max-w-full break-all text-app-xs leading-[1.3] text-text-tertiary">{selectedAsset?.availability.savedPath ?? selectedAsset?.file_path}</p>
        </div>
      {:else}
        <video
          bind:this={videoRef}
          src={videoSrc}
          onseeking={handleSeeking}
          onseeked={handleSeeked}
          ontimeupdate={handleTimeUpdate}
          onended={handleEnded}
          onplay={handlePlay}
          onpause={handlePause}
          onloadedmetadata={handleVideoLoadedMetadata}
          onerror={handleVideoError}
          class="preview-video h-full w-full bg-black object-contain"
          preload="auto"
          playsinline
        >
          <track kind="captions" />
        </video>

      {/if}
      </div>

      {#if !isSelectedAssetUnavailable}
        <div class="player-dock absolute inset-x-1 bottom-0 flex min-h-[var(--player-dock-height)] flex-col justify-end gap-2">
          <div class="transport-bar player-dock-surface flex items-center gap-2 rounded-sm px-2 py-1">
            <button
              class="play-btn inline-flex h-7 w-7 flex-none items-center justify-center rounded-sm border border-border-default bg-surface-raised text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              onclick={togglePlayback}
              disabled={isSelectedAssetUnavailable}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              <Icon icon={isPlaying ? Pause : Play} size={14} />
            </button>
            <input
              bind:this={scrubberRef}
              class="scrubber ui-range-thumb-sm h-1.5 min-w-0 flex-1 appearance-none rounded-full bg-surface-hover outline-none disabled:cursor-not-allowed disabled:opacity-40"
              type="range"
              min="0"
              max={Math.max(0.01, clipDuration)}
              step="0.01"
              value={clipLocalTime}
              disabled={clipDuration <= 0 || isSelectedAssetUnavailable}
              onpointerdown={handleScrubStart}
              oninput={handleScrubInput}
              onchange={handleScrubCommit}
            />
            <span class="transport-time flex-none whitespace-nowrap font-mono text-app-xs tabular-nums text-text-secondary">{formatTimecode(timelineCurrentTime)}</span>
          </div>

          <div class="trim-grid player-dock-surface grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 rounded-sm p-2">
            <span class="trim-label text-app-xs font-medium text-text-tertiary">In</span>
            <span class="trim-time font-mono text-app-sm tabular-nums text-text-secondary">{formatTimecode(timelineInTime)}</span>
            <div class="trim-actions flex items-center gap-[2px]">
              <button class="nudge-btn inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-border-default bg-surface-base text-text-tertiary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary" onclick={() => nudgeInPoint(-1)} title="-1 frame">
                <Icon icon={ChevronLeft} size={12} />
              </button>
              <button class="nudge-btn inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-border-default bg-surface-base text-text-tertiary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary" onclick={() => nudgeInPoint(1)} title="+1 frame">
                <Icon icon={ChevronRight} size={12} />
              </button>
            </div>

            <span class="trim-label text-app-xs font-medium text-text-tertiary">Out</span>
            <span class="trim-time font-mono text-app-sm tabular-nums text-text-secondary">{formatTimecode(timelineOutTime)}</span>
            <div class="trim-actions flex items-center gap-[2px]">
              <button class="nudge-btn inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-border-default bg-surface-base text-text-tertiary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary" onclick={() => nudgeOutPoint(-1)} title="-1 frame">
                <Icon icon={ChevronLeft} size={12} />
              </button>
              <button class="nudge-btn inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-border-default bg-surface-base text-text-tertiary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary" onclick={() => nudgeOutPoint(1)} title="+1 frame">
                <Icon icon={ChevronRight} size={12} />
              </button>
              <button
                class={cn(
                  'loop-btn ml-1 inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] transition-all',
                  isLooping
                    ? 'border border-accent-primary bg-accent-primary text-white hover:bg-accent-primary-hover'
                    : 'border border-border-default bg-surface-base text-text-secondary hover:border-border-strong hover:bg-surface-hover hover:text-text-primary'
                )}
                onclick={() => isLooping = !isLooping}
                title={isLooping ? 'Disable loop' : 'Enable loop'}
                aria-label={isLooping ? 'Loop enabled' : 'Loop disabled'}
                aria-pressed={isLooping}
              >
                <Icon icon={Repeat} size={12} />
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty-state flex min-h-[120px] flex-1 items-center justify-center text-app-sm text-text-disabled">
      <p class="m-0">Select a clip to preview</p>
    </div>
  {/if}
</div>
