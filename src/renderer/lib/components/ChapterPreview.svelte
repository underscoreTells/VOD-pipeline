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
  import { getChapterReverseProxy } from '../api/chapters.js';

  type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };

  interface Props {
    chapter: Chapter | null;
    asset: AvailabilityAwareAsset | null;
    clips?: Clip[];
  }

  let { chapter, asset, clips = timelineState.clips }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let currentTime = $state(0);
  let isCreatingFromSelection = $state(false);
  let lastChapterId = $state<number | null>(null);
  let isProgrammaticPlayheadSeek = $state(false);

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
    isProgrammaticPlayheadSeek = false;
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
    if (!videoRef || !chapter || !asset || asset.availability?.exists === false) return;
    applyTransportState();
  });

  $effect(() => {
    if (!videoRef || !chapter || activeSource !== 'reverse') return;
    if (!reverseProxyUrl) return;
    if (currentVideoUrl === reverseProxyUrl) return;

    setVideoSource('reverse', currentTime);
  });

  $effect(() => {
    if (!videoRef || !chapter) return;
    const targetGlobal = clampToChapter(chapter, timelineState.playheadTime);
    const targetMedia = activeSource === 'reverse'
      ? toReverseProxyTime(chapter, targetGlobal)
      : targetGlobal;

    if (Math.abs(targetMedia - videoRef.currentTime) < 0.05) return;
    isProgrammaticPlayheadSeek = true;
    videoRef.currentTime = targetMedia;
    currentTime = targetGlobal;
  });

  onDestroy(() => {
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
    const value = Number((event.target as HTMLInputElement).value);
    const nextGlobal = toChapterGlobalTime(chapter, value);
    const nextMedia = activeSource === 'reverse'
      ? toReverseProxyTime(chapter, nextGlobal)
      : nextGlobal;
    videoRef.currentTime = nextMedia;
    currentTime = nextGlobal;
    setPlayhead(nextGlobal);
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
    <span class="chapter-title">{previewTitle()}</span>
  </div>

  <div class="player-stage">
    <div class="video-frame" class:empty={!hasPreview() || assetUnavailable()} class:with-dock={chapter && asset}>
      {#if !hasPreview()}
        <div class="empty-state">
          <div class="empty-icon"><Icon icon={Clapperboard} size={40} /></div>
          <p>Select a chapter to preview</p>
        </div>
      {:else if assetUnavailable()}
        <div class="unavailable-state">
          <p class="unavailable-title">Chapter source file is unavailable</p>
          <p class="unavailable-path">{asset?.availability?.savedPath ?? asset?.file_path}</p>
          {#if asset?.availability?.nearestExistingAncestor}
            <p class="unavailable-ancestor">
              Nearest existing path: {asset.availability.nearestExistingAncestor}
            </p>
          {/if}
        </div>
      {:else}
        <video
          bind:this={videoRef}
          class="preview-video"
          onseeking={handleSeeking}
          onseeked={handleSeeked}
          ontimeupdate={handleTimeUpdate}
          onloadedmetadata={handleLoadedMetadata}
          onerror={handleVideoError}
          preload="metadata"
          playsinline
        >
          <track kind="captions" />
        </video>
      {/if}
    </div>

    {#if chapter && asset}
      <div class="player-dock">
        <div class="transport-bar">
          <button
            class="play-btn"
            onclick={togglePlayback}
            disabled={assetUnavailable()}
            aria-label={timelineState.isPlaying ? 'Pause' : 'Play'}
          >
            <Icon icon={timelineState.isPlaying ? Pause : Play} size={14} />
          </button>
          <input
            class="scrubber"
            type="range"
            min="0"
            max={chapterDuration()}
            step="0.01"
            value={localTime()}
            disabled={assetUnavailable()}
            oninput={handleScrubInput}
          />
          <span class="transport-time">{formatTime(localTime())} / {formatTime(chapterDuration())}</span>
        </div>

        <div class="info-grid">
          <span class="info-label">Range</span>
          <span class="info-value">{formatTime(chapter.start_time)} - {formatTime(chapter.end_time)}</span>
          <span class="info-meta">{clipRanges.length === 0 ? 'None' : `${clipRanges.length} kept`}</span>

          <span class="info-label">Mode</span>
          <span class="info-value">{activeSource === 'reverse' ? 'Reverse' : 'Forward'}</span>
          <span class="info-meta" class:info-status={Boolean(reverseStatusMessage)}>
            {reverseStatusMessage ?? formatTime(localTime())}
          </span>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .chapter-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--surface-base);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    cursor: default;
  }

  .preview-header h3 {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1.4;
    padding: 2px 0;
  }

  .chapter-title {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-stage {
    --player-dock-height: 110px;
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .video-frame {
    position: relative;
    background: #000;
    border-radius: var(--radius-md);
    overflow: hidden;
    min-height: 0;
  }

  .player-stage .video-frame {
    position: absolute;
    inset: 0;
  }

  .video-frame.with-dock {
    bottom: calc(var(--player-dock-height) + var(--space-2));
  }

  .video-frame.empty {
    background: linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-page) 100%);
  }

  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  .unavailable-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-5);
    box-sizing: border-box;
    background: linear-gradient(180deg, var(--surface-base) 0%, var(--surface-page) 100%);
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
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-tertiary);
    word-break: break-all;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--text-tertiary);
    text-align: center;
    pointer-events: none;
  }

  .empty-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
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

  .transport-time {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .info-grid {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-auto-rows: 22px;
    gap: var(--space-1) var(--space-2);
    align-items: center;
    padding: var(--space-2);
    background: rgba(18, 18, 18, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(8px);
  }

  .info-label {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    line-height: 22px;
  }

  .info-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    line-height: 22px;
  }

  .info-meta {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    text-align: right;
    line-height: 22px;
  }

  .info-status {
    color: #fbbf24;
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

</style>
