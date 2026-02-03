<script lang="ts">
  import { onMount } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
  import type { Clip, Chapter } from '../../../shared/types/database';
  import { getWaveform, onWaveformProgress } from '../state/electron.svelte';
  import { timelineState, selectClip, getClipsByTrack, setScroll } from '../state/timeline.svelte';
  import { createProjectClip, executeMoveClip, executeResizeClip, projectDetail } from '../state/project-detail.svelte';
  import { chaptersState, selectChapter, updateChapter } from '../state/chapters.svelte';
  import { buildClipTimes, normalizeSelection } from '../utils/clip-selection';
  
  interface Props {
    audioUrl: string;
    assetId: number | null;
    trackIndex: number;
    height?: number;
  }
  
  let { audioUrl, assetId, trackIndex, height = 100 }: Props = $props();
  
  let container: HTMLDivElement;
  let waveSurfer: WaveSurfer | null = null;
  let regionsPlugin: RegionsPlugin | null = null;
  let isReady = $state(false);
  let isScrolling = false; // Flag to prevent scroll loop
  let isDestroyed = false;
  let loadedAssetId: number | null = null;
  let hasLoadedPeaks = false;
  let loadToken = 0;
  let unsubscribeWaveformProgress: (() => void) | null = null;

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
  
  // Get clips for this track
  const trackClips = $derived.by(() => {
    const byTrack = getClipsByTrack();
    return byTrack.get(trackIndex) || [];
  });

  const trackChapters = $derived.by(() => {
    if (!assetId) return [] as Chapter[];
    return chaptersState.chapters.filter((chapter) => {
      const chapterAssets = chaptersState.chapterAssets.get(chapter.id);
      return chapterAssets?.includes(assetId) ?? false;
    });
  });

  const selectedChapterId = $derived(() => chaptersState.selectedChapterId);

  const MIN_SELECTION_SECONDS = 0.25;
  const CHAPTER_COLOR = 'rgba(56, 189, 248, 0.15)';
  const CHAPTER_SELECTED_COLOR = 'rgba(56, 189, 248, 0.35)';

  let isRenderingRegions = false;
  
  function buildWaveSurferPeaks(peaks: Array<{ min: number; max: number }>): Float32Array {
    const values = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i += 1) {
      const peak = peaks[i];
      values[i] = Math.max(Math.abs(peak.min), Math.abs(peak.max));
    }
    return values;
  }

  async function loadWaveformCache() {
    if (!assetId) return null;

    const result = await getWaveform(assetId, AUDIO_TRACK_INDEX, WAVEFORM_TIER_LEVEL);
    if (result.success && result.data) {
      return result.data;
    }

    return null;
  }

  async function loadWaveformForAsset(options: { force?: boolean } = {}) {
    if (!waveSurfer) return;
    if (!audioUrl) return;
    if (!assetId) return;

    const token = ++loadToken;
    const waveformData = await loadWaveformCache();

    if (isDestroyed || token !== loadToken) return;

    if (!waveformData) {
      hasLoadedPeaks = false;
      return;
    }

    const shouldReload =
      options.force ||
      loadedAssetId !== assetId ||
      Boolean(waveformData) !== hasLoadedPeaks;

    if (!shouldReload) return;

    const loadPeaks = [buildWaveSurferPeaks(waveformData.peaks)];
    const loadDuration = waveformData.duration;

    try {
      isReady = false;
      await waveSurfer.load(audioUrl, loadPeaks, loadDuration);
      loadedAssetId = assetId;
      hasLoadedPeaks = Boolean(waveformData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[TimelineTrack] Failed to load waveform for asset ${assetId}: ${message}`, error);
    }
  }

  function isKnownRegion(id: string): boolean {
    if (id.startsWith('chapter-')) return true;
    if (id.startsWith('clip-')) return true;
    return false;
  }

  async function createClipFromRegion(region: { start: number; end: number; remove?: () => void }) {
    if (!projectDetail.projectId || !assetId) {
      region.remove?.();
      return;
    }

    const selection = normalizeSelection(region.start, region.end, MIN_SELECTION_SECONDS);
    if (!selection) {
      region.remove?.();
      return;
    }

    const { startTime, inPoint, outPoint } = buildClipTimes(selection);

    try {
      await createProjectClip(
        projectDetail.projectId,
        assetId,
        trackIndex,
        startTime,
        inPoint,
        outPoint,
        undefined,
        undefined,
        true
      );
    } finally {
      region.remove?.();
    }
  }

  // Initialize WaveSurfer
  onMount(() => {
    if (!container) return;
    isDestroyed = false;

    const init = async () => {
      // Initialize WaveSurfer with plugins
      const createdRegionsPlugin = (RegionsPlugin as any).create({
        dragSelection: {
          slop: 5,
          color: 'rgba(79, 70, 229, 0.2)',
        },
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
      
      waveSurfer.on('scroll', (scrollLeft: number) => {
        // Prevent feedback loop
        if (isScrolling) return;
        
        // Convert scroll position to seconds
        if (waveSurfer) {
          const scrollTime = scrollLeft / timelineState.zoomLevel;
          isScrolling = true;
          setScroll(scrollTime);
          // Reset flag after state update
          setTimeout(() => { isScrolling = false; }, 0);
        }
      });

      (regionsPlugin as any)?.on('region-created', (region: any) => {
        if (isRenderingRegions) return;
        const regionId = typeof region.id === 'string' ? region.id : '';
        if (isKnownRegion(regionId)) return;
        void createClipFromRegion(region);
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
      regionsPlugin?.destroy();
      waveSurfer?.destroy();
    };
  });

  $effect(() => {
    if (!waveSurfer) return;
    if (!assetId) return;
    if (loadedAssetId !== assetId) {
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
    if (waveSurfer && isReady) {
      waveSurfer.setTime(timelineState.playheadTime);
    }
  });
  
  function renderRegions() {
    if (!regionsPlugin || !waveSurfer) return;

    isRenderingRegions = true;
    regionsPlugin.clearRegions();

    const chapters = trackChapters.slice().sort((a, b) => a.start_time - b.start_time);
    for (const chapter of chapters) {
      const isSelected = chapter.id === selectedChapterId();
      const region = regionsPlugin.addRegion({
        id: `chapter-${chapter.id}`,
        start: chapter.start_time,
        end: chapter.end_time,
        color: isSelected ? CHAPTER_SELECTED_COLOR : CHAPTER_COLOR,
        drag: isSelected,
        resize: isSelected,
      });

      if (region?.element) {
        region.element.classList.add('chapter-region');
        if (isSelected) {
          region.element.classList.add('chapter-region-selected');
        }
      }

      region.on('click', (e: Event) => {
        e.stopPropagation();
        selectChapter(chapter.id);
      });

      if (isSelected) {
        region.on('update-end', () => {
          const newStart = Math.max(0, region.start);
          const newEnd = Math.max(newStart + 0.01, region.end);
          void updateChapter(chapter.id, { startTime: newStart, endTime: newEnd });
        });
      }
    }

    for (const clip of trackClips) {
      const duration = clip.out_point - clip.in_point;
      const color = clip.role ? ROLE_COLORS[clip.role] : DEFAULT_COLOR;

      const region = regionsPlugin.addRegion({
        id: `clip-${clip.id}`,
        start: clip.start_time,
        end: clip.start_time + duration,
        color,
        drag: true,
        resize: true,
      });

      if (region?.element) {
        region.element.classList.add('clip-region');
      }

      region.on('update-end', () => {
        const newStart = region.start;
        const newEnd = region.end;
        const newDuration = newEnd - newStart;

        const EPSILON = 0.01;
        const durationChanged = Math.abs(newDuration - duration) > EPSILON;

        if (!durationChanged) {
          void executeMoveClip(clip.id, clip.start_time, newStart);
          return;
        }

        const startChanged = Math.abs(newStart - clip.start_time) > EPSILON;
        const endChanged = Math.abs(newEnd - (clip.start_time + duration)) > EPSILON;

        let newInPoint = clip.in_point;
        let newOutPoint = clip.out_point;

        if (startChanged) {
          const startDelta = newStart - clip.start_time;
          newInPoint = clip.in_point + startDelta;
        }

        if (endChanged) {
          newOutPoint = clip.in_point + newDuration;
        }

        if (newOutPoint > newInPoint) {
          void executeResizeClip(clip.id, clip.in_point, clip.out_point, newInPoint, newOutPoint);
        }
      });

      region.on('click', (e: Event) => {
        e.stopPropagation();
        selectClip(clip.id, false);
      });
    }

    isRenderingRegions = false;
  }

  $effect(() => {
    if (isReady) {
      renderRegions();
    }
  });
  
  // Sync scroll position with other tracks
  $effect(() => {
    if (container && isReady && !isScrolling) {
      const scrollLeft = timelineState.scrollPosition * timelineState.zoomLevel;
      // Only update if significantly different to avoid fighting
      if (Math.abs(container.scrollLeft - scrollLeft) > 1) {
        container.scrollLeft = scrollLeft;
      }
    }
  });
</script>

<div class="track-container">
  <div class="track-header">
    <span class="track-label">Track {trackIndex + 1}</span>
    <span class="track-info">{trackClips.length} clips</span>
  </div>
  <div class="waveform-container" bind:this={container}></div>
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
  }
  
  :global(.wavesurfer-region) {
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  :global(.chapter-region) {
    border-radius: 6px;
    border: 1px solid rgba(56, 189, 248, 0.4);
    z-index: 1;
  }

  :global(.chapter-region-selected) {
    border-color: rgba(56, 189, 248, 0.9);
    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);
    z-index: 3;
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
