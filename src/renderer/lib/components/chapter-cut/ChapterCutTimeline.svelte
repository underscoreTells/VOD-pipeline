<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Chapter, Clip, Suggestion } from '$shared/types/database';
  import type { ProjectAsset } from '$shared/contracts/ipc';
  import { getWaveform, onWaveformProgress } from '../../api/waveforms.js';
  import {
    createProjectClip,
    executeSlideClipWindow,
    executeUpdateClipTiming,
  } from '../../state/project-detail.svelte.js';
  import {
    clearSelection,
    setExcludeCutContent,
    setMinZoom,
    setPlayhead,
    setScroll,
    setZoom,
    timelineState,
    togglePlayback,
  } from '../../state/timeline.svelte.js';
  import { canRedo, canUndo, redo, undo } from '../../state/undo-redo.svelte.js';
  import { agentState, focusSuggestion } from '../../state/agent.svelte.js';
  import { generateAssetWaveform } from '../../state/project-waveforms.svelte.js';
  import {
    calculateZoomAroundPointer,
    clampNumber,
    getAdaptiveRulerStep,
    getTimelineZoomBounds,
    normalizeRange,
    pointerToTime,
    rangesOverlap,
    snapRangeToFrames,
    snapTimeToFrame,
  } from '../../utils/timeline-geometry.js';
  import { ROLE_CONFIG } from '../../constants.js';
  import Icon from '../ui/Icon.svelte';
  import { Minus, Pause, Play } from '../../constants.js';
  import { cn } from '../../utils/cn.js';
  import {
    shouldRequestChapterWaveform,
    type ChapterWaveformStatus,
  } from './chapter-cut-waveform.js';

  interface Props {
    projectId: number;
    chapter: Chapter;
    assets: ProjectAsset[];
    clips: Clip[];
    suggestions: Suggestion[];
  }

  type DragState = {
    mode: 'scrub' | 'create' | 'resize' | 'move' | 'overview';
    pointerId: number;
    assetId?: number;
    clipId?: number;
    edge?: 'start' | 'end';
    anchor?: number;
    offset?: number;
    originalStart?: number;
    originalEnd?: number;
  };

  let { projectId, chapter, assets, clips, suggestions }: Props = $props();
  let viewportRef = $state<HTMLDivElement | null>(null);
  let overviewRef = $state<HTMLDivElement | null>(null);
  let waveformCanvas = $state<HTMLCanvasElement | null>(null);
  let viewportWidth = $state(0);
  let waveformPeaks = $state<Array<{ min: number; max: number }>>([]);
  let waveformDuration = $state(0);
  let waveformStatus = $state<ChapterWaveformStatus>('loading');
  let waveformAssetId = $state<number | null>(null);
  const waveformLoadsInFlight = new Set<number>();
  let drag = $state<DragState | null>(null);
  let dragPreview = $state<{ start: number; end: number } | null>(null);
  let dragMoved = false;
  let fittedChapterId: number | null = null;

  const duration = $derived(Math.max(0.01, chapter.end_time - chapter.start_time));
  const primaryAsset = $derived(assets.find((asset) => asset.availability.exists !== false) ?? assets[0] ?? null);
  const fps = $derived.by(() => {
    const metadata = primaryAsset?.metadata as Record<string, unknown> | null | undefined;
    const value = metadata?.fps;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 30;
  });
  const zoomBounds = $derived(getTimelineZoomBounds(duration, viewportWidth));
  const minPps = $derived(zoomBounds.min);
  const maxPps = $derived(zoomBounds.max);
  const contentWidth = $derived(Math.max(viewportWidth, duration * timelineState.zoomLevel));
  const visibleDuration = $derived(viewportWidth / Math.max(0.001, timelineState.zoomLevel));
  const rulerTicks = $derived.by(() => {
    const step = getAdaptiveRulerStep(timelineState.zoomLevel);
    const start = timelineState.scrollPosition;
    const end = Math.min(duration, start + visibleDuration);
    const first = Math.floor(start / step) * step;
    const ticks: number[] = [];
    for (let time = first; time <= end + step && ticks.length < 200; time += step) {
      if (time >= 0) ticks.push(time);
    }
    return ticks;
  });
  const pendingSuggestions = $derived(suggestions.filter((suggestion) => suggestion.status === 'pending'));
  const overviewWindowLeft = $derived(contentWidth > 0 ? (timelineState.scrollPosition * timelineState.zoomLevel / contentWidth) * 100 : 0);
  const overviewWindowWidth = $derived(contentWidth > 0 ? Math.min(100, viewportWidth / contentWidth * 100) : 100);

  function localTime(sourceTime: number): number {
    return clampNumber(sourceTime - chapter.start_time, 0, duration);
  }

  function sourceTime(local: number): number {
    return chapter.start_time + clampNumber(local, 0, duration);
  }

  function formatTimecode(local: number): string {
    const roundedFps = Math.max(1, Math.round(fps));
    const frames = Math.round(clampNumber(local, 0, duration) * roundedFps);
    const frame = frames % roundedFps;
    const seconds = Math.floor(frames / roundedFps);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
  }

  function pointerTime(event: PointerEvent): number {
    if (!viewportRef) return 0;
    const rect = viewportRef.getBoundingClientRect();
    return snapTimeToFrame(pointerToTime({
      clientX: event.clientX,
      viewportLeft: rect.left,
      scrollLeft: viewportRef.scrollLeft,
      pixelsPerSecond: timelineState.zoomLevel,
      duration,
    }), fps);
  }

  function beginDrag(event: PointerEvent, next: DragState): void {
    drag = next;
    dragMoved = false;
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);
  }

  function endDrag(): void {
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerEnd);
    window.removeEventListener('pointercancel', handleWindowPointerEnd);
    drag = null;
    dragPreview = null;
  }

  function scrubTo(local: number): void {
    setPlayhead(sourceTime(local));
  }

  function handleScrubPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const time = pointerTime(event);
    scrubTo(time);
    beginDrag(event, { mode: 'scrub', pointerId: event.pointerId });
  }

  function clipsForAsset(assetId: number, excludeClipId?: number): Clip[] {
    return clips
      .filter((clip) => clip.asset_id === assetId && clip.id !== excludeClipId)
      .sort((left, right) => left.in_point - right.in_point);
  }

  function resolveSuggestionAssetId(suggestion: Suggestion): number | null {
    if (suggestion.target_clip_id) {
      return clips.find((clip) => clip.id === suggestion.target_clip_id)?.asset_id ?? null;
    }
    if (suggestion.action_payload_json) {
      try {
        const payload = JSON.parse(suggestion.action_payload_json) as { create?: { assetId?: number } };
        if (typeof payload.create?.assetId === 'number') return payload.create.assetId;
      } catch {
        // Fall back to the primary chapter asset.
      }
    }
    return primaryAsset?.id ?? null;
  }

  function suggestionHasConflict(suggestion: Suggestion): boolean {
    const assetId = resolveSuggestionAssetId(suggestion);
    if (!assetId) return true;
    const proposed = { start: suggestion.in_point, end: suggestion.out_point };
    return clipsForAsset(assetId, suggestion.target_clip_id ?? undefined).some((clip) =>
      rangesOverlap(proposed, { start: localTime(clip.in_point), end: localTime(clip.out_point) }, 1 / fps / 2)
    );
  }

  function handleLanePointerDown(event: PointerEvent, assetId: number): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const suggestionElement = target.closest<HTMLElement>('[data-suggestion-id]');
    if (suggestionElement) {
      event.preventDefault();
      const id = Number(suggestionElement.dataset.suggestionId);
      if (Number.isFinite(id)) focusSuggestion(id);
      return;
    }

    const clipElement = target.closest<HTMLElement>('[data-clip-id]');
    const handleElement = target.closest<HTMLElement>('[data-handle]');
    const time = pointerTime(event);
    if (clipElement) {
      const clipId = Number(clipElement.dataset.clipId);
      const clip = clips.find((item) => item.id === clipId);
      if (!clip) return;
      event.preventDefault();
      agentState.selectedSuggestionId = null;
      timelineState.selectedClipIds = new Set([clip.id]);
      scrubTo(localTime(clip.in_point));
      const start = localTime(clip.in_point);
      const end = localTime(clip.out_point);
      dragPreview = { start, end };
      if (handleElement) {
        beginDrag(event, {
          mode: 'resize',
          pointerId: event.pointerId,
          assetId,
          clipId,
          edge: handleElement.dataset.handle === 'start' ? 'start' : 'end',
          originalStart: start,
          originalEnd: end,
        });
      } else {
        beginDrag(event, {
          mode: 'move',
          pointerId: event.pointerId,
          assetId,
          clipId,
          offset: clampNumber(time - start, 0, end - start),
          originalStart: start,
          originalEnd: end,
        });
      }
      return;
    }

    event.preventDefault();
    clearSelection();
    agentState.selectedSuggestionId = null;
    dragPreview = { start: time, end: time };
    beginDrag(event, {
      mode: 'create',
      pointerId: event.pointerId,
      assetId,
      anchor: time,
    });
  }

  function clampAgainstLane(
    assetId: number,
    start: number,
    end: number,
    excludeClipId?: number
  ): { start: number; end: number } | null {
    const minDuration = 1 / fps;
    const normalized = normalizeRange(start, end, duration, minDuration);
    if (!normalized) return null;
    const overlaps = clipsForAsset(assetId, excludeClipId).some((clip) =>
      rangesOverlap(normalized, { start: localTime(clip.in_point), end: localTime(clip.out_point) }, minDuration / 2)
    );
    return overlaps ? null : normalized;
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragMoved = true;
    const time = pointerTime(event);
    if (drag.mode === 'scrub') {
      scrubTo(time);
      return;
    }
    if (drag.mode === 'overview') {
      panOverviewTo(overviewTime(event));
      return;
    }
    if (drag.mode === 'create') {
      dragPreview = { start: drag.anchor ?? time, end: time };
      return;
    }
    if (!dragPreview || !drag.assetId || !drag.clipId) return;
    if (drag.mode === 'resize') {
      const minDuration = 1 / fps;
      dragPreview = drag.edge === 'start'
        ? { start: clampNumber(time, 0, dragPreview.end - minDuration), end: dragPreview.end }
        : { start: dragPreview.start, end: clampNumber(time, dragPreview.start + minDuration, duration) };
      return;
    }
    if (drag.mode === 'move') {
      const clipDuration = (drag.originalEnd ?? 0) - (drag.originalStart ?? 0);
      const start = clampNumber(time - (drag.offset ?? 0), 0, duration - clipDuration);
      dragPreview = { start, end: start + clipDuration };
    }
  }

  async function handleWindowPointerEnd(event: PointerEvent): Promise<void> {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const activeDrag = drag;
    const preview = dragPreview ? snapRangeToFrames(dragPreview, fps) : null;
    endDrag();

    if (activeDrag.mode === 'scrub') {
      scrubTo(pointerTime(event));
      return;
    }
    if (activeDrag.mode === 'create' && preview && activeDrag.assetId) {
      const range = clampAgainstLane(activeDrag.assetId, preview.start, preview.end);
      if (!range) return;
      await createProjectClip(
        projectId,
        activeDrag.assetId,
        0,
        sourceTime(range.start),
        sourceTime(range.end)
      );
      return;
    }
    if (!preview || !activeDrag.assetId || !activeDrag.clipId || !dragMoved) return;
    const range = clampAgainstLane(activeDrag.assetId, preview.start, preview.end, activeDrag.clipId);
    if (!range) return;
    const clip = clips.find((item) => item.id === activeDrag.clipId);
    if (!clip) return;
    if (activeDrag.mode === 'move') {
      await executeSlideClipWindow(
        clip.id,
        clip.in_point,
        clip.out_point,
        sourceTime(range.start),
        sourceTime(range.end)
      );
    } else if (activeDrag.mode === 'resize') {
      await executeUpdateClipTiming(
        clip.id,
        clip.in_point,
        clip.out_point,
        sourceTime(range.start),
        sourceTime(range.end)
      );
    }
  }

  function setTimelineZoom(next: number, pointerX?: number): void {
    if (!viewportRef) return;
    const rect = viewportRef.getBoundingClientRect();
    const pps = clampNumber(next, minPps, maxPps);
    const scrollLeft = calculateZoomAroundPointer({
      pointerX: pointerX ?? rect.left + rect.width / 2,
      viewportLeft: rect.left,
      currentScrollLeft: viewportRef.scrollLeft,
      currentPixelsPerSecond: timelineState.zoomLevel,
      nextPixelsPerSecond: pps,
      duration,
      viewportWidth: rect.width,
    });
    setZoom(pps);
    setScroll(scrollLeft / pps);
    requestAnimationFrame(() => {
      if (!viewportRef) return;
      viewportRef.scrollLeft = scrollLeft;
      drawWaveform();
    });
  }

  function fitTimeline(): void {
    if (!viewportRef) return;
    setZoom(viewportRef.clientWidth / duration);
    setScroll(0);
    viewportRef.scrollLeft = 0;
    requestAnimationFrame(drawWaveform);
  }

  function handleWheel(event: WheelEvent): void {
    if (!viewportRef) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      setTimelineZoom(timelineState.zoomLevel * (event.deltaY > 0 ? 0.88 : 1.14), event.clientX);
      return;
    }
    viewportRef.scrollLeft += event.deltaX || event.deltaY;
  }

  function handleScroll(): void {
    if (!viewportRef) return;
    setScroll(viewportRef.scrollLeft / timelineState.zoomLevel);
    drawWaveform();
  }

  function overviewTime(event: PointerEvent): number {
    if (!overviewRef) return 0;
    const rect = overviewRef.getBoundingClientRect();
    return clampNumber((event.clientX - rect.left) / rect.width, 0, 1) * duration;
  }

  function panOverviewTo(time: number): void {
    if (!viewportRef) return;
    const next = clampNumber(
      time * timelineState.zoomLevel - viewportWidth / 2,
      0,
      Math.max(0, contentWidth - viewportWidth)
    );
    viewportRef.scrollLeft = next;
    setScroll(next / timelineState.zoomLevel);
  }

  function handleOverviewPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    panOverviewTo(overviewTime(event));
    beginDrag(event, { mode: 'overview', pointerId: event.pointerId });
  }

  function handlePlayheadKeydown(event: KeyboardEvent): void {
    let next: number | null = null;
    const current = localTime(timelineState.playheadTime);
    if (event.key === 'ArrowLeft') next = current - (event.shiftKey ? 10 / fps : 1 / fps);
    if (event.key === 'ArrowRight') next = current + (event.shiftKey ? 10 / fps : 1 / fps);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = duration;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    scrubTo(next);
  }

  function drawWaveform(): void {
    if (!waveformCanvas || !viewportRef || waveformPeaks.length === 0) return;
    const width = Math.max(1, viewportRef.clientWidth);
    const height = 76;
    const dpr = window.devicePixelRatio || 1;
    waveformCanvas.width = Math.round(width * dpr);
    waveformCanvas.height = Math.round(height * dpr);
    waveformCanvas.style.width = `${width}px`;
    waveformCanvas.style.height = `${height}px`;
    waveformCanvas.style.left = `${viewportRef.scrollLeft}px`;
    const context = waveformCanvas.getContext('2d');
    if (!context) return;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = getComputedStyle(waveformCanvas).color;
    context.globalAlpha = 0.72;
    context.beginPath();
    const visibleStart = viewportRef.scrollLeft / timelineState.zoomLevel;
    const sourceDuration = waveformDuration || primaryAsset?.duration || duration;
    for (let x = 0; x < width; x += 1) {
      const chapterLocal = visibleStart + x / timelineState.zoomLevel;
      const source = chapter.start_time + chapterLocal;
      const index = Math.min(
        waveformPeaks.length - 1,
        Math.max(0, Math.floor(source / sourceDuration * waveformPeaks.length))
      );
      const peak = waveformPeaks[index];
      const center = height / 2;
      context.moveTo(x + 0.5, center + peak.min * center);
      context.lineTo(x + 0.5, center + peak.max * center);
    }
    context.stroke();
  }

  async function loadWaveform(assetId: number): Promise<void> {
    if (!shouldRequestChapterWaveform({
      assetId,
      waveformAssetId,
      waveformStatus,
      isInFlight: waveformLoadsInFlight.has(assetId),
    })) return;

    waveformLoadsInFlight.add(assetId);
    waveformAssetId = assetId;
    waveformStatus = 'loading';
    try {
      let result = await getWaveform(assetId, -1, 1);
      if (!result.success || !result.data) {
        await generateAssetWaveform(assetId, -1, { playbackActive: false }, { uiMode: 'background' });
        result = await getWaveform(assetId, -1, 1);
      }
      if (waveformAssetId !== assetId) return;
      if (!result.success || !result.data) {
        waveformStatus = 'unavailable';
        return;
      }
      waveformPeaks = result.data.peaks;
      waveformDuration = result.data.duration;
      waveformStatus = 'ready';
      requestAnimationFrame(drawWaveform);
    } catch (error) {
      if (waveformAssetId === assetId) waveformStatus = 'unavailable';
      console.warn(`[ChapterCutTimeline] Waveform unavailable for asset ${assetId}`, error);
    } finally {
      waveformLoadsInFlight.delete(assetId);
    }
  }

  onMount(() => {
    const resizeObserver = new ResizeObserver(() => {
      if (!viewportRef) return;
      viewportWidth = viewportRef.clientWidth;
      setMinZoom(viewportWidth / duration);
      requestAnimationFrame(drawWaveform);
    });
    if (viewportRef) resizeObserver.observe(viewportRef);
    const unsubscribe = onWaveformProgress((event) => {
      if (event.assetId === primaryAsset?.id && event.progress.percent >= 100) {
        waveformAssetId = null;
        void loadWaveform(event.assetId);
      }
    });
    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      endDrag();
    };
  });

  $effect(() => {
    const assetId = primaryAsset?.id;
    if (assetId) void untrack(() => loadWaveform(assetId));
  });

  $effect(() => {
    const chapterId = chapter.id;
    const width = viewportWidth;
    const { min, max } = zoomBounds;
    if (width <= 0) return;

    untrack(() => {
      setMinZoom(min);
      if (fittedChapterId !== chapterId) {
        fittedChapterId = chapterId;
        setZoom(min);
        setScroll(0);
        if (viewportRef) viewportRef.scrollLeft = 0;
        return;
      }
      if (timelineState.zoomLevel > max) setZoom(max);
    });
  });

  $effect(() => {
    const local = localTime(timelineState.playheadTime);
    if (!viewportRef || timelineState.zoomLevel <= 0) return;
    const left = local * timelineState.zoomLevel;
    const visibleLeft = viewportRef.scrollLeft;
    const visibleRight = visibleLeft + viewportRef.clientWidth;
    if (left < visibleLeft || left > visibleRight) {
      const next = clampNumber(left - viewportRef.clientWidth / 2, 0, contentWidth - viewportRef.clientWidth);
      viewportRef.scrollLeft = next;
      setScroll(next / timelineState.zoomLevel);
    }
  });
</script>

<section class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-default bg-surface-base" aria-label="Chapter cut timeline">
  <div class="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-default px-3 py-2">
    <div class="flex items-center gap-2">
      <button class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent-primary text-white transition-colors hover:bg-accent-primary-hover" onclick={togglePlayback} aria-label={timelineState.isPlaying ? 'Pause' : 'Play'}>
        <Icon icon={timelineState.isPlaying ? Pause : Play} size={14} />
      </button>
      <span class="font-mono text-app-sm tabular-nums text-text-primary">{formatTimecode(localTime(timelineState.playheadTime))}</span>
      <span class="text-app-xs text-text-tertiary">of {formatTimecode(duration)}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <button class="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border-default text-text-secondary hover:bg-surface-hover" onclick={() => setTimelineZoom(timelineState.zoomLevel / 1.2)} aria-label="Zoom out"><Icon icon={Minus} size={13} /></button>
      <input
        class="ui-range-thumb-sm h-1 w-24 appearance-none rounded-full bg-border-default"
        type="range"
        min="0"
        max="100"
        value={(Math.log(timelineState.zoomLevel / Math.max(0.001, minPps)) / Math.log(maxPps / Math.max(0.001, minPps))) * 100 || 0}
        aria-label="Timeline zoom"
        oninput={(event) => {
          const ratio = maxPps / Math.max(0.001, minPps);
          setTimelineZoom(minPps * Math.pow(ratio, Number(event.currentTarget.value) / 100));
        }}
      />
      <button class="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border-default text-text-secondary hover:bg-surface-hover" onclick={() => setTimelineZoom(timelineState.zoomLevel * 1.2)} aria-label="Zoom in">+</button>
      <button class="rounded-sm border border-border-default px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover" onclick={fitTimeline}>Fit</button>
      <span class="mx-1 h-4 w-px bg-border-default"></span>
      <button class="rounded-sm px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover disabled:opacity-40" onclick={undo} disabled={!canUndo()}>Undo</button>
      <button class="rounded-sm px-2 py-1 text-app-xs text-text-secondary hover:bg-surface-hover disabled:opacity-40" onclick={redo} disabled={!canRedo()}>Redo</button>
      <button
        class="rounded-sm border px-2 py-1 text-app-xs transition-colors"
        class:border-accent-primary={timelineState.excludeCutContent}
        class:bg-accent-primary-subtle={timelineState.excludeCutContent}
        class:text-accent-primary={timelineState.excludeCutContent}
        class:border-border-default={!timelineState.excludeCutContent}
        class:text-text-secondary={!timelineState.excludeCutContent}
        onclick={() => setExcludeCutContent(!timelineState.excludeCutContent)}
        aria-pressed={timelineState.excludeCutContent}
      >Review cut
      </button>
    </div>
  </div>

  <div
    class="scrollbar-thin relative min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain"
    bind:this={viewportRef}
    onscroll={handleScroll}
    onwheel={handleWheel}
  >
    <div class="relative min-h-full" style={`width:${contentWidth}px`}>
      <div class="sticky top-0 z-20 h-7 border-b border-border-subtle bg-surface-raised" onpointerdown={handleScrubPointerDown} role="slider" tabindex="0" aria-label="Chapter playhead" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={localTime(timelineState.playheadTime)} aria-valuetext={formatTimecode(localTime(timelineState.playheadTime))} onkeydown={handlePlayheadKeydown}>
        {#each rulerTicks as tick (tick)}
          <div class="absolute inset-y-0 border-l border-border-subtle" style={`left:${tick * timelineState.zoomLevel}px`}>
            <span class="absolute left-1 top-1 font-mono text-[10px] tabular-nums text-text-tertiary">{formatTimecode(tick).slice(0, 8)}</span>
          </div>
        {/each}
      </div>

      <div class="relative h-[76px] cursor-ew-resize border-b border-border-subtle bg-surface-page text-text-tertiary" onpointerdown={handleScrubPointerDown} role="slider" tabindex="0" aria-label="Chapter waveform" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={localTime(timelineState.playheadTime)} onkeydown={handlePlayheadKeydown}>
        {#if waveformStatus === 'loading'}
          <div class="absolute inset-0 flex items-center justify-center text-app-xs text-text-disabled">Preparing waveform...</div>
        {:else if waveformStatus === 'unavailable'}
          <div class="absolute inset-0 flex items-center justify-center text-app-xs text-text-disabled">Waveform unavailable · timeline editing still works</div>
        {/if}
        <canvas class="absolute top-0 h-[76px] text-text-tertiary" bind:this={waveformCanvas}></canvas>
      </div>

      <div class="relative flex min-h-[104px] flex-col">
        {#each assets as asset (asset.id)}
          {@const laneClips = clipsForAsset(asset.id)}
          <div class="relative min-h-[72px] border-b border-border-subtle bg-surface-base" onpointerdown={(event) => handleLanePointerDown(event, asset.id)} role="region" aria-label={`Cuts for ${asset.file_path.split(/[/\\]/).pop() || `source ${asset.id}`}`}>
            <div class="sticky left-0 z-10 flex h-6 w-fit max-w-48 items-center gap-2 rounded-br-md border-r border-b border-border-subtle bg-surface-raised/95 px-2 text-app-xs text-text-tertiary">
              <span class="h-1.5 w-1.5 rounded-full" class:bg-accent-primary={asset.id === primaryAsset?.id} class:bg-text-disabled={asset.id !== primaryAsset?.id}></span>
              <span class="truncate">{asset.file_path.split(/[/\\]/).pop() || `Source ${asset.id}`}</span>
            </div>

            {#each laneClips as clip (clip.id)}
              {@const visual = drag?.clipId === clip.id && dragPreview ? dragPreview : { start: localTime(clip.in_point), end: localTime(clip.out_point) }}
              {@const role = clip.role || 'unassigned'}
              {@const roleConfig = ROLE_CONFIG[role] || ROLE_CONFIG.unassigned}
              <div
                class="group/cut absolute top-7 h-9 cursor-grab overflow-visible rounded-md border border-white/20 shadow-[0_4px_12px_rgba(0,0,0,0.18)] active:cursor-grabbing"
                class:ring-2={timelineState.selectedClipIds.has(clip.id)}
                class:ring-accent-primary={timelineState.selectedClipIds.has(clip.id)}
                data-clip-id={clip.id}
                style={`left:${visual.start * timelineState.zoomLevel}px;width:${Math.max(3, (visual.end - visual.start) * timelineState.zoomLevel)}px;background:${roleConfig.subtleCssVar};border-color:${roleConfig.cssVar}`}
                title={`${clip.description || 'Untitled cut'} · ${formatTimecode(visual.start)}–${formatTimecode(visual.end)}`}
              >
                <div class="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-md bg-white/35 opacity-70 group-hover/cut:opacity-100" data-handle="start"></div>
                <span class="pointer-events-none block truncate px-3 py-2 text-app-xs font-medium text-text-primary">{clip.description || 'Untitled cut'}</span>
                <div class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-md bg-white/35 opacity-70 group-hover/cut:opacity-100" data-handle="end"></div>
              </div>
            {/each}

            {#each pendingSuggestions.filter((suggestion) => resolveSuggestionAssetId(suggestion) === asset.id) as suggestion (suggestion.id)}
              {@const conflict = suggestionHasConflict(suggestion)}
              <button
                type="button"
                class={cn(
                  'absolute top-7 z-[8] h-9 overflow-hidden rounded-md border-2 border-dashed px-2 text-left text-app-xs font-medium transition-[filter,opacity] hover:brightness-125',
                  conflict
                    ? 'border-accent-destructive bg-accent-destructive/10 text-accent-destructive'
                    : 'border-accent-warning bg-accent-warning-subtle text-accent-warning'
                )}
                class:ring-2={agentState.selectedSuggestionId === suggestion.id}
                class:ring-accent-primary={agentState.selectedSuggestionId === suggestion.id}
                data-suggestion-id={suggestion.id}
                style={`left:${suggestion.in_point * timelineState.zoomLevel}px;width:${Math.max(3, (suggestion.out_point - suggestion.in_point) * timelineState.zoomLevel)}px`}
                title={conflict ? `Conflict: ${suggestion.description || 'Suggested cut'}` : suggestion.description || 'Suggested cut'}
              >
                <span class="block truncate">{conflict ? 'Conflict · ' : 'Suggested · '}{suggestion.description || 'Untitled'}</span>
              </button>
            {/each}

            {#if drag?.mode === 'create' && drag.assetId === asset.id && dragPreview}
              <div class="pointer-events-none absolute top-7 z-[9] h-9 rounded-md border-2 border-dashed border-accent-primary bg-accent-primary-subtle" style={`left:${Math.min(dragPreview.start, dragPreview.end) * timelineState.zoomLevel}px;width:${Math.max(3, Math.abs(dragPreview.end - dragPreview.start) * timelineState.zoomLevel)}px`}>
                <span class="absolute -top-6 left-0 whitespace-nowrap rounded-sm bg-surface-elevated px-1.5 py-0.5 font-mono text-[10px] text-text-primary">{formatTimecode(Math.min(dragPreview.start, dragPreview.end))} · {formatTimecode(Math.abs(dragPreview.end - dragPreview.start))}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="pointer-events-none absolute inset-y-0 z-[15] w-px bg-accent-destructive" style={`left:${localTime(timelineState.playheadTime) * timelineState.zoomLevel}px`}>
        <div class="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent-destructive"></div>
      </div>
    </div>
  </div>

  <div class="shrink-0 border-t border-border-default bg-surface-raised px-3 py-2">
    <div class="relative h-7 cursor-pointer overflow-hidden rounded-md border border-border-default bg-surface-page" bind:this={overviewRef} onpointerdown={handleOverviewPointerDown} role="slider" tabindex="0" aria-label="Timeline overview" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={timelineState.scrollPosition}>
      {#each clips as clip (clip.id)}
        <div class="absolute top-1.5 h-4 rounded-sm bg-accent-primary/45" style={`left:${localTime(clip.in_point) / duration * 100}%;width:${Math.max(0.2, (localTime(clip.out_point) - localTime(clip.in_point)) / duration * 100)}%`}></div>
      {/each}
      {#each pendingSuggestions as suggestion (suggestion.id)}
        <div class="absolute top-1.5 h-4 rounded-sm border border-dashed border-accent-warning bg-accent-warning-subtle" style={`left:${suggestion.in_point / duration * 100}%;width:${Math.max(0.2, (suggestion.out_point - suggestion.in_point) / duration * 100)}%`}></div>
      {/each}
      <div class="absolute inset-y-0 rounded-sm border-2 border-accent-primary bg-accent-primary/10" style={`left:${overviewWindowLeft}%;width:${overviewWindowWidth}%`}></div>
      <div class="absolute inset-y-0 w-px bg-accent-destructive" style={`left:${localTime(timelineState.playheadTime) / duration * 100}%`}></div>
    </div>
  </div>
</section>
