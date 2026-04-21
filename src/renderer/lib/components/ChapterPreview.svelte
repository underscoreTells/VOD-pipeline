<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Chapter, Asset, Clip } from '$shared/types/database';
  import type { AssetAvailability } from '$shared/contracts/ipc';
  import Icon from './ui/Icon.svelte';
  import { Clapperboard, Play, Pause } from '../constants';
  import { buildPlayableAssetUrl } from '../utils/media';
  import { formatTime } from '../utils/time';
  import {
    clampToChapter,
    getChapterDuration,
    toChapterGlobalTime,
    toChapterLocalTime,
  } from '../utils/chapter-time';
  import {
    timelineState,
    type TimelineTransportSnapshot,
    restoreTransport,
    setPlayhead,
    setPlaying,
    snapshotTransport,
    stopShuttle,
    togglePlayback,
  } from '../state/timeline.svelte';
  import {
    clipBuilderState,
    clearSelection,
    hasCompleteSelection,
  } from '../state/clip-builder.svelte';
  import { createProjectClip, projectDetail } from '../state/project-detail.svelte';
  import { getChapterReverseProxy } from '../api/chapters.js';
  import { cn } from '../utils/cn';
  import { createQueuedMediaSeek } from '../utils/queuedMediaSeek';

  type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };

  interface Props {
    class?: string;
    chapter: Chapter | null;
    asset: AvailabilityAwareAsset | null;
    clips?: Clip[];
  }

  let { class: className = '', chapter, asset, clips = timelineState.clips }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let scrubberRef = $state<HTMLInputElement | null>(null);
  let currentTime = $state(0);
  let isCreatingFromSelection = $state(false);
  let isScrubbing = $state(false);
  let lastChapterId = $state<number | null>(null);
  let isProgrammaticPlayheadSeek = $state(false);
  let resumeTransportSnapshot = $state<TimelineTransportSnapshot | null>(null);

  let reverseProxyStatus = $state<'missing' | 'generating' | 'ready' | 'error'>('missing');
  let reverseProxyUrl = $state<string | null>(null);
  let reverseProxyQuality = $state<'quick' | 'full' | null>(null);
  let reverseProxyIsFinal = $state(false);
  let reverseProxyError = $state<string | null>(null);
  let reverseStatusMessage = $state<string | null>(null);

  let reverseProxyRequestToken = 0;
  let reverseEnsureRequested = false;
  let reversePollTimerId: number | null = null;
  let activeSource = $state<'normal' | 'reverse'>('normal');
  let currentVideoUrl: string | null = null;
  let pendingGlobalSeekTime: number | null = null;
  let clearScrubListeners: (() => void) | null = null;

  const seekController = createQueuedMediaSeek({
    getVideo: () => videoRef,
    normalizeTime: (time) => normalizeMediaSeekTime(time),
  });

  const hasPreview = $derived(() => Boolean(chapter && asset));
  const previewTitle = $derived(() => chapter?.title || 'No chapter selected');
  const assetUnavailable = $derived(() => asset?.availability?.exists === false);

  const chapterDuration = $derived(() => getChapterDuration(chapter));
  const localTime = $derived(() => toChapterLocalTime(chapter, currentTime));

  const clipRanges = $derived.by(() => {
    if (!chapter || !asset) return [] as Array<{ start: number; end: number }>;
    const ranges: Array<{ start: number; end: number }> = [];
    for (const clip of clips) {
      if (clip.asset_id !== asset.id) continue;
      const duration = clip.out_point - clip.in_point;
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const start = clampToChapter(chapter, clip.start_time);
      const end = clampToChapter(chapter, clip.start_time + duration);
      if (end <= start) continue;
      ranges.push({ start, end });
    }

    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    const mergeEpsilon = 0.02;
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...range });
        continue;
      }
      if (range.start <= last.end + mergeEpsilon) {
        last.end = Math.max(last.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }

    return merged;
  });

  function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function getChapterDurationSafe(selectedChapter: Chapter | null): number {
    return Math.max(0.01, getChapterDuration(selectedChapter));
  }

  function toReverseProxyTime(selectedChapter: Chapter, globalTime: number): number {
    const duration = getChapterDurationSafe(selectedChapter);
    return clampNumber(selectedChapter.end_time - globalTime, 0, duration);
  }

  function fromReverseProxyTime(selectedChapter: Chapter, reverseTime: number): number {
    const duration = getChapterDurationSafe(selectedChapter);
    const clampedReverse = clampNumber(reverseTime, 0, duration);
    return clampToChapter(selectedChapter, selectedChapter.end_time - clampedReverse);
  }

  function normalizeMediaSeekTime(time: number): number {
    if (!chapter) return Math.max(0, time);

    if (activeSource === 'reverse') {
      return clampNumber(time, 0, getChapterDurationSafe(chapter));
    }

    return clampToChapter(chapter, time);
  }

  function getMediaTimeForGlobalTime(globalTime: number): number {
    if (!chapter) return globalTime;

    return activeSource === 'reverse'
      ? toReverseProxyTime(chapter, globalTime)
      : globalTime;
  }

  function clearScrubPointerListeners() {
    clearScrubListeners?.();
    clearScrubListeners = null;
  }

  function resetScrubSession() {
    clearScrubPointerListeners();
    seekController.reset();
    isScrubbing = false;
    isProgrammaticPlayheadSeek = false;
    resumeTransportSnapshot = null;
  }

  function getScrubGlobalTime(input: HTMLInputElement | null): number | null {
    if (!chapter) return null;

    const fallbackLocalTime = localTime();
    const rawValue = input ? Number(input.value) : fallbackLocalTime;
    const nextLocalTime = clampNumber(
      Number.isFinite(rawValue) ? rawValue : fallbackLocalTime,
      0,
      chapterDuration()
    );

    return toChapterGlobalTime(chapter, nextLocalTime);
  }

  function beginScrubSession() {
    if (!videoRef || !chapter || !asset || asset.availability?.exists === false || isScrubbing) return;

    resumeTransportSnapshot = snapshotTransport();
    isScrubbing = true;
    stopShuttle();
  }

  function finalizeScrubSession(input: HTMLInputElement | null) {
    if (!videoRef || !chapter || !isScrubbing) return;

    const nextGlobal = getScrubGlobalTime(input);
    if (nextGlobal === null) return;

    const nextMedia = getMediaTimeForGlobalTime(nextGlobal);
    isProgrammaticPlayheadSeek = true;
    seekController.commit(nextMedia);
    currentTime = nextGlobal;
    setPlayhead(nextGlobal);
    isScrubbing = false;

    const snapshot = resumeTransportSnapshot;
    resumeTransportSnapshot = null;

    if (snapshot?.isPlaying) {
      restoreTransport(snapshot);
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

  function setPitchCorrection(media: HTMLVideoElement, enabled: boolean) {
    const element = media as HTMLVideoElement & {
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
      mozPreservesPitch?: boolean;
    };
    if (typeof element.preservesPitch === 'boolean') {
      element.preservesPitch = enabled;
    }
    if (typeof element.webkitPreservesPitch === 'boolean') {
      element.webkitPreservesPitch = enabled;
    }
    if (typeof element.mozPreservesPitch === 'boolean') {
      element.mozPreservesPitch = enabled;
    }
  }

  function clearReversePollTimer() {
    if (reversePollTimerId !== null) {
      window.clearTimeout(reversePollTimerId);
      reversePollTimerId = null;
    }
  }

  function scheduleReverseProxyPoll() {
    if (!reverseEnsureRequested || reversePollTimerId !== null) return;
    reversePollTimerId = window.setTimeout(() => {
      reversePollTimerId = null;
      void refreshReverseProxy(false);
    }, 5000);
  }

  async function refreshReverseProxy(ensureReady: boolean): Promise<void> {
    if (!chapter || !asset || asset.file_type !== 'video' || asset.availability?.exists === false) {
      reverseProxyStatus = 'missing';
      reverseProxyUrl = null;
      reverseProxyError = null;
      reverseStatusMessage = null;
      reverseEnsureRequested = false;
      clearReversePollTimer();
      return;
    }

    const token = ++reverseProxyRequestToken;
    if (ensureReady) {
      reverseEnsureRequested = true;
    }

    try {
      const result = await getChapterReverseProxy(chapter.id, asset.id, { ensureReady });
      if (token !== reverseProxyRequestToken) return;

      if (!result.success || !result.data) {
        reverseProxyStatus = 'error';
        reverseProxyUrl = null;
        reverseProxyQuality = null;
        reverseProxyIsFinal = false;
        reverseProxyError = result.error || 'Failed to load reverse preview status';
      } else {
        reverseProxyStatus = result.data.status;
        reverseProxyUrl = result.data.url ?? null;
        reverseProxyQuality = result.data.quality ?? null;
        reverseProxyIsFinal = result.data.isFinal ?? result.data.quality !== 'quick';
        reverseProxyError = result.data.error ?? null;
      }
    } catch (error) {
      if (token !== reverseProxyRequestToken) return;
      reverseProxyStatus = 'error';
      reverseProxyUrl = null;
      reverseProxyQuality = null;
      reverseProxyIsFinal = false;
      reverseProxyError = error instanceof Error ? error.message : String(error);
    }

    if (token !== reverseProxyRequestToken) return;

    const shouldKeepPolling =
      reverseProxyStatus === 'generating' ||
      (reverseProxyStatus === 'ready' && reverseProxyIsFinal === false && reverseEnsureRequested);

    if (shouldKeepPolling) {
      if (reverseEnsureRequested) {
        scheduleReverseProxyPoll();
      } else {
        clearReversePollTimer();
      }
    } else {
      clearReversePollTimer();
      reverseEnsureRequested = false;
    }
  }

  function applyPendingSeek() {
    if (!videoRef || !chapter) return;
    if (pendingGlobalSeekTime === null) return;

    const targetGlobalTime = clampToChapter(chapter, pendingGlobalSeekTime);
    const targetMediaTime =
      activeSource === 'reverse'
        ? toReverseProxyTime(chapter, targetGlobalTime)
        : targetGlobalTime;

    isProgrammaticPlayheadSeek = true;
    videoRef.currentTime = targetMediaTime;
    currentTime = targetGlobalTime;
    setPlayhead(targetGlobalTime);
    pendingGlobalSeekTime = null;
  }

  function setVideoSource(source: 'normal' | 'reverse', targetGlobalTime: number) {
    if (!videoRef || !chapter || !asset) return;
    const targetUrl = source === 'normal' ? buildPlayableAssetUrl(asset) : reverseProxyUrl;
    if (!targetUrl) return;

    activeSource = source;
    pendingGlobalSeekTime = clampToChapter(chapter, targetGlobalTime);

    if (currentVideoUrl !== targetUrl) {
      seekController.reset();
      currentVideoUrl = targetUrl;
      videoRef.src = targetUrl;
      videoRef.load();
      return;
    }

    applyPendingSeek();
  }

  function getExcludeCutJump(time: number): { time: number; shouldPause: boolean } | null {
    const ranges = clipRanges;
    if (!ranges.length) return null;
    const epsilon = 0.03;

    if (time < ranges[0].start - epsilon) {
      return { time: ranges[0].start, shouldPause: false };
    }

    for (let i = 0; i < ranges.length; i += 1) {
      const range = ranges[i];
      if (time < range.start - epsilon) {
        return { time: range.start, shouldPause: false };
      }
      if (time >= range.start - epsilon && time <= range.end + epsilon) {
        if (time >= range.end - epsilon) {
          const nextRange = ranges[i + 1];
          if (nextRange) {
            return { time: nextRange.start, shouldPause: false };
          }
          return { time: range.end, shouldPause: true };
        }
        return null;
      }
    }

    const lastRange = ranges[ranges.length - 1];
    return lastRange ? { time: lastRange.end, shouldPause: true } : null;
  }

  function applyTransportState() {
    if (!videoRef || !chapter || !asset) return;
    if (asset.availability?.exists === false) {
      reverseStatusMessage = null;
      if (!videoRef.paused) {
        videoRef.pause();
      }
      return;
    }

    if (!timelineState.isPlaying || timelineState.shuttleDirection === 0) {
      reverseStatusMessage = null;

      if (activeSource === 'reverse') {
        const mappedGlobal = fromReverseProxyTime(chapter, videoRef.currentTime);
        setVideoSource('normal', mappedGlobal);
        return;
      }

      if (!videoRef.paused) {
        videoRef.pause();
      }
      videoRef.playbackRate = 1;
      videoRef.muted = false;
      setPitchCorrection(videoRef, true);
      return;
    }

    if (timelineState.shuttleDirection === -1) {
      if (reverseProxyStatus !== 'ready' || !reverseProxyUrl) {
        if (!reverseEnsureRequested) {
          void refreshReverseProxy(true);
        }

        reverseStatusMessage = reverseProxyStatus === 'error'
          ? (reverseProxyError ?? 'Reverse preview failed')
          : 'Preparing reverse preview...';

        if (!videoRef.paused) {
          videoRef.pause();
        }
        videoRef.playbackRate = 1;
        videoRef.muted = false;
        setPitchCorrection(videoRef, false);
        return;
      }

      if (!reverseProxyIsFinal && reverseProxyQuality === 'quick') {
        reverseStatusMessage = 'Using quick reverse cache while high quality finishes...';
        if (!reverseEnsureRequested) {
          void refreshReverseProxy(true);
        }
      } else {
        reverseStatusMessage = null;
      }

      if (activeSource !== 'reverse') {
        const referenceTime = clampToChapter(chapter, timelineState.playheadTime);
        setVideoSource('reverse', referenceTime);
        return;
      }

      const speed = Math.max(1, timelineState.shuttleSpeed);
      videoRef.playbackRate = speed;
      videoRef.muted = false;
      setPitchCorrection(videoRef, false);

      if (videoRef.paused) {
        void videoRef.play().catch(() => {
          setPlaying(false);
        });
      }
      return;
    }

    reverseStatusMessage = null;

    if (activeSource === 'reverse') {
      const mappedGlobal = fromReverseProxyTime(chapter, videoRef.currentTime);
      setVideoSource('normal', mappedGlobal);
      return;
    }

    const speed = Math.max(1, timelineState.shuttleSpeed);
    videoRef.playbackRate = speed;
    videoRef.muted = false;
    setPitchCorrection(videoRef, speed <= 1);
    if (videoRef.paused) {
      void videoRef.play().catch(() => {
        setPlaying(false);
      });
    }
  }

  function handleSeeking() {
    if (!videoRef || !chapter) return;

    if (activeSource === 'reverse') {
      const duration = getChapterDurationSafe(chapter);
      const next = clampNumber(videoRef.currentTime, 0, duration);
      if (Math.abs(next - videoRef.currentTime) > 0.01) {
        videoRef.currentTime = next;
      }
      return;
    }

    const next = clampToChapter(chapter, videoRef.currentTime);
    if (Math.abs(next - videoRef.currentTime) > 0.01) {
      videoRef.currentTime = next;
    }
  }

  function handleTimeUpdate() {
    if (!videoRef || !chapter) return;

    if (isScrubbing) {
      return;
    }

    if (activeSource === 'reverse') {
      const duration = getChapterDurationSafe(chapter);
      const reverseTime = clampNumber(videoRef.currentTime, 0, duration);
      if (Math.abs(reverseTime - videoRef.currentTime) > 0.01) {
        videoRef.currentTime = reverseTime;
      }

      const mappedGlobalTime = fromReverseProxyTime(chapter, reverseTime);
      currentTime = mappedGlobalTime;
      if (!(isProgrammaticPlayheadSeek && !timelineState.isPlaying)) {
        setPlayhead(mappedGlobalTime);
      }

      if (
        timelineState.isPlaying &&
        timelineState.shuttleDirection === -1 &&
        reverseTime >= duration - 0.001
      ) {
        videoRef.pause();
        setPlaying(false);
      }
      return;
    }

    let next = clampToChapter(chapter, videoRef.currentTime);
    if (next !== videoRef.currentTime) {
      videoRef.pause();
      videoRef.currentTime = next;
      setPlaying(false);
    }

    if (timelineState.excludeCutContent && timelineState.isPlaying && timelineState.shuttleDirection === 1) {
      const skip = getExcludeCutJump(next);
      if (skip) {
        if (Math.abs(skip.time - next) > 0.01) {
          videoRef.currentTime = skip.time;
          next = skip.time;
        }
        if (skip.shouldPause) {
          videoRef.pause();
          setPlaying(false);
        }
      }
    }

    currentTime = next;
    if (!(isProgrammaticPlayheadSeek && !timelineState.isPlaying)) {
      setPlayhead(next);
    }
  }

  function handleSeeked() {
    seekController.handleSeeked();
    if (!videoRef?.seeking) {
      isProgrammaticPlayheadSeek = false;
    }
  }

  function handleLoadedMetadata() {
    if (!videoRef || !chapter) return;

    if (pendingGlobalSeekTime === null) {
      pendingGlobalSeekTime = activeSource === 'reverse'
        ? clampToChapter(chapter, chapter.end_time)
        : clampToChapter(chapter, chapter.start_time);
    }

    applyPendingSeek();
    applyTransportState();
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ChapterPreview] Video playback error', error);

    if (activeSource === 'reverse' && chapter && asset) {
      reverseProxyStatus = 'error';
      reverseProxyError = 'Reverse preview could not be played';
      reverseStatusMessage = reverseProxyError;
      const fallbackTime = clampToChapter(chapter, currentTime || chapter.start_time);
      setVideoSource('normal', fallbackTime);
      setPlaying(false);
    }
  }

  $effect(() => {
    const chapterId = chapter?.id ?? null;
    const chapterStart = chapter?.start_time ?? null;
    const chapterEnd = chapter?.end_time ?? null;
    const assetId = asset?.id ?? null;

    if (!videoRef) return;

    void chapterId;
    void chapterStart;
    void chapterEnd;
    void assetId;

    resetScrubSession();
    reverseProxyRequestToken += 1;
    clearReversePollTimer();
    reverseEnsureRequested = false;
    reverseProxyStatus = 'missing';
    reverseProxyUrl = null;
    reverseProxyQuality = null;
    reverseProxyIsFinal = false;
    reverseProxyError = null;
    reverseStatusMessage = null;

    activeSource = 'normal';
    currentVideoUrl = null;
    pendingGlobalSeekTime = null;

    if (!asset) {
      videoRef.removeAttribute('src');
      videoRef.load();
      currentTime = 0;
      return;
    }

    const normalUrl = buildPlayableAssetUrl(asset);
    if (!normalUrl) {
      videoRef.pause();
      videoRef.removeAttribute('src');
      videoRef.load();
      currentTime = 0;
      return;
    }

    currentVideoUrl = normalUrl;
    videoRef.src = normalUrl;
    pendingGlobalSeekTime = chapter
      ? clampToChapter(chapter, chapter.start_time)
      : 0;
    videoRef.load();

    if (chapter && asset.file_type === 'video' && asset.availability?.exists !== false) {
      void refreshReverseProxy(true);
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
    if (!videoRef || !chapter || !asset || asset.availability?.exists === false || isScrubbing) return;
    applyTransportState();
  });

  $effect(() => {
    if (!videoRef || !chapter || activeSource !== 'reverse' || isScrubbing) return;
    if (!reverseProxyUrl) return;
    if (currentVideoUrl === reverseProxyUrl) return;

    setVideoSource('reverse', currentTime);
  });

  $effect(() => {
    if (!videoRef || !chapter || isScrubbing) return;
    const targetGlobal = clampToChapter(chapter, timelineState.playheadTime);
    const targetMedia = getMediaTimeForGlobalTime(targetGlobal);

    if (Math.abs(targetMedia - videoRef.currentTime) < 0.05) return;
    isProgrammaticPlayheadSeek = true;
    videoRef.currentTime = targetMedia;
    currentTime = targetGlobal;
  });

  onDestroy(() => {
    resetScrubSession();
    clearReversePollTimer();
  });

  async function handleSelectionAutoCreate() {
    if (!projectDetail.projectId || !chapter || !asset || asset.availability?.exists === false) return;
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

    beginScrubSession();

    const input = event.currentTarget instanceof HTMLInputElement
      ? event.currentTarget
      : scrubberRef;
    const nextGlobal = getScrubGlobalTime(input);
    if (nextGlobal === null) return;

    const nextMedia = getMediaTimeForGlobalTime(nextGlobal);
    isProgrammaticPlayheadSeek = true;
    currentTime = nextGlobal;
    setPlayhead(nextGlobal);
    seekController.preview(nextMedia);
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

  $effect(() => {
    if (hasCompleteSelection()) {
      void handleSelectionAutoCreate();
    }
  });
</script>

<div
  class={cn(
    'chapter-preview flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-md border border-border-default bg-surface-base p-2',
    className,
  )}
>
  <div class="preview-header flex cursor-default items-center justify-between gap-2">
    <h3 class="m-0 py-0.5 text-app-xs font-medium text-text-primary">Chapter preview</h3>
    <span class="chapter-title truncate text-app-sm text-text-tertiary">{previewTitle()}</span>
  </div>

  <div class="player-stage relative flex-1 min-h-0" style="--player-dock-height: 110px;">
    <div
      class={cn(
        'video-frame absolute inset-x-0 top-0 min-h-0 overflow-hidden rounded-md bg-black',
        (!hasPreview() || assetUnavailable()) && 'bg-linear-to-b from-surface-raised to-surface-page',
      )}
      style={`bottom: ${chapter && asset ? 'calc(var(--player-dock-height) + var(--space-2))' : '0px'}`}
    >
      {#if !hasPreview()}
        <div class="empty-state pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-text-tertiary">
          <div class="empty-icon flex items-center justify-center opacity-60"><Icon icon={Clapperboard} size={40} /></div>
          <p>Select a chapter to preview</p>
        </div>
      {:else if assetUnavailable()}
        <div class="unavailable-state absolute inset-0 flex flex-col justify-center gap-2 bg-linear-to-b from-surface-base to-surface-page p-5 text-text-secondary">
          <p class="unavailable-title m-0 font-semibold text-text-primary">Chapter source file is unavailable</p>
          <p class="unavailable-path m-0 break-all text-app-xs leading-[1.4] text-text-tertiary">{asset?.availability?.savedPath ?? asset?.file_path}</p>
          {#if asset?.availability?.nearestExistingAncestor}
            <p class="unavailable-ancestor m-0 break-all text-app-xs leading-[1.4] text-text-tertiary">
              Nearest existing path: {asset.availability.nearestExistingAncestor}
            </p>
          {/if}
        </div>
      {:else}
        <video
          bind:this={videoRef}
          class="preview-video h-full w-full object-contain"
          onseeking={handleSeeking}
          onseeked={handleSeeked}
          ontimeupdate={handleTimeUpdate}
          onloadedmetadata={handleLoadedMetadata}
          onerror={handleVideoError}
          preload="auto"
          playsinline
        >
          <track kind="captions" />
        </video>
      {/if}
    </div>

    {#if chapter && asset}
      <div class="player-dock absolute inset-x-1 bottom-0 flex min-h-[var(--player-dock-height)] flex-col justify-end gap-2">
        <div class="transport-bar flex items-center gap-2 rounded-sm border border-white/8 bg-[rgba(18,18,18,0.86)] px-2 py-1 backdrop-blur-[8px]">
          <button
            class="play-btn inline-flex h-7 w-7 flex-none items-center justify-center rounded-sm border border-border-default bg-surface-raised text-text-secondary transition-all hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            onclick={togglePlayback}
            disabled={assetUnavailable()}
            aria-label={timelineState.isPlaying ? 'Pause' : 'Play'}
          >
            <Icon icon={timelineState.isPlaying ? Pause : Play} size={14} />
          </button>
          <input
            bind:this={scrubberRef}
            class="scrubber ui-range-thumb-sm h-1.5 min-w-0 flex-1 appearance-none rounded-full bg-surface-hover outline-none disabled:cursor-not-allowed disabled:opacity-40"
            type="range"
            min="0"
            max={chapterDuration()}
            step="0.01"
            value={localTime()}
            disabled={assetUnavailable()}
            onpointerdown={handleScrubStart}
            oninput={handleScrubInput}
            onchange={handleScrubCommit}
          />
          <span class="transport-time flex-none whitespace-nowrap font-mono text-app-xs tabular-nums text-text-secondary">
            {formatTime(localTime())} / {formatTime(chapterDuration())}
          </span>
        </div>

        <div class="info-grid grid grid-cols-[auto_1fr_auto] auto-rows-[22px] items-center gap-x-2 gap-y-1 rounded-sm border border-white/8 bg-[rgba(18,18,18,0.86)] p-2 backdrop-blur-[8px]">
          <span class="info-label text-app-xs font-medium leading-[22px] text-text-tertiary">Range</span>
          <span class="info-value font-mono text-app-sm tabular-nums leading-[22px] text-text-secondary">{formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}</span>
          <span class="info-meta text-right font-mono text-app-sm tabular-nums leading-[22px] text-text-tertiary">{clipRanges.length === 0 ? 'None' : `${clipRanges.length} kept`}</span>

          <span class="info-label text-app-xs font-medium leading-[22px] text-text-tertiary">Mode</span>
          <span class="info-value text-app-sm leading-[22px] text-text-secondary">{activeSource === 'reverse' ? 'Reverse' : 'Forward'}</span>
          <span
            class="info-meta text-right text-app-sm tabular-nums leading-[22px] text-text-tertiary"
            class:text-[#fbbf24]={Boolean(reverseStatusMessage)}
          >
            {reverseStatusMessage ?? formatTime(localTime())}
          </span>
        </div>
      </div>
    {/if}
  </div>
</div>
