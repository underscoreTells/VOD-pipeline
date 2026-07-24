<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import type { VodCutRange } from '$shared/types/database';
  import type { WaveformBlock } from '$shared/contracts/electron-api';
  import {
    COARSE_WAVEFORM_PIXELS_PER_SECOND,
    getWaveformBlockKey,
    getWaveformResolutionForZoom,
    WAVEFORM_BLOCK_DURATION_SECONDS,
  } from '$shared/utils/waveform-blocks';
  import {
    addVodCutRange,
    clearVodCutPendingRange,
    deleteVodCutRange,
    selectVodCutRange,
    setVodCutPendingRange,
    setVodCutPlayhead,
    setVodCutView,
    updateVodCutRange,
    vodCutState,
  } from '../../state/vod-cut.svelte.js';
  import {
    calculateZoomAroundPointer,
    clampNumber,
    getAdaptiveRulerStep,
    pointerToVodTime,
  } from '../../utils/vod-cut-timeline.js';
  import { formatTime, formatTimecode as formatFpsTimecode } from '../../utils/time.js';
  import { settingsState } from '../../state/settings.svelte.js';
  import { getArrowNavigationDelta } from '../../utils/transport-shortcuts.js';
  import {
    countWaveformBlocksAtResolution,
    getWaveformPeakForTimeRange,
    loadProgressiveWaveformRange,
  } from '../../utils/progressive-waveform.js';

  interface Props {
    assetId: number;
    disabled?: boolean;
    onSeekPreview?: (time: number, commit: boolean) => void;
  }

  let { assetId, disabled = false, onSeekPreview }: Props = $props();

  let viewportRef = $state<HTMLDivElement | null>(null);
  let overviewRef = $state<HTMLDivElement | null>(null);
  let waveformCanvas = $state<HTMLCanvasElement | null>(null);
  let viewportWidth = $state(0);
  const waveformBlocks = new SvelteMap<string, WaveformBlock>();
  let waveformStatus = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let resizeObserver: ResizeObserver | null = null;
  let visibleWaveformController: AbortController | null = null;
  let backgroundWaveformController: AbortController | null = null;
  let waveformRequestTimer: number | null = null;
  let drag = $state<{
    mode: 'scrub' | 'create' | 'resize' | 'overview';
    pointerId: number;
    rangeId?: string;
    edge?: 'start' | 'end';
    anchorTime?: number;
    originalStart?: number;
    originalEnd?: number;
  } | null>(null);
  let dragPreview = $state<{ id: string; start: number; end: number } | null>(null);
  let suppressRangeClickId: string | null = null;

  const MIN_PPS = $derived(viewportWidth > 0 && vodCutState.duration > 0
    ? viewportWidth / vodCutState.duration
    : 0.05);
  const BASE_MAX_PPS = 400;
  const maxPps = $derived(Math.max(BASE_MAX_PPS, MIN_PPS));
  const contentWidth = $derived(Math.max(viewportWidth, vodCutState.duration * vodCutState.pixelsPerSecond));
  const visibleDuration = $derived(viewportWidth / Math.max(0.001, vodCutState.pixelsPerSecond));
  const overviewWindowLeft = $derived(contentWidth > 0 ? (vodCutState.scrollLeft / contentWidth) * 100 : 0);
  const overviewWindowWidth = $derived(contentWidth > 0
    ? Math.min(100, (viewportWidth / contentWidth) * 100)
    : 100);
  const pendingStart = $derived(vodCutState.pendingIn === null || vodCutState.pendingOut === null
    ? null
    : Math.min(vodCutState.pendingIn, vodCutState.pendingOut));
  const pendingEnd = $derived(vodCutState.pendingIn === null || vodCutState.pendingOut === null
    ? null
    : Math.max(vodCutState.pendingIn, vodCutState.pendingOut));
  const rulerTicks = $derived.by(() => {
    if (viewportWidth <= 0 || vodCutState.duration <= 0) return [] as number[];
    const step = getAdaptiveRulerStep(vodCutState.pixelsPerSecond);
    const visibleStart = vodCutState.scrollLeft / vodCutState.pixelsPerSecond;
    const visibleEnd = Math.min(vodCutState.duration, visibleStart + visibleDuration);
    const first = Math.floor(visibleStart / step) * step;
    const ticks: number[] = [];
    for (let time = first; time <= visibleEnd + step && ticks.length < 200; time += step) {
      if (time >= 0) ticks.push(time);
    }
    return ticks;
  });
  const waveformBlockCount = $derived(Math.ceil(vodCutState.duration / WAVEFORM_BLOCK_DURATION_SECONDS));

  function formatTimecode(seconds: number): string {
    return formatFpsTimecode(clampNumber(seconds, 0, vodCutState.duration), vodCutState.fps);
  }

  function getPointerTime(event: PointerEvent): number {
    if (!viewportRef) return 0;
    const rect = viewportRef.getBoundingClientRect();
    return pointerToVodTime({
      clientX: event.clientX,
      viewportLeft: rect.left,
      scrollLeft: viewportRef.scrollLeft,
      pixelsPerSecond: vodCutState.pixelsPerSecond,
      duration: vodCutState.duration,
    });
  }

  function beginWindowDrag(next: NonNullable<typeof drag>): void {
    drag = next;
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);
  }

  function endWindowDrag(): void {
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerEnd);
    window.removeEventListener('pointercancel', handleWindowPointerEnd);
    drag = null;
    dragPreview = null;
  }

  function scrubTo(time: number, commit = false): void {
    setVodCutPlayhead(time);
    onSeekPreview?.(vodCutState.playheadTime, commit);
  }

  function handleScrubPointerDown(event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const time = getPointerTime(event);
    scrubTo(time);
    beginWindowDrag({ mode: 'scrub', pointerId: event.pointerId });
  }

  function handleRangeLanePointerDown(event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-range-id]')) return;
    event.preventDefault();
    const time = getPointerTime(event);
    selectVodCutRange(null);
    setVodCutPendingRange(time, time);
    beginWindowDrag({ mode: 'create', pointerId: event.pointerId, anchorTime: time });
  }

  function handleResizePointerDown(event: PointerEvent, range: VodCutRange, edge: 'start' | 'end'): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectVodCutRange(range.id);
    dragPreview = { id: range.id, start: range.start_time, end: range.end_time };
    beginWindowDrag({
      mode: 'resize',
      pointerId: event.pointerId,
      rangeId: range.id,
      edge,
      originalStart: range.start_time,
      originalEnd: range.end_time,
    });
  }

  function overviewTime(event: PointerEvent): number {
    if (!overviewRef) return 0;
    const rect = overviewRef.getBoundingClientRect();
    return clampNumber((event.clientX - rect.left) / rect.width, 0, 1) * vodCutState.duration;
  }

  function panOverviewTo(time: number): void {
    if (!viewportRef) return;
    const nextScroll = clampNumber(
      time * vodCutState.pixelsPerSecond - viewportWidth / 2,
      0,
      Math.max(0, contentWidth - viewportWidth),
    );
    viewportRef.scrollLeft = nextScroll;
    setVodCutView(vodCutState.pixelsPerSecond, nextScroll);
  }

  function handleOverviewPointerDown(event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    panOverviewTo(overviewTime(event));
    beginWindowDrag({ mode: 'overview', pointerId: event.pointerId });
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'scrub') {
      scrubTo(getPointerTime(event));
      return;
    }
    if (drag.mode === 'create') {
      setVodCutPendingRange(drag.anchorTime ?? 0, getPointerTime(event));
      return;
    }
    if (drag.mode === 'overview') {
      panOverviewTo(overviewTime(event));
      return;
    }
    if (drag.mode === 'resize' && drag.rangeId && drag.edge) {
      const pointerTime = getPointerTime(event);
      const ordered = vodCutState.ranges;
      const rangeIndex = ordered.findIndex((range) => range.id === drag.rangeId);
      const previousEnd = rangeIndex > 0 ? ordered[rangeIndex - 1].end_time : 0;
      const nextStart = rangeIndex >= 0 && rangeIndex < ordered.length - 1
        ? ordered[rangeIndex + 1].start_time
        : vodCutState.duration;
      const minimumDuration = 1 / Math.max(1, vodCutState.fps);
      dragPreview = {
        id: drag.rangeId,
        start: drag.edge === 'start'
          ? clampNumber(pointerTime, previousEnd, (drag.originalEnd ?? 0) - minimumDuration)
          : (drag.originalStart ?? 0),
        end: drag.edge === 'end'
          ? clampNumber(pointerTime, (drag.originalStart ?? 0) + minimumDuration, nextStart)
          : (drag.originalEnd ?? 0),
      };
    }
  }

  function handleWindowPointerEnd(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'scrub') {
      scrubTo(getPointerTime(event), true);
    } else if (drag.mode === 'create') {
      setVodCutPendingRange(drag.anchorTime ?? 0, getPointerTime(event));
      addVodCutRange();
    } else if (drag.mode === 'resize' && dragPreview) {
      suppressRangeClickId = dragPreview.id;
      window.setTimeout(() => {
        suppressRangeClickId = null;
      }, 0);
      updateVodCutRange(dragPreview.id, {
        start_time: Math.min(dragPreview.start, dragPreview.end),
        end_time: Math.max(dragPreview.start, dragPreview.end),
      });
    }
    endWindowDrag();
  }

  function rangeVisual(range: VodCutRange): { start: number; end: number } {
    if (dragPreview?.id === range.id) {
      return {
        start: Math.min(dragPreview.start, dragPreview.end),
        end: Math.max(dragPreview.start, dragPreview.end),
      };
    }
    return { start: range.start_time, end: range.end_time };
  }

  function handleRangeClick(range: VodCutRange): void {
    if (suppressRangeClickId === range.id) return;
    selectVodCutRange(range.id);
    scrubTo(range.start_time, true);
  }

  function handleRangeKeydown(event: KeyboardEvent, range: VodCutRange): void {
    if (event.key === 'Enter' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      handleRangeClick(range);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      deleteVodCutRange(range.id);
    }
  }

  function handleResizeKeydown(event: KeyboardEvent, range: VodCutRange, edge: 'start' | 'end'): void {
    const delta = getArrowNavigationDelta({
      key: event.key,
      shiftKey: event.shiftKey,
      fps: vodCutState.fps,
      coarseJumpSeconds: settingsState.settings.coarseJumpSeconds,
    });
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    updateVodCutRange(range.id, edge === 'start'
      ? { start_time: range.start_time + delta }
      : { end_time: range.end_time + delta });
  }

  function handleScroll(): void {
    if (!viewportRef) return;
    setVodCutView(vodCutState.pixelsPerSecond, viewportRef.scrollLeft);
    drawWaveform();
    scheduleVisibleWaveformRequest();
  }

  function setZoom(nextPixelsPerSecond: number, pointerX?: number): void {
    if (!viewportRef) return;
    const rect = viewportRef.getBoundingClientRect();
    const nextPps = clampNumber(nextPixelsPerSecond, MIN_PPS, maxPps);
    const nextScroll = calculateZoomAroundPointer({
      pointerX: pointerX ?? rect.left + rect.width / 2,
      viewportLeft: rect.left,
      currentScrollLeft: viewportRef.scrollLeft,
      currentPixelsPerSecond: vodCutState.pixelsPerSecond,
      nextPixelsPerSecond: nextPps,
      duration: vodCutState.duration,
      viewportWidth: rect.width,
    });
    setVodCutView(nextPps, nextScroll);
    requestAnimationFrame(() => {
      if (!viewportRef) return;
      viewportRef.scrollLeft = nextScroll;
      drawWaveform();
      scheduleVisibleWaveformRequest();
    });
  }

  function handleWheel(event: WheelEvent): void {
    if (!viewportRef) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      setZoom(vodCutState.pixelsPerSecond * (event.deltaY > 0 ? 0.88 : 1.14), event.clientX);
      return;
    }
    viewportRef.scrollLeft += event.deltaX || event.deltaY;
  }

  function fitTimeline(): void {
    if (!viewportRef || vodCutState.duration <= 0) return;
    const fit = viewportRef.clientWidth / vodCutState.duration;
    setVodCutView(fit, 0);
    viewportRef.scrollLeft = 0;
    requestAnimationFrame(drawWaveform);
    scheduleVisibleWaveformRequest();
  }

  function handlePlayheadKeydown(event: KeyboardEvent): void {
    let next: number | null = null;
    const delta = getArrowNavigationDelta({
      key: event.key,
      shiftKey: event.shiftKey,
      fps: vodCutState.fps,
      coarseJumpSeconds: settingsState.settings.coarseJumpSeconds,
    });
    if (delta !== null) next = vodCutState.playheadTime + delta;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = vodCutState.duration;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    scrubTo(next, true);
  }

  function drawWaveform(): void {
    if (!waveformCanvas || !viewportRef) return;
    const width = Math.max(1, viewportRef.clientWidth);
    const height = 88;
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
    context.globalAlpha = 0.7;
    context.beginPath();
    const visibleStart = viewportRef.scrollLeft / vodCutState.pixelsPerSecond;
    for (let x = 0; x < width; x += 1) {
      const time = visibleStart + x / vodCutState.pixelsPerSecond;
      const peak = getWaveformPeakForTimeRange(
        waveformBlocks,
        time,
        Math.min(vodCutState.duration, time + (1 / vodCutState.pixelsPerSecond)),
        vodCutState.pixelsPerSecond
      );
      if (!peak) continue;
      const center = height / 2;
      context.moveTo(x + 0.5, center + peak.min * center);
      context.lineTo(x + 0.5, center + peak.max * center);
    }
    context.stroke();
  }

  function installWaveformBlock(block: WaveformBlock): void {
    const key = getWaveformBlockKey(block.index, block.pixelsPerSecond);
    if (waveformBlocks.has(key)) return;
    waveformBlocks.set(key, block);
    waveformStatus = 'ready';
    requestAnimationFrame(drawWaveform);
  }

  function scheduleVisibleWaveformRequest(delay = 100): void {
    if (waveformRequestTimer !== null) window.clearTimeout(waveformRequestTimer);
    waveformRequestTimer = window.setTimeout(() => {
      waveformRequestTimer = null;
      void loadVisibleWaveform();
    }, delay);
  }

  async function loadVisibleWaveform(): Promise<void> {
    if (!viewportRef || vodCutState.duration <= 0) return;
    visibleWaveformController?.abort();
    const controller = new AbortController();
    visibleWaveformController = controller;
    const visibleStart = viewportRef.scrollLeft / vodCutState.pixelsPerSecond;
    const visibleEnd = Math.min(vodCutState.duration, visibleStart + visibleDuration);
    const coarseResult = await loadProgressiveWaveformRange({
      assetId,
      trackIndex: -1,
      startTime: visibleStart,
      endTime: visibleEnd,
      sourceDuration: vodCutState.duration,
      pixelsPerSecond: COARSE_WAVEFORM_PIXELS_PER_SECOND,
      requestMode: 'interactive',
      loadedBlockKeys: new Set(waveformBlocks.keys()),
      signal: controller.signal,
      onBlock: installWaveformBlock,
    });
    if (controller.signal.aborted) return;
    if (waveformBlocks.size === 0 && coarseResult.failed > 0) waveformStatus = 'unavailable';
    startBackgroundWaveformLoad();

    const targetResolution = getWaveformResolutionForZoom(vodCutState.pixelsPerSecond);
    if (targetResolution === COARSE_WAVEFORM_PIXELS_PER_SECOND) return;
    const overscan = WAVEFORM_BLOCK_DURATION_SECONDS;
    await loadProgressiveWaveformRange({
      assetId,
      trackIndex: -1,
      startTime: Math.max(0, visibleStart - overscan),
      endTime: Math.min(vodCutState.duration, visibleEnd + overscan),
      sourceDuration: vodCutState.duration,
      pixelsPerSecond: targetResolution,
      requestMode: 'interactive',
      loadedBlockKeys: new Set(waveformBlocks.keys()),
      signal: controller.signal,
      onBlock: installWaveformBlock,
    });
  }

  function startBackgroundWaveformLoad(): void {
    if (backgroundWaveformController || vodCutState.duration <= 0) return;
    const controller = new AbortController();
    backgroundWaveformController = controller;
    void loadProgressiveWaveformRange({
      assetId,
      trackIndex: -1,
      startTime: 0,
      endTime: vodCutState.duration,
      sourceDuration: vodCutState.duration,
      pixelsPerSecond: COARSE_WAVEFORM_PIXELS_PER_SECOND,
      requestMode: 'background',
      loadedBlockKeys: new Set(waveformBlocks.keys()),
      signal: controller.signal,
      onBlock: installWaveformBlock,
    });
  }

  onMount(() => {
    if (viewportRef) {
      resizeObserver = new ResizeObserver(() => {
        if (!viewportRef) return;
        viewportWidth = viewportRef.clientWidth;
        if (vodCutState.pixelsPerSecond < MIN_PPS) fitTimeline();
        drawWaveform();
        scheduleVisibleWaveformRequest();
      });
      resizeObserver.observe(viewportRef);
      viewportWidth = viewportRef.clientWidth;
      const initialPps = Math.max(viewportWidth / Math.max(1, vodCutState.duration), 8);
      const restoredPps = vodCutState.hasPersistedView
        ? clampNumber(vodCutState.pixelsPerSecond, MIN_PPS, maxPps)
        : initialPps;
      const restoredScroll = vodCutState.hasPersistedView
        ? clampNumber(vodCutState.scrollLeft, 0, Math.max(0, vodCutState.duration * restoredPps - viewportWidth))
        : 0;
      setVodCutView(restoredPps, restoredScroll);
      viewportRef.scrollLeft = restoredScroll;
    }
    scheduleVisibleWaveformRequest(0);

    return () => {
      resizeObserver?.disconnect();
      visibleWaveformController?.abort();
      backgroundWaveformController?.abort();
      if (waveformRequestTimer !== null) window.clearTimeout(waveformRequestTimer);
      endWindowDrag();
    };
  });
</script>

<section class="flex min-h-0 flex-col rounded-lg border border-border-default bg-surface-base" aria-label="VOD cutting timeline">
  <div class="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-border-default px-3 py-2">
    <div class="flex items-center gap-3">
      <span class="font-mono text-app-base tabular-nums text-text-primary">{formatTimecode(vodCutState.playheadTime)}</span>
      <span class="text-app-xs text-text-tertiary">{formatTime(vodCutState.playheadTime)} / {formatTime(vodCutState.duration)}</span>
      <span class="text-app-xs text-text-disabled">{waveformStatus === 'loading' ? 'Loading visible waveform...' : waveformStatus === 'unavailable' ? 'Waveform unavailable' : `Waveform ${countWaveformBlocksAtResolution(waveformBlocks, COARSE_WAVEFORM_PIXELS_PER_SECOND)}/${waveformBlockCount}`}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <button class="h-7 rounded-sm border border-border-default px-2 text-app-sm text-text-secondary hover:bg-surface-hover" onclick={() => setZoom(vodCutState.pixelsPerSecond / 1.25)} aria-label="Zoom out">-</button>
      <input
        class="ui-range-thumb-sm h-1.5 w-28 appearance-none rounded-full bg-border-default"
        type="range"
        min={Math.log(Math.max(0.001, MIN_PPS))}
        max={Math.log(maxPps)}
        step="0.01"
        value={Math.log(Math.max(MIN_PPS, vodCutState.pixelsPerSecond))}
        oninput={(event) => setZoom(Math.exp(Number(event.currentTarget.value)))}
        aria-label="Timeline zoom"
      />
      <button class="h-7 rounded-sm border border-border-default px-2 text-app-sm text-text-secondary hover:bg-surface-hover" onclick={() => setZoom(vodCutState.pixelsPerSecond * 1.25)} aria-label="Zoom in">+</button>
      <button class="h-7 rounded-sm border border-border-default px-2 text-app-xs font-medium text-text-secondary hover:bg-surface-hover" onclick={fitTimeline}>Fit</button>
    </div>
  </div>

  <div
    class="scrollbar-thin relative min-h-[174px] overflow-x-auto overflow-y-hidden overscroll-contain"
    bind:this={viewportRef}
    onscroll={handleScroll}
    onwheel={handleWheel}
  >
    <div class="relative h-[174px]" style={`width: ${contentWidth}px;`}>
      <div
        class="absolute inset-x-0 top-0 h-8 border-b border-border-subtle bg-surface-raised"
        onpointerdown={handleScrubPointerDown}
        onkeydown={handlePlayheadKeydown}
        role="slider"
        tabindex="0"
        aria-label="VOD time ruler"
        aria-valuemin={0}
        aria-valuemax={vodCutState.duration}
        aria-valuenow={vodCutState.playheadTime}
      >
        {#each rulerTicks as tick (tick)}
          <div class="pointer-events-none absolute inset-y-0 border-l border-border-default" style={`left: ${tick * vodCutState.pixelsPerSecond}px;`}>
            <span class="absolute left-1 top-1 whitespace-nowrap font-mono text-app-2xs tabular-nums text-text-disabled">{formatTime(tick)}</span>
          </div>
        {/each}
      </div>

      <div
        class="absolute inset-x-0 top-8 h-[88px] cursor-ew-resize bg-[linear-gradient(to_bottom,var(--surface-base),var(--surface-raised))]"
        onpointerdown={handleScrubPointerDown}
        onkeydown={handlePlayheadKeydown}
        role="slider"
        tabindex="0"
        aria-label="VOD waveform scrubber"
        aria-valuemin={0}
        aria-valuemax={vodCutState.duration}
        aria-valuenow={vodCutState.playheadTime}
      >
        <canvas bind:this={waveformCanvas} class="pointer-events-none absolute top-0 text-text-tertiary"></canvas>
      </div>

      <div
        class="absolute inset-x-0 bottom-0 h-[58px] cursor-crosshair border-t border-border-default bg-surface-page"
        onpointerdown={handleRangeLanePointerDown}
        onkeydown={(event) => {
          if (event.key === 'Enter') addVodCutRange();
          if (event.key === 'Escape') clearVodCutPendingRange();
        }}
        role="button"
        tabindex="0"
        aria-label="Drag here to create a chapter range"
      >
        {#if pendingStart !== null && pendingEnd !== null}
          <div
            class="pointer-events-none absolute inset-y-2 rounded-sm border border-dashed border-accent-primary bg-accent-primary-subtle"
            style={`left: ${pendingStart * vodCutState.pixelsPerSecond}px; width: ${Math.max(2, (pendingEnd - pendingStart) * vodCutState.pixelsPerSecond)}px;`}
          ></div>
        {/if}
        {#each vodCutState.ranges as range, index (range.id)}
          {@const visual = rangeVisual(range)}
          <div
            class="group absolute inset-y-2 overflow-visible rounded-sm border text-left transition-colors"
            class:border-accent-primary={vodCutState.selectedRangeId === range.id}
            class:bg-accent-primary-subtle={vodCutState.selectedRangeId === range.id}
            class:border-border-strong={vodCutState.selectedRangeId !== range.id}
            class:bg-surface-active={vodCutState.selectedRangeId !== range.id}
            style={`left: ${visual.start * vodCutState.pixelsPerSecond}px; width: ${Math.max(2, (visual.end - visual.start) * vodCutState.pixelsPerSecond)}px;`}
            data-range-id={range.id}
            role="button"
            tabindex="0"
            onclick={() => handleRangeClick(range)}
            onkeydown={(event) => handleRangeKeydown(event, range)}
            title={`${range.title}: ${formatTime(range.start_time)} - ${formatTime(range.end_time)}`}
          >
            <span class="pointer-events-none block truncate px-2 text-app-xs font-medium text-text-primary">{index + 1}. {range.title}</span>
            <button
              type="button"
              class="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize rounded-l-sm bg-accent-primary opacity-0 transition-opacity group-hover:opacity-80"
              class:opacity-80={vodCutState.selectedRangeId === range.id}
              role="slider"
              aria-label={`Trim start of ${range.title}`}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={range.end_time}
              aria-valuenow={range.start_time}
              onpointerdown={(event) => handleResizePointerDown(event, range, 'start')}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => handleResizeKeydown(event, range, 'start')}
            ></button>
            <button
              type="button"
              class="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize rounded-r-sm bg-accent-primary opacity-0 transition-opacity group-hover:opacity-80"
              class:opacity-80={vodCutState.selectedRangeId === range.id}
              role="slider"
              aria-label={`Trim end of ${range.title}`}
              aria-orientation="horizontal"
              aria-valuemin={range.start_time}
              aria-valuemax={vodCutState.duration}
              aria-valuenow={range.end_time}
              onpointerdown={(event) => handleResizePointerDown(event, range, 'end')}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => handleResizeKeydown(event, range, 'end')}
            ></button>
          </div>
        {/each}
      </div>

      <button
        class="group absolute top-0 bottom-[58px] z-[var(--z-panel)] w-4 -translate-x-1/2 cursor-ew-resize bg-transparent p-0"
        style={`left: ${vodCutState.playheadTime * vodCutState.pixelsPerSecond}px;`}
        onpointerdown={handleScrubPointerDown}
        onkeydown={handlePlayheadKeydown}
        role="slider"
        aria-label="VOD playhead"
        aria-valuemin={0}
        aria-valuemax={vodCutState.duration}
        aria-valuenow={vodCutState.playheadTime}
        aria-valuetext={formatTimecode(vodCutState.playheadTime)}
      >
        <span class="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-sm bg-accent-primary shadow-sm"></span>
        <span class="absolute left-1/2 top-2 bottom-0 w-px -translate-x-1/2 bg-accent-primary"></span>
      </button>
    </div>
  </div>

  <div
    class="relative mx-3 my-2 h-7 cursor-ew-resize overflow-hidden rounded-sm border border-border-default bg-surface-raised"
    bind:this={overviewRef}
    onpointerdown={handleOverviewPointerDown}
    onkeydown={handlePlayheadKeydown}
    role="slider"
    tabindex="0"
    aria-label="Full VOD overview"
    aria-valuemin={0}
    aria-valuemax={vodCutState.duration}
    aria-valuenow={vodCutState.playheadTime}
  >
    {#each vodCutState.ranges as range (range.id)}
      <div
        class="pointer-events-none absolute inset-y-1 rounded-xs bg-accent-primary/35"
        style={`left: ${(range.start_time / vodCutState.duration) * 100}%; width: ${((range.end_time - range.start_time) / vodCutState.duration) * 100}%;`}
      ></div>
    {/each}
    <div
      class="pointer-events-none absolute inset-y-0 rounded-sm border border-accent-primary bg-accent-primary/10"
      style={`left: ${overviewWindowLeft}%; width: ${overviewWindowWidth}%;`}
    ></div>
    <div class="pointer-events-none absolute inset-y-0 w-px bg-accent-primary" style={`left: ${(vodCutState.playheadTime / vodCutState.duration) * 100}%;`}></div>
  </div>
  <p class="px-3 pb-2 text-app-xs text-text-disabled">Drag the waveform to scrub. Drag an empty section of the chapter lane to keep a range. Use the overview to move across the full VOD.</p>
</section>
