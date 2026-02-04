<script lang="ts">
  import { onMount } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
  import type { Clip } from '../../../shared/types/database';
  import { getWaveform, onWaveformProgress } from '../state/electron.svelte';
  import { timelineState, selectClip, setPlayhead, setScroll } from '../state/timeline.svelte';
  import { createProjectClip, executeMoveClip, executeResizeClip, projectDetail } from '../state/project-detail.svelte';
  import { chaptersState } from '../state/chapters.svelte';
  import { buildClipTimes, normalizeSelection } from '../utils/clip-selection';
  
  interface Props {
    audioUrl: string;
    assetId: number | null;
    trackIndex: number;
    height?: number;
    clips?: Clip[];
  }
  
  let { audioUrl, assetId, trackIndex, height = 100, clips }: Props = $props();
  
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

  const WAVEFORM_TIER_LEVEL = 1;
  const AUDIO_TRACK_INDEX = 0;
  
  // Role colors for clips
  const ROLE_COLORS: Record<string, string> = {
    'setup': 'rgba(239, 68, 68, 0.6)',      // Red
    'escalation': 'rgba(249, 115, 22, 0.6)', // Orange
    'twist': 'rgba(234, 179, 8, 0.6)',      // Yellow
    'payoff': 'rgba(34, 197, 94, 0.6)',     // Green
    'transition': 'rgba(59, 130, 246, 0.6)', // Blue
  };
  
  const DEFAULT_COLOR = 'rgba(107, 114, 128, 0.6)';
  const SELECTION_COLOR = 'rgba(79, 70, 229, 0.2)';
  
  // Get clips for this track
  const trackClips = $derived.by(() => {
    const source = clips ?? timelineState.clips;
    return source.filter((clip) => clip.track_index === trackIndex);
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
  const CLICK_DRAG_THRESHOLD = 4;

  let isRenderingRegions = false;
  let isPanning = $state(false);
  let isSelecting = $state(false);
  let selectionStartTime = 0;
  let selectionCurrentTime = 0;
  let selectionRegion: any | null = null;
  let dragPointerId: number | null = null;
  let dragMode: 'pan' | 'select' | 'click' | 'move' | 'resize' | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragClickTime: number | null = null;
  let dragClickClipId: number | null = null;
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
      scrollContainer.removeEventListener('scroll', handleScrollContainerScroll);
      scrollContainer.classList.remove('waveform-scroll-container');
    }
    scrollContainer = nextScrollContainer;
    if (scrollContainer) {
      const root = scrollContainer.getRootNode();
      if (root instanceof ShadowRoot) {
        const existingStyle = root.querySelector('style[data-waveform-scrollbar]');
        if (!existingStyle) {
          const style = document.createElement('style');
          style.dataset.waveformScrollbar = 'true';
          style.textContent = `
            .waveform-scroll-container { scrollbar-width: none; -ms-overflow-style: none; }
            .waveform-scroll-container::-webkit-scrollbar { width: 0; height: 0; }
          `;
          root.appendChild(style);
        }
      }
      scrollContainer.classList.add('waveform-scroll-container');
      scrollContainer.addEventListener('pointerdown', handleWaveformPointerDown, { capture: true });
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

  function getPointerTime(event: PointerEvent): number | null {
    if (!scrollContainer) return null;
    if (!chapterRange) return null;
    if (!waveSurfer) return null;
    const rect = scrollContainer.getBoundingClientRect();
    const localX = clamp(event.clientX - rect.left, 0, rect.width);
    const scrollLeft = scrollContainer.scrollLeft;
    const pixelsPerSecond = getPixelsPerSecond();
    const time = (scrollLeft + localX) / pixelsPerSecond;
    return clamp(time, 0, chapterRange.duration);
  }

  function updateSelectionRegion(start: number, end: number) {
    if (!regionsPlugin) return;
    const rangeStart = Math.min(start, end);
    const rangeEnd = Math.max(start, end);

    if (!selectionRegion) {
      selectionRegion = regionsPlugin.addRegion({
        id: 'selection-temp',
        start: rangeStart,
        end: rangeEnd,
        color: SELECTION_COLOR,
        drag: false,
        resize: false,
      });
      return;
    }

    if (typeof selectionRegion.setOptions === 'function') {
      selectionRegion.setOptions({ start: rangeStart, end: rangeEnd });
      return;
    }

    if (typeof selectionRegion.update === 'function') {
      selectionRegion.update({ start: rangeStart, end: rangeEnd });
      return;
    }

    selectionRegion.remove?.();
    selectionRegion = regionsPlugin.addRegion({
      id: 'selection-temp',
      start: rangeStart,
      end: rangeEnd,
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

  function getPointerTargets(event: PointerEvent): { clipId: number | null; handle: 'start' | 'end' | null } {
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

  function updateRegionVisual(clipId: number, localStart: number, localEnd: number) {
    const region = clipRegions.get(clipId);
    if (!region || !chapterRange) return;
    const regionStart = clamp(localStart, 0, chapterRange.duration);
    const regionEnd = clamp(localEnd, 0, chapterRange.duration);

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
    updateSelectionRegion(selectionStartTime, selectionCurrentTime);
    document.body.style.cursor = 'crosshair';
  }

  function startClickDrag(event: PointerEvent, clickTime: number, clipId: number | null) {
    beginDrag(event, 'click');
    dragClickTime = clickTime;
    dragClickClipId = clipId;
  }

  function startMoveDrag(event: PointerEvent, clipId: number, pointerTime: number) {
    if (!chapterRange) return;
    const clip = getClipByIdLocal(clipId);
    if (!clip) return;
    const duration = clip.out_point - clip.in_point;
    if (!Number.isFinite(duration) || duration <= 0) return;

    beginDrag(event, 'move');
    selectClip(clipId, false);
    dragClipId = clipId;
    dragClipDuration = duration;
    dragClipLocalStart = clip.start_time - chapterRange.start;
    dragClipLocalEnd = dragClipLocalStart + duration;
    dragClipOffset = clamp(pointerTime - dragClipLocalStart, 0, duration);
    dragLastLocalStart = dragClipLocalStart;
    dragLastLocalEnd = dragClipLocalEnd;
    dragOriginalStart = clip.start_time;
    dragOriginalIn = clip.in_point;
    dragOriginalOut = clip.out_point;
    document.body.style.cursor = 'grabbing';
  }

  function startResizeDrag(event: PointerEvent, clipId: number, edge: 'start' | 'end', pointerTime: number) {
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
      if (Math.hypot(deltaX, deltaY) > CLICK_DRAG_THRESHOLD) {
        dragDidMove = true;
      }
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
      updateSelectionRegion(selectionStartTime, selectionCurrentTime);
      return;
    }

    if (dragMode === 'move') {
      if (!chapterRange || dragClipId === null) return;
      const currentTime = getPointerTime(event);
      if (currentTime === null) return;
      const maxStart = Math.max(0, chapterRange.duration - dragClipDuration);
      const nextStart = clamp(currentTime - dragClipOffset, 0, maxStart);
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
    if (dragMode === 'select') {
      const start = selectionStartTime;
      const end = selectionCurrentTime;
      clearSelectionRegion();
      void createClipFromSelection(start, end);
    }

    if (dragMode === 'click' && !dragDidMove && chapterRange) {
      const pointerTime = getPointerTime(event) ?? dragClickTime;
      if (pointerTime !== null) {
        const globalTime = chapterRange.start + pointerTime;
        setPlayhead(globalTime);
      }
      if (dragClickClipId !== null) {
        selectClip(dragClickClipId, false);
      }
    }

    if (dragMode === 'move' && chapterRange && dragClipId !== null) {
      const newStart = chapterRange.start + dragLastLocalStart;
      const EPSILON = 0.01;
      if (Math.abs(newStart - dragOriginalStart) > EPSILON) {
        void executeMoveClip(dragClipId, dragOriginalStart, newStart);
      }
    }

    if (dragMode === 'resize' && chapterRange && dragClipId !== null) {
      const duration = dragOriginalOut - dragOriginalIn;
      const newStart = chapterRange.start + dragLastLocalStart;
      const newEnd = chapterRange.start + dragLastLocalEnd;
      const newDuration = newEnd - newStart;

      const EPSILON = 0.01;
      const durationChanged = Math.abs(newDuration - duration) > EPSILON;

      if (!durationChanged) {
        if (Math.abs(newStart - dragOriginalStart) > EPSILON) {
          void executeMoveClip(dragClipId, dragOriginalStart, newStart);
        }
      } else {
        const startChanged = Math.abs(newStart - dragOriginalStart) > EPSILON;
        const endChanged = Math.abs(newEnd - (dragOriginalStart + duration)) > EPSILON;

        let newInPoint = dragOriginalIn;
        let newOutPoint = dragOriginalOut;

        if (startChanged) {
          const startDelta = newStart - dragOriginalStart;
          newInPoint = dragOriginalIn + startDelta;
        }

        if (endChanged) {
          newOutPoint = dragOriginalIn + newDuration;
        }

        if (newOutPoint > newInPoint) {
          void executeResizeClip(dragClipId, dragOriginalIn, dragOriginalOut, newInPoint, newOutPoint);
        }
      }
    }

    isPanning = false;
    isSelecting = false;
    dragPointerId = null;
    dragMode = null;
    dragClickTime = null;
    dragClickClipId = null;
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
    const pointerTime = getPointerTime(event);
    if (pointerTime === null) return;

    const { clipId, handle } = getPointerTargets(event);

    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      if (clipId !== null) {
        startMoveDrag(event, clipId, pointerTime);
      } else {
        startPanDrag(event);
      }
      return;
    }

    if (event.button !== 0) return;

    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      startSelectionDrag(event, pointerTime);
      return;
    }

    if (event.ctrlKey && clipId !== null && handle) {
      event.preventDefault();
      event.stopPropagation();
      startResizeDrag(event, clipId, handle, pointerTime);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startClickDrag(event, pointerTime, clipId);
  }

  async function loadWaveformCache() {
    if (!assetId) return null;

    const result = await getWaveform(assetId, AUDIO_TRACK_INDEX, WAVEFORM_TIER_LEVEL);
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

    const chapterKey = `${assetId}:${chapterRange.start}-${chapterRange.end}:${assetDuration ?? 'na'}:${waveformDuration ?? 'na'}`;
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
      trackIndex,
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
      scrollContainer?.removeEventListener('scroll', handleScrollContainerScroll);
      scrollContainer?.classList.remove('waveform-scroll-container');
      scrollContainer = null;
      regionsPlugin?.destroy();
      waveSurfer?.destroy();
    };
  });

  $effect(() => {
    if (!waveSurfer) return;
    if (!assetId) return;
    if (!chapterRange) return;
    const chapterKey = `${assetId}:${chapterRange.start}-${chapterRange.end}:${assetDuration ?? 'na'}:${waveformDuration ?? 'na'}`;
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
      waveSurfer.setTime(localTime);
    }
  });
  
  function renderRegions() {
    if (!regionsPlugin || !waveSurfer) return;

    isRenderingRegions = true;
    regionsPlugin.clearRegions();
    clipRegions.clear();

    if (!chapterRange) {
      isRenderingRegions = false;
      return;
    }

    const chapterStart = chapterRange.start;
    const chapterDuration = chapterRange.duration;

    for (const clip of trackClips) {
      const duration = clip.out_point - clip.in_point;
      const color = clip.role ? ROLE_COLORS[clip.role] : DEFAULT_COLOR;
      const localStart = clip.start_time - chapterStart;
      const localEnd = localStart + duration;

      if (localEnd <= 0 || localStart >= chapterDuration) {
        continue;
      }

      const regionStart = clamp(localStart, 0, chapterDuration);
      const regionEnd = clamp(localEnd, 0, chapterDuration);
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
    <span class="track-label">Track {trackIndex + 1}</span>
    <span class="track-info">{trackClips.length} clips</span>
  </div>
  <div
    class="waveform-container"
    class:panning={isPanning}
    class:selecting={isSelecting}
    bind:this={container}
  ></div>
</div>

<style>
  .track-container {
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    border-bottom: 1px solid #333;
  }
  
  .track-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0.5rem;
    background: #2a2a2a;
    border-bottom: 1px solid #333;
    height: 24px;
  }
  
  .track-label {
    font-size: 0.75rem;
    color: #aaa;
    font-weight: 600;
  }
  
  .track-info {
    font-size: 0.7rem;
    color: #666;
  }
  
  .waveform-container {
    width: 100%;
    min-height: 100px;
    cursor: pointer;
  }

  :global(.waveform-scroll-container) {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  :global(.waveform-scroll-container::-webkit-scrollbar) {
    width: 0;
    height: 0;
  }

  .waveform-container.panning {
    cursor: grabbing;
  }

  .waveform-container.selecting {
    cursor: crosshair;
  }
  
  :global(.wavesurfer-region) {
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  :global(.clip-region) {
    z-index: 2;
  }
  
  :global(.wavesurfer-region:hover) {
    border-color: rgba(255, 255, 255, 0.5);
  }
  
  :global(.wavesurfer-region.selected) {
    border-color: #fff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
  }
</style>
