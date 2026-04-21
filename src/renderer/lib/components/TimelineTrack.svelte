<script lang="ts">
  import { onMount } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
  import type { Clip } from '../../../shared/types/database';
  import { getWaveform, onWaveformProgress } from '../api/waveforms.js';
  import { timelineState, selectClip, setPlayhead, setScroll } from '../state/timeline.svelte';
  import {
    createProjectClip,
    executeDeleteClip,
    executeMoveClip,
    executeResizeClip,
    executeSplitClip,
    executeUpdateClipTiming,
    projectDetail,
  } from '../state/project-detail.svelte';
  import { chaptersState } from '../state/chapters.svelte';
  import {
    clampMoveStartWithCollision,
    type ClipCollisionInterval,
    type CollisionDragDirection,
  } from '../utils/clip-collision';
  import { buildClipTimes, normalizeSelection } from '../utils/clip-selection';
  import { buildDefaultClipRangeAtCursor, splitClipAtTimelineTime } from '../utils/timeline-edit';
  import { ROLE_CONFIG } from '../constants';
  
  interface Props {
    audioUrl: string;
    missing?: boolean;
    assetId: number | null;
    laneLabel: string;
    editable?: boolean;
    clipTrackIndex: number;
    waveformTrackIndex: number;
    createTrackIndex?: number;
    height?: number;
    clips?: Clip[];
  }
  
  let {
    audioUrl,
    missing = false,
    assetId,
    laneLabel,
    editable = true,
    clipTrackIndex,
    waveformTrackIndex,
    createTrackIndex = 0,
    height = 100,
    clips,
  }: Props = $props();
  
  let container: HTMLDivElement;
  let waveSurfer: WaveSurfer | null = null;
  let regionsPlugin: RegionsPlugin | null = null;
  let isReady = $state(false);
  let isScrolling = false; // Flag to prevent scroll loop
  let isDestroyed = false;
  let loadedAssetId: number | null = null;
  let hasLoadedPeaks = false;
  let waveformDuration = $state<number | null>(null);
  let loadToken = 0;
  let unsubscribeWaveformProgress: (() => void) | null = null;
  let scrollContainer: HTMLElement | null = null;
  let cleanupRenderListener: (() => void) | null = null;
  const clipRegions = new Map<number, any>();
  let contextMenu = $state({
    open: false,
    x: 0,
    y: 0,
    mode: 'clip' as 'clip' | 'track',
    clipId: null as number | null,
    cursorGlobalTime: null as number | null,
    canSplit: false,
  });

  const WAVEFORM_TIER_LEVEL = 1;
  
  const ROLE_COLORS: Record<string, string> = {
    'setup': ROLE_CONFIG.setup.subtleCssVar,
    'escalation': ROLE_CONFIG.escalation.subtleCssVar,
    'twist': ROLE_CONFIG.twist.subtleCssVar,
    'payoff': ROLE_CONFIG.payoff.subtleCssVar,
    'transition': ROLE_CONFIG.transition.subtleCssVar,
  };
  
  const DEFAULT_COLOR = ROLE_CONFIG.unassigned.subtleCssVar;
  const SELECTION_COLOR = 'var(--accent-primary-subtle)';
  
  // Get clips for this track
  const trackClips = $derived.by(() => {
    if (!editable) return [];
    const source = clips ?? timelineState.clips;
    const assetScopedClips = assetId !== null
      ? source.filter((clip) => clip.asset_id === assetId)
      : source;
    if (clipTrackIndex < 0) {
      return assetScopedClips;
    }
    return assetScopedClips.filter((clip) => clip.track_index === clipTrackIndex);
  });

  const assetDuration = $derived.by(() => {
    if (!assetId) return null;
    const asset = projectDetail.assets.find((item) => item.id === assetId) || null;
    return asset?.duration ?? null;
  });

  const selectedChapter = $derived.by(() => {
    if (!assetId) return null;
    const selectedId = chaptersState.selectedChapterId;
    if (!selectedId) return null;
    const chapter = chaptersState.chapters.find((item) => item.id === selectedId) || null;
    if (!chapter) return null;
    const chapterAssets = chaptersState.chapterAssets.get(chapter.id);
    if (!chapterAssets?.includes(assetId)) return null;
    return chapter;
  });

  const chapterRange = $derived.by(() => {
    const chapter = selectedChapter;
    if (!chapter) return null;
    const maxDuration =
      assetDuration && assetDuration > 0
        ? assetDuration
        : waveformDuration && waveformDuration > 0
          ? waveformDuration
          : null;
    const rawStart = Math.max(0, chapter.start_time);
    const rawEnd = Math.max(rawStart + 0.01, chapter.end_time);
    const start = maxDuration ? clamp(rawStart, 0, maxDuration) : rawStart;
    const end = maxDuration
      ? clamp(rawEnd, start + 0.01, maxDuration)
      : rawEnd;
    return { start, end, duration: Math.max(0.01, end - start) };
  });

  const MIN_SELECTION_SECONDS = 0.25;
  const MIN_CLIP_DURATION = 0.05;
  const DEFAULT_CONTEXT_CLIP_DURATION = 5;
  const MIN_RENDER_REGION_PX = 2;
  const RENDER_VISIBILITY_EPSILON = 0.001;
  const CLICK_DRAG_THRESHOLD = 4;
  const DRAG_DIRECTION_EPSILON = 0.0001;

  let isRenderingRegions = false;
  let isPanning = $state(false);
  let isSelecting = $state(false);
  let selectionStartTime = 0;
  let selectionCurrentTime = 0;
  let selectionStartPointerTime: number | null = null;
  let selectionEndPointerTime: number | null = null;
  let selectionRegion: any | null = null;
  let dragPointerId: number | null = null;
  let dragMode: 'pan' | 'select' | 'click' | 'move' | 'resize' | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragClickTime: number | null = null;
  let dragClickClipId: number | null = null;
  let dragMoveModifierActive = false;
  let dragClipId: number | null = null;
  let dragClipOffset = 0;
  let dragClipDuration = 0;
  let dragClipLocalStart = 0;
  let dragClipLocalEnd = 0;
  let dragLastLocalStart = 0;
  let dragLastLocalEnd = 0;
  let dragResizeEdge: 'start' | 'end' | null = null;
  let dragOriginalStart = 0;
  let dragOriginalIn = 0;
  let dragOriginalOut = 0;
  let dragDidMove = false;
  let panStartX = 0;
  let panStartScrollLeft = 0;
  let previousCursor = '';
  let previousSelect = '';
  let loadedChapterKey: string | null = null;
  
  function buildWaveSurferPeaks(peaks: Array<{ min: number; max: number }>): Float32Array {
    const values = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i += 1) {
      const peak = peaks[i];
      values[i] = Math.max(Math.abs(peak.min), Math.abs(peak.max));
    }
    return values;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function getPixelsPerSecond(): number {
    if (!scrollContainer || !waveSurfer) return timelineState.zoomLevel;
    const duration = chapterRange?.duration || waveSurfer.getDuration() || 0;
    if (!duration) return timelineState.zoomLevel;
    const totalWidth = scrollContainer.scrollWidth;
    if (!totalWidth) return timelineState.zoomLevel;
    return totalWidth / duration;
  }

  function updateScrollContainer() {
    if (!waveSurfer) return;
    const wrapper = waveSurfer.getWrapper();
    const nextScrollContainer = wrapper?.parentElement ?? null;
    if (scrollContainer === nextScrollContainer) return;
    if (scrollContainer) {
      scrollContainer.removeEventListener('pointerdown', handleWaveformPointerDown, true);
      scrollContainer.removeEventListener('contextmenu', handleWaveformContextMenu, true);
      scrollContainer.removeEventListener('scroll', handleScrollContainerScroll);
      scrollContainer.classList.remove('scrollbar-thin');
    }
    scrollContainer = nextScrollContainer;
    if (scrollContainer) {
      scrollContainer.classList.add('scrollbar-thin');
      scrollContainer.addEventListener('pointerdown', handleWaveformPointerDown, { capture: true });
      scrollContainer.addEventListener('contextmenu', handleWaveformContextMenu, { capture: true });
      scrollContainer.addEventListener('scroll', handleScrollContainerScroll, { passive: true });
    }
  }

  function handleScrollContainerScroll() {
    if (isScrolling) return;
    if (!scrollContainer) return;
    if (!chapterRange) return;
    const pixelsPerSecond = getPixelsPerSecond();
    const maxTime = chapterRange.duration;
    const scrollTime = clamp(scrollContainer.scrollLeft / pixelsPerSecond, 0, maxTime);
    isScrolling = true;
    setScroll(scrollTime);
    setTimeout(() => { isScrolling = false; }, 0);
  }

  function getPointerTime(event: PointerEvent | MouseEvent): number | null {
    if (!chapterRange) return null;
    if (!waveSurfer) return null;
    const wrapper = waveSurfer.getWrapper();
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return clamp(ratio * chapterRange.duration, 0, chapterRange.duration);
  }

  function toWaveSurferRegionTime(localTime: number): number {
    if (!chapterRange) return localTime;

    const chapterDuration = Math.max(0.01, chapterRange.duration);
    const clampedLocal = clamp(localTime, 0, chapterDuration);
    const progress = clampedLocal / chapterDuration;

    const rawDuration = waveSurfer?.getDuration() ?? 0;
    const waveSurferDuration =
      Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : chapterDuration;

    return clamp(progress * waveSurferDuration, 0, waveSurferDuration);
  }

  function getMinimumRenderableDurationSeconds(): number {
    const pixelsPerSecond = Math.max(0.001, timelineState.zoomLevel);
    return Math.max(0.01, MIN_RENDER_REGION_PX / pixelsPerSecond);
  }

  function normalizeRenderableLocalRange(localStart: number, localEnd: number): { start: number; end: number } | null {
    if (!chapterRange) return null;

    const chapterDuration = chapterRange.duration;
    if (localEnd <= -RENDER_VISIBILITY_EPSILON || localStart >= chapterDuration + RENDER_VISIBILITY_EPSILON) {
      return null;
    }

    let start = clamp(localStart, 0, chapterDuration);
    let end = clamp(localEnd, 0, chapterDuration);
    const minDuration = Math.min(chapterDuration, getMinimumRenderableDurationSeconds());

    if (end <= start) {
      end = clamp(start + minDuration, 0, chapterDuration);
      if (end <= start) {
        start = clamp(start - minDuration, 0, chapterDuration);
        end = clamp(start + minDuration, 0, chapterDuration);
      }
    }

    if (end - start < minDuration) {
      const center = (start + end) / 2;
      start = clamp(center - minDuration / 2, 0, Math.max(0, chapterDuration - minDuration));
      end = clamp(start + minDuration, start + 0.001, chapterDuration);
    }

    if (end <= start) {
      return null;
    }

    return { start, end };
  }

  function updateSelectionRegion(start: number, end: number) {
    if (!regionsPlugin) return;
    const rangeStart = Math.min(start, end);
    const rangeEnd = Math.max(start, end);
    const regionStart = toWaveSurferRegionTime(rangeStart);
    const regionEnd = toWaveSurferRegionTime(rangeEnd);

    if (!selectionRegion) {
      selectionRegion = regionsPlugin.addRegion({
        id: 'selection-temp',
        start: regionStart,
        end: regionEnd,
        color: SELECTION_COLOR,
        drag: false,
        resize: false,
      });
      return;
    }

    if (typeof selectionRegion.setOptions === 'function') {
      selectionRegion.setOptions({ start: regionStart, end: regionEnd });
      return;
    }

    if (typeof selectionRegion.update === 'function') {
      selectionRegion.update({ start: regionStart, end: regionEnd });
      return;
    }

    selectionRegion.remove?.();
    selectionRegion = regionsPlugin.addRegion({
      id: 'selection-temp',
      start: regionStart,
      end: regionEnd,
      color: SELECTION_COLOR,
      drag: false,
      resize: false,
    });
  }

  function clearSelectionRegion() {
    selectionRegion?.remove?.();
    selectionRegion = null;
  }

  function getClipByIdLocal(clipId: number): Clip | null {
    const source = clips ?? timelineState.clips;
    return source.find((clip) => clip.id === clipId) ?? null;
  }

  function getPointerTargets(event: PointerEvent | MouseEvent): { clipId: number | null; handle: 'start' | 'end' | null } {
    const path = event.composedPath();
    let clipId: number | null = null;
    let handle: 'start' | 'end' | null = null;

    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      if (!handle && node.dataset.handle) {
        handle = node.dataset.handle === 'start' ? 'start' : 'end';
      }
      if (clipId === null && node.dataset.clipId) {
        const parsed = Number(node.dataset.clipId);
        clipId = Number.isFinite(parsed) ? parsed : null;
      }
    }

    return { clipId, handle };
  }

  function closeContextMenu() {
    contextMenu.open = false;
    contextMenu.clipId = null;
    contextMenu.cursorGlobalTime = null;
    contextMenu.canSplit = false;
  }

  function canSplitClipAtGlobalTime(clip: Clip, splitTime: number): boolean {
    const split = splitClipAtTimelineTime({
      clipStartTime: clip.start_time,
      inPoint: clip.in_point,
      outPoint: clip.out_point,
      splitTime,
      minDuration: MIN_CLIP_DURATION,
    });
    return split !== null;
  }

  function openContextMenu(
    event: MouseEvent,
    options: {
      mode: 'clip' | 'track';
      clipId: number | null;
      cursorGlobalTime: number;
      canSplit?: boolean;
    }
  ) {
    const padding = 8;
    const menuWidth = 220;
    const menuHeight = options.mode === 'clip' ? 80 : 44;
    let x = event.clientX;
    let y = event.clientY;

    if (x + menuWidth > window.innerWidth - padding) {
      x = Math.max(padding, window.innerWidth - menuWidth - padding);
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = Math.max(padding, window.innerHeight - menuHeight - padding);
    }

    contextMenu.open = true;
    contextMenu.mode = options.mode;
    contextMenu.x = x;
    contextMenu.y = y;
    contextMenu.clipId = options.clipId;
    contextMenu.cursorGlobalTime = options.cursorGlobalTime;
    contextMenu.canSplit = options.mode === 'clip' ? Boolean(options.canSplit) : false;
  }

  function handleClipContextDelete() {
    if (contextMenu.clipId === null) return;
    const clipId = contextMenu.clipId;
    closeContextMenu();
    void executeDeleteClip(clipId);
  }

  function handleClipContextSplit() {
    if (contextMenu.clipId === null) return;
    if (contextMenu.cursorGlobalTime === null) return;
    if (!contextMenu.canSplit) return;

    const clipId = contextMenu.clipId;
    const splitTime = contextMenu.cursorGlobalTime;
    closeContextMenu();
    void executeSplitClip(clipId, splitTime);
  }

  async function createClipAtCursor(cursorGlobalTime: number) {
    if (!editable) return;
    if (!projectDetail.projectId || !assetId) return;
    if (!chapterRange) return;

    const intervals = trackClips
      .map((clip) => {
        const duration = clip.out_point - clip.in_point;
        if (!Number.isFinite(duration) || duration <= 0) return null;
        const start = clip.start_time - chapterRange.start;
        const end = start + duration;
        return { start, end };
      })
      .filter((interval): interval is { start: number; end: number } => interval !== null);

    const cursorLocalTime = clamp(cursorGlobalTime - chapterRange.start, 0, chapterRange.duration);
    const range = buildDefaultClipRangeAtCursor(
      cursorLocalTime,
      intervals,
      chapterRange.duration,
      DEFAULT_CONTEXT_CLIP_DURATION,
      MIN_CLIP_DURATION
    );

    if (!range) return;

    const globalStart = chapterRange.start + range.start;
    const globalIn = chapterRange.start + range.start;
    const globalOut = chapterRange.start + range.end;

    await createProjectClip(
      projectDetail.projectId,
      assetId,
      createTrackIndex,
      globalStart,
      globalIn,
      globalOut,
      undefined,
      undefined,
      true
    );
  }

  function handleTrackContextCreateClip() {
    if (contextMenu.cursorGlobalTime === null) return;
    const cursorTime = contextMenu.cursorGlobalTime;
    closeContextMenu();
    void createClipAtCursor(cursorTime);
  }

  function updateRegionVisual(clipId: number, localStart: number, localEnd: number) {
    const region = clipRegions.get(clipId);
    if (!region || !chapterRange) return;
    const normalized = normalizeRenderableLocalRange(localStart, localEnd);
    if (!normalized) return;
    const localRegionStart = normalized.start;
    const localRegionEnd = normalized.end;
    const regionStart = toWaveSurferRegionTime(localRegionStart);
    const regionEnd = toWaveSurferRegionTime(localRegionEnd);

    if (typeof region.setOptions === 'function') {
      region.setOptions({ start: regionStart, end: regionEnd });
    } else if (typeof region.update === 'function') {
      region.update({ start: regionStart, end: regionEnd });
    }

    if (region.element) {
      ensureClipHandles(region.element);
    }
  }

  function ensureClipHandles(element: HTMLElement) {
    const ensureHandle = (edge: 'start' | 'end') => {
      const existing = element.querySelector(`[data-handle="${edge}"]`);
      if (existing) return;

      const handle = document.createElement('div');
      handle.dataset.handle = edge;
      handle.style.position = 'absolute';
      handle.style.top = '0';
      handle.style.bottom = '0';
      handle.style.width = '6px';
      handle.style.background = 'rgba(255, 255, 255, 0.35)';
      handle.style.opacity = '0.7';
      handle.style.pointerEvents = 'auto';
      handle.style.cursor = 'ew-resize';
      handle.style.zIndex = '3';
      if (edge === 'start') {
        handle.style.left = '0';
      } else {
        handle.style.right = '0';
      }

      element.appendChild(handle);
    };

    element.style.position = 'absolute';
    element.style.pointerEvents = 'auto';
    ensureHandle('start');
    ensureHandle('end');
  }

  function beginDrag(event: PointerEvent, mode: typeof dragMode) {
    dragPointerId = event.pointerId;
    dragMode = mode;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragDidMove = false;
    previousCursor = document.body.style.cursor;
    previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    window.addEventListener('pointercancel', handleDragEnd);
  }

  function startPanDrag(event: PointerEvent) {
    if (!scrollContainer) return;
    if (!waveSurfer) return;
    beginDrag(event, 'pan');
    panStartX = event.clientX;
    panStartScrollLeft = scrollContainer.scrollLeft;
    isPanning = true;
    document.body.style.cursor = 'grabbing';
  }

  function startSelectionDrag(event: PointerEvent, startTime: number) {
    beginDrag(event, 'select');
    isSelecting = true;
    selectionStartTime = startTime;
    selectionCurrentTime = startTime;
    selectionStartPointerTime = startTime;
    selectionEndPointerTime = startTime;
    updateSelectionRegion(selectionStartTime, selectionCurrentTime);
    document.body.style.cursor = 'crosshair';
  }

  function startClickDrag(event: PointerEvent, clickTime: number, clipId: number | null) {
    beginDrag(event, 'click');
    dragClickTime = clickTime;
    dragClickClipId = clipId;
    dragMoveModifierActive = editable && clipId !== null && (event.ctrlKey || event.metaKey);
  }

  function getTrackCollisionIntervals(excludeClipId: number): ClipCollisionInterval[] {
    if (!chapterRange) return [];

    return trackClips
      .filter((clip) => clip.id !== excludeClipId)
      .map((clip) => {
        const duration = clip.out_point - clip.in_point;
        if (!Number.isFinite(duration) || duration <= 0) return null;
        const start = clip.start_time - chapterRange.start;
        const end = start + duration;
        return { start, end };
      })
      .filter((interval): interval is ClipCollisionInterval => interval !== null);
  }

  function getDragDirection(candidateStart: number): CollisionDragDirection {
    const delta = candidateStart - dragLastLocalStart;
    if (delta > DRAG_DIRECTION_EPSILON) return 'right';
    if (delta < -DRAG_DIRECTION_EPSILON) return 'left';
    return 'none';
  }

  function clampMoveStartForDrag(candidateStart: number): number {
    if (!chapterRange) return candidateStart;

    const chapterDuration = chapterRange.duration;
    const maxStart = Math.max(0, chapterDuration - dragClipDuration);
    const boundedCandidate = clamp(candidateStart, 0, maxStart);
    if (dragClipId === null) return boundedCandidate;

    return clampMoveStartWithCollision({
      candidateStart: boundedCandidate,
      duration: dragClipDuration,
      chapterDuration,
      currentStart: dragLastLocalStart,
      currentEnd: dragLastLocalEnd,
      direction: getDragDirection(boundedCandidate),
      otherIntervals: getTrackCollisionIntervals(dragClipId),
    });
  }

  function startResizeDrag(event: PointerEvent, clipId: number, edge: 'start' | 'end', pointerTime: number) {
    if (!editable) return;
    if (!chapterRange) return;
    const clip = getClipByIdLocal(clipId);
    if (!clip) return;
    const duration = clip.out_point - clip.in_point;
    if (!Number.isFinite(duration) || duration <= 0) return;

    beginDrag(event, 'resize');
    selectClip(clipId, false);
    dragClipId = clipId;
    dragResizeEdge = edge;
    dragClipDuration = duration;
    dragClipLocalStart = clip.start_time - chapterRange.start;
    dragClipLocalEnd = dragClipLocalStart + duration;
    dragLastLocalStart = dragClipLocalStart;
    dragLastLocalEnd = dragClipLocalEnd;
    dragOriginalStart = clip.start_time;
    dragOriginalIn = clip.in_point;
    dragOriginalOut = clip.out_point;
    dragClipOffset = clamp(pointerTime - dragClipLocalStart, 0, duration);
    document.body.style.cursor = 'ew-resize';
  }

  function handleDragMove(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) return;
    if (dragMode === 'click') {
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      if (Math.hypot(deltaX, deltaY) <= CLICK_DRAG_THRESHOLD) return;

      const pointerTime = getPointerTime(event);
      if (pointerTime === null) return;

      if (!dragMoveModifierActive) {
        dragDidMove = true;
        dragClickTime = pointerTime;
        if (!chapterRange) return;
        const globalTime = chapterRange.start + pointerTime;
        setPlayhead(globalTime);
        return;
      }

      dragDidMove = true;

      if (dragClickClipId === null) return;
      if (!chapterRange) return;

      const clip = getClipByIdLocal(dragClickClipId);
      if (!clip) return;

      const duration = clip.out_point - clip.in_point;
      if (!Number.isFinite(duration) || duration <= 0) return;

      dragMode = 'move';
      selectClip(dragClickClipId, false);
      dragClipId = dragClickClipId;
      dragClipDuration = duration;
      dragClipLocalStart = clip.start_time - chapterRange.start;
      dragClipLocalEnd = dragClipLocalStart + duration;
      dragClipOffset = clamp(pointerTime - dragClipLocalStart, 0, duration);
      dragLastLocalStart = dragClipLocalStart;
      dragLastLocalEnd = dragClipLocalEnd;
      dragOriginalStart = clip.start_time;
      dragOriginalIn = clip.in_point;
      dragOriginalOut = clip.out_point;
      dragClickTime = null;
      dragClickClipId = null;
      document.body.style.cursor = 'grabbing';

      const candidateStart = pointerTime - dragClipOffset;
      const nextStart = clampMoveStartForDrag(candidateStart);
      const nextEnd = nextStart + dragClipDuration;
      dragLastLocalStart = nextStart;
      dragLastLocalEnd = nextEnd;
      updateRegionVisual(dragClipId, nextStart, nextEnd);
      return;
    }

    if (dragMode === 'pan') {
      if (!scrollContainer) return;
      if (!waveSurfer) return;
      const delta = event.clientX - panStartX;
      const maxScroll = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
      const nextScroll = clamp(panStartScrollLeft - delta, 0, maxScroll);
      waveSurfer.setScroll(nextScroll);
      const maxTime = chapterRange ? chapterRange.duration : 0;
      const pixelsPerSecond = getPixelsPerSecond();
      const scrollTime = clamp(nextScroll / pixelsPerSecond, 0, maxTime);
      isScrolling = true;
      setScroll(scrollTime);
      setTimeout(() => { isScrolling = false; }, 0);
      return;
    }

    if (dragMode === 'select') {
      const currentTime = getPointerTime(event);
      if (currentTime === null) return;
      selectionCurrentTime = currentTime;
      selectionEndPointerTime = currentTime;
      updateSelectionRegion(selectionStartTime, selectionCurrentTime);
      return;
    }

    if (dragMode === 'move') {
      if (!chapterRange || dragClipId === null) return;
      const currentTime = getPointerTime(event);
      if (currentTime === null) return;
      const candidateStart = currentTime - dragClipOffset;
      const nextStart = clampMoveStartForDrag(candidateStart);
      const nextEnd = nextStart + dragClipDuration;
      dragLastLocalStart = nextStart;
      dragLastLocalEnd = nextEnd;
      updateRegionVisual(dragClipId, nextStart, nextEnd);
      return;
    }

    if (dragMode === 'resize') {
      if (!chapterRange || dragClipId === null || !dragResizeEdge) return;
      const currentTime = getPointerTime(event);
      if (currentTime === null) return;
      if (dragResizeEdge === 'start') {
        const maxStart = Math.max(0, dragClipLocalEnd - MIN_CLIP_DURATION);
        const nextStart = clamp(currentTime, 0, maxStart);
        dragLastLocalStart = nextStart;
        dragLastLocalEnd = dragClipLocalEnd;
      } else {
        const minEnd = Math.min(chapterRange.duration, dragClipLocalStart + MIN_CLIP_DURATION);
        const nextEnd = clamp(currentTime, minEnd, chapterRange.duration);
        dragLastLocalStart = dragClipLocalStart;
        dragLastLocalEnd = nextEnd;
      }
      updateRegionVisual(dragClipId, dragLastLocalStart, dragLastLocalEnd);
    }
  }

  function handleDragEnd(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) return;
    if (dragMode === 'select' && editable) {
      const start = selectionStartPointerTime ?? selectionStartTime;
      const end = getPointerTime(event) ?? selectionEndPointerTime ?? selectionCurrentTime;
      clearSelectionRegion();
      void createClipFromSelection(start, end);
    }

    if (dragMode === 'click' && !dragDidMove && chapterRange) {
      const pointerTime = dragClickTime ?? getPointerTime(event);
      if (pointerTime !== null) {
        const globalTime = chapterRange.start + pointerTime;
        setPlayhead(globalTime);
      }
      if (dragClickClipId !== null) {
        selectClip(dragClickClipId, false);
      }
    }

    if (dragMode === 'click' && dragDidMove && chapterRange) {
      const pointerTime = getPointerTime(event) ?? dragClickTime;
      if (pointerTime !== null) {
        const globalTime = chapterRange.start + pointerTime;
        setPlayhead(globalTime);
      }
    }

    if (dragMode === 'move' && chapterRange && dragClipId !== null) {
      const newStart = chapterRange.start + dragLastLocalStart;
      const EPSILON = 0.01;
      if (Math.abs(newStart - dragOriginalStart) > EPSILON) {
        void executeMoveClip(dragClipId, dragOriginalStart, newStart);
      }
    }

    if (dragMode === 'resize' && chapterRange && dragClipId !== null && dragResizeEdge) {
      const EPSILON = 0.01;
      const newStart = chapterRange.start + dragLastLocalStart;
      const newEnd = chapterRange.start + dragLastLocalEnd;

      if (dragResizeEdge === 'start') {
        const startDelta = newStart - dragOriginalStart;
        const newInPoint = dragOriginalIn + startDelta;
        const startChanged = Math.abs(newStart - dragOriginalStart) > EPSILON;
        const inChanged = Math.abs(newInPoint - dragOriginalIn) > EPSILON;

        if (startChanged || inChanged) {
          void executeUpdateClipTiming(
            dragClipId,
            dragOriginalStart,
            dragOriginalIn,
            dragOriginalOut,
            newStart,
            newInPoint,
            dragOriginalOut
          );
        }
      } else {
        const newDuration = newEnd - newStart;
        const newOutPoint = dragOriginalIn + newDuration;
        if (Math.abs(newOutPoint - dragOriginalOut) > EPSILON) {
          void executeResizeClip(dragClipId, dragOriginalIn, dragOriginalOut, dragOriginalIn, newOutPoint);
        }
      }
    }

    isPanning = false;
    isSelecting = false;
    dragPointerId = null;
    dragMode = null;
    dragClickTime = null;
    dragClickClipId = null;
    dragMoveModifierActive = false;
    selectionStartPointerTime = null;
    selectionEndPointerTime = null;
    dragClipId = null;
    dragResizeEdge = null;
    dragDidMove = false;
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    window.removeEventListener('pointermove', handleDragMove);
    window.removeEventListener('pointerup', handleDragEnd);
    window.removeEventListener('pointercancel', handleDragEnd);
  }

  function handleWaveformPointerDown(event: PointerEvent) {
    if (!scrollContainer || !isReady) return;
    if (!chapterRange) return;
    if (contextMenu.open && event.button !== 2) {
      closeContextMenu();
    }
    const pointerTime = getPointerTime(event);
    if (pointerTime === null) return;

    const { clipId, handle } = getPointerTargets(event);

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      startPanDrag(event);
      return;
    }

    if (event.button !== 0) return;

    if (editable && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      startSelectionDrag(event, pointerTime);
      return;
    }

    if (editable && (event.ctrlKey || event.metaKey) && clipId !== null && handle) {
      event.preventDefault();
      event.stopPropagation();
      startResizeDrag(event, clipId, handle, pointerTime);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startClickDrag(event, pointerTime, clipId);
  }

  function handleWaveformContextMenu(event: MouseEvent) {
    if (!editable) return;
    if (!scrollContainer || !isReady) return;

    const pointerTime = getPointerTime(event);
    if (pointerTime === null) {
      closeContextMenu();
      return;
    }

    const { clipId } = getPointerTargets(event);
    const cursorGlobalTime = chapterRange ? chapterRange.start + pointerTime : pointerTime;

    event.preventDefault();
    event.stopPropagation();

    if (clipId === null) {
      clearSelectionRegion();
      openContextMenu(event, {
        mode: 'track',
        clipId: null,
        cursorGlobalTime,
      });
      return;
    }

    const clip = getClipByIdLocal(clipId);
    const canSplit = clip ? canSplitClipAtGlobalTime(clip, cursorGlobalTime) : false;
    selectClip(clipId, false);
    openContextMenu(event, {
      mode: 'clip',
      clipId,
      cursorGlobalTime,
      canSplit,
    });
  }

  async function loadWaveformCache() {
    if (!assetId) return null;

    const result = await getWaveform(assetId, waveformTrackIndex, WAVEFORM_TIER_LEVEL);
    if (result.success && result.data) {
      return result.data;
    }

    return null;
  }

  function sliceWaveformData(
    waveformData: { peaks: Array<{ min: number; max: number }>; duration: number },
    rangeStart: number,
    rangeEnd: number,
    assetDurationSeconds: number | null
  ) {
    const totalDuration = waveformData.duration;
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) return null;

    const effectiveAssetDuration = assetDurationSeconds && assetDurationSeconds > 0
      ? assetDurationSeconds
      : totalDuration;
    const safeStart = clamp(rangeStart, 0, effectiveAssetDuration);
    const safeEnd = clamp(rangeEnd, safeStart + 0.01, effectiveAssetDuration);
    const durationRatio = totalDuration / effectiveAssetDuration;
    const start = clamp(safeStart * durationRatio, 0, totalDuration);
    const end = clamp(safeEnd * durationRatio, start + 0.01, totalDuration);
    const peaksPerSecond = waveformData.peaks.length / totalDuration;
    const startIndex = Math.floor(start * peaksPerSecond);
    const endIndex = Math.ceil(end * peaksPerSecond);
    const slicedPeaks = waveformData.peaks.slice(startIndex, Math.max(startIndex + 1, endIndex));

    return {
      peaks: slicedPeaks,
      duration: end - start,
    };
  }

  async function loadWaveformForAsset(options: { force?: boolean } = {}) {
    if (!waveSurfer) return;
    if (!audioUrl) return;
    if (!assetId) return;
    if (!chapterRange) return;

    const token = ++loadToken;
    const waveformData = await loadWaveformCache();

    if (isDestroyed || token !== loadToken) return;

    if (!waveformData) {
      waveformDuration = null;
      hasLoadedPeaks = false;
      return;
    }

    waveformDuration = waveformData.duration;

    const chapterKey = `${assetId}:${waveformTrackIndex}:${chapterRange.start}-${chapterRange.end}:${assetDuration ?? 'na'}:${waveformDuration ?? 'na'}`;
    const shouldReload =
      options.force ||
      loadedAssetId !== assetId ||
      loadedChapterKey !== chapterKey ||
      Boolean(waveformData) !== hasLoadedPeaks;

    if (!shouldReload) return;

    const sliced = sliceWaveformData(
      waveformData,
      chapterRange.start,
      chapterRange.end,
      assetDuration
    );
    if (!sliced) {
      hasLoadedPeaks = false;
      return;
    }

    const loadPeaks = [buildWaveSurferPeaks(sliced.peaks)];
    const loadDuration = Math.max(0.01, chapterRange.duration);

    try {
      isReady = false;
      await waveSurfer.load(audioUrl, loadPeaks, loadDuration);
      loadedAssetId = assetId;
      loadedChapterKey = chapterKey;
      hasLoadedPeaks = Boolean(waveformData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TimelineTrack] Failed to load waveform for asset ${assetId}: ${message}`, error);
    }
  }

  async function createClipFromSelection(start: number, end: number) {
    if (!editable) return;
    if (!projectDetail.projectId || !assetId) return;
    if (!chapterRange) return;

    const selection = normalizeSelection(start, end, MIN_SELECTION_SECONDS);
    if (!selection) return;

    const { startTime, inPoint, outPoint } = buildClipTimes(selection);
    const globalStart = chapterRange.start + startTime;
    const globalIn = chapterRange.start + inPoint;
    const globalOut = chapterRange.start + outPoint;

    await createProjectClip(
      projectDetail.projectId,
      assetId,
      createTrackIndex,
      globalStart,
      globalIn,
      globalOut,
      undefined,
      undefined,
      true
    );
  }

  // Initialize WaveSurfer
  onMount(() => {
    if (!container) return;
    isDestroyed = false;

    const init = async () => {
      // Initialize WaveSurfer with plugins
      const createdRegionsPlugin = (RegionsPlugin as any).create({
        dragSelection: false,
      });
      regionsPlugin = createdRegionsPlugin;
      
      waveSurfer = WaveSurfer.create({
        container,
        backend: 'MediaElement',
        waveColor: '#4a5568',
        progressColor: '#3182ce',
        cursorColor: '#e53e3e',
        height,
        normalize: true,
        interact: false,
        dragToSeek: false,
        minPxPerSec: timelineState.zoomLevel,
        plugins: [
          createdRegionsPlugin,
        ],
      });

      // Event handlers
      waveSurfer.on('ready', () => {
        isReady = true;
        renderRegions();
      });

      waveSurfer.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[TimelineTrack] WaveSurfer error: ${message}`, error);
      });
      
      waveSurfer.on('timeupdate', (time: number) => {
        // Sync with global playhead
        if (Math.abs(time - timelineState.playheadTime) > 0.1) {
          // This would sync the playhead - implement if needed
        }
      });
      
      updateScrollContainer();
      cleanupRenderListener = waveSurfer.on('redraw', () => {
        updateScrollContainer();
      });

      try {
        await loadWaveformForAsset({ force: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[TimelineTrack] Failed to load waveform: ${message}`, error);
      }
    };

    init();

    unsubscribeWaveformProgress = onWaveformProgress((event) => {
      if (!assetId || event.assetId !== assetId) return;
      const eventTrackIndex = event.trackIndex ?? event.progress.trackIndex;
      if (eventTrackIndex !== undefined && eventTrackIndex !== waveformTrackIndex) return;

      if (event.progress.tier !== WAVEFORM_TIER_LEVEL || event.progress.percent < 100) {
        return;
      }

      void loadWaveformForAsset({ force: true });
    });
    
    // Cleanup
    return () => {
      isDestroyed = true;
      unsubscribeWaveformProgress?.();
      cleanupRenderListener?.();
      cleanupRenderListener = null;
      scrollContainer?.removeEventListener('pointerdown', handleWaveformPointerDown, true);
      scrollContainer?.removeEventListener('contextmenu', handleWaveformContextMenu, true);
      scrollContainer?.removeEventListener('scroll', handleScrollContainerScroll);
      scrollContainer?.classList.remove('scrollbar-thin');
      scrollContainer = null;
      regionsPlugin?.destroy();
      waveSurfer?.destroy();
    };
  });

  $effect(() => {
    if (!contextMenu.open) return;

    const handleWindowClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.timeline-clip-context-menu')) return;
      closeContextMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('contextmenu', handleWindowClick);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('contextmenu', handleWindowClick);
      window.removeEventListener('keydown', handleEscape);
    };
  });

  $effect(() => {
    if (!waveSurfer) return;
    if (!assetId) return;
    if (!chapterRange) return;
    const chapterKey = `${assetId}:${waveformTrackIndex}:${chapterRange.start}-${chapterRange.end}:${assetDuration ?? 'na'}:${waveformDuration ?? 'na'}`;
    if (loadedAssetId !== assetId || loadedChapterKey !== chapterKey) {
      hasLoadedPeaks = false;
      void loadWaveformForAsset({ force: true });
    }
  });
  
  // Update zoom when state changes
  $effect(() => {
    if (waveSurfer && isReady) {
      waveSurfer.setOptions({ minPxPerSec: timelineState.zoomLevel });
    }
  });
  
  // Update playhead position
  $effect(() => {
    if (waveSurfer && isReady && chapterRange) {
      const localTime = clamp(timelineState.playheadTime - chapterRange.start, 0, chapterRange.duration);
      const progress = chapterRange.duration > 0 ? clamp(localTime / chapterRange.duration, 0, 1) : 0;
      waveSurfer.seekTo(progress);
    }
  });
  
  function renderRegions() {
    if (!regionsPlugin || !waveSurfer) return;

    if (!editable) {
      regionsPlugin.clearRegions();
      clipRegions.clear();
      isRenderingRegions = false;
      return;
    }

    isRenderingRegions = true;
    regionsPlugin.clearRegions();
    clipRegions.clear();

    if (!chapterRange) {
      isRenderingRegions = false;
      return;
    }

    const chapterStart = chapterRange.start;

    for (const clip of trackClips) {
      const duration = clip.out_point - clip.in_point;
      const color = clip.role ? ROLE_COLORS[clip.role] : DEFAULT_COLOR;
      const localStart = clip.start_time - chapterStart;
      const localEnd = localStart + duration;

      const normalized = normalizeRenderableLocalRange(localStart, localEnd);
      if (!normalized) {
        continue;
      }

      const localRegionStart = normalized.start;
      const localRegionEnd = normalized.end;
      const regionStart = toWaveSurferRegionTime(localRegionStart);
      const regionEnd = toWaveSurferRegionTime(localRegionEnd);
      const region = regionsPlugin.addRegion({
        id: `clip-${clip.id}`,
        start: regionStart,
        end: regionEnd,
        color,
        drag: false,
        resize: false,
      });

      if (region?.element) {
        region.element.classList.add('clip-region');
        region.element.dataset.clipId = String(clip.id);
        ensureClipHandles(region.element);
      }
      clipRegions.set(clip.id, region);
    }

    isRenderingRegions = false;
  }

  $effect(() => {
    if (!isReady) return;
    const _clips = trackClips;
    const _range = chapterRange;
    void _clips;
    void _range;
    renderRegions();
  });
  
  // Sync scroll position with other tracks
  $effect(() => {
    if (!waveSurfer || !scrollContainer || !isReady || isScrolling) return;
    if (!chapterRange) return;
    const scrollTime = clamp(timelineState.scrollPosition, 0, chapterRange.duration);
    const pixelsPerSecond = getPixelsPerSecond();
    const targetScroll = scrollTime * pixelsPerSecond;
    const currentScroll = waveSurfer.getScroll();
    // Only update if significantly different to avoid fighting
    if (Math.abs(currentScroll - targetScroll) > 1) {
      waveSurfer.setScroll(targetScroll);
    }
  });
</script>

<div class="track-container">
  <div class="track-header">
    <span class="track-label">{laneLabel}</span>
    <span class="track-info">{missing ? 'source unavailable' : editable ? `${trackClips.length} clips` : 'visual only'}</span>
  </div>
  <div
    class="waveform-container"
    class:visual-only={!editable}
    class:missing={missing}
    class:panning={isPanning}
    class:selecting={isSelecting}
    bind:this={container}
  >
    {#if missing}
      <div class="missing-overlay">Original media unavailable</div>
    {/if}
  </div>

  {#if editable && contextMenu.open}
    <div
      class="timeline-clip-context-menu"
      style={`top: ${contextMenu.y}px; left: ${contextMenu.x}px;`}
      role="menu"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          closeContextMenu();
        }
      }}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#if contextMenu.mode === 'track'}
        <button class="timeline-context-item" role="menuitem" onclick={handleTrackContextCreateClip}>
          Create clip at cursor
        </button>
      {:else}
        <button
          class="timeline-context-item"
          class:disabled={!contextMenu.canSplit}
          role="menuitem"
          onclick={handleClipContextSplit}
          disabled={!contextMenu.canSplit}
        >
          Split clip at cursor
        </button>
        <button class="timeline-context-item destructive" role="menuitem" onclick={handleClipContextDelete}>
          Delete clip
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .track-container {
    display: flex;
    flex-direction: column;
    background: var(--surface-base);
    border-bottom: 1px solid var(--border-default);
  }
  
  .track-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-hover);
    border-bottom: 1px solid var(--border-default);
    height: 24px;
  }
  
  .track-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 600;
  }
  
  .track-info {
    font-size: var(--text-xs);
    color: var(--text-disabled);
  }
  
  .waveform-container {
    position: relative;
    width: 100%;
    min-height: 100px;
    cursor: pointer;
  }

  .waveform-container.missing {
    background: var(--surface-page);
  }

  .waveform-container.visual-only {
    cursor: default;
  }

  :global(.scrollbar-thin) {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }

  :global(.scrollbar-thin::-webkit-scrollbar) {
    width: var(--scrollbar-width);
    height: var(--scrollbar-width);
  }

  :global(.scrollbar-thin::-webkit-scrollbar-track) {
    background: var(--scrollbar-track);
  }

  :global(.scrollbar-thin::-webkit-scrollbar-thumb) {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-pill);
  }

  :global(.scrollbar-thin::-webkit-scrollbar-thumb:hover) {
    background: var(--scrollbar-thumb-hover);
  }

  .waveform-container.panning {
    cursor: grabbing;
  }

  .waveform-container.selecting {
    cursor: crosshair;
  }

  .missing-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    pointer-events: none;
    background: color-mix(in srgb, var(--surface-page) 55%, transparent);
  }

  .timeline-clip-context-menu {
    position: fixed;
    z-index: var(--z-context-menu);
    min-width: 160px;
    padding: var(--space-1);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }

  .timeline-context-item {
    width: 100%;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-base);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .timeline-context-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .timeline-context-item:disabled,
  .timeline-context-item.disabled {
    opacity: 0.45;
    cursor: not-allowed;
    color: var(--text-tertiary);
  }

  .timeline-context-item:disabled:hover,
  .timeline-context-item.disabled:hover {
    background: transparent;
    color: var(--text-tertiary);
  }

  .timeline-context-item.destructive {
    color: var(--accent-destructive);
  }
  
  :global(.wavesurfer-region) {
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  :global(.clip-region) {
    z-index: 2;
    min-width: 2px;
  }
  
  :global(.wavesurfer-region:hover) {
    border-color: color-mix(in srgb, var(--text-primary) 50%, transparent);
  }
  
  :global(.wavesurfer-region.selected) {
    border-color: var(--text-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-primary) 30%, transparent);
  }
</style>
