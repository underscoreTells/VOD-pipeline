<script lang="ts">
  import { onMount } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
  import type { Clip } from '../../../shared/types/database';
  import { getWaveform, onWaveformProgress } from '../state/electron.svelte';
  import { timelineState, selectClip, getClipsByTrack, setScroll, getTotalDuration } from '../state/timeline.svelte';
  import { MoveClipCommand, ResizeClipCommand, executeCommand } from '../state/undo-redo.svelte';
  import { formatTime } from '../state/keyboard.svelte';
  
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

  // Initialize WaveSurfer
  onMount(() => {
    if (!container) return;
    isDestroyed = false;

    const init = async () => {
      // Initialize WaveSurfer with plugins
      regionsPlugin = RegionsPlugin.create();
      
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
          regionsPlugin,
        ],
      });

      // Event handlers
      waveSurfer.on('ready', () => {
        isReady = true;
        createClipRegions();
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
  
  // Create regions for clips
  function createClipRegions() {
    if (!regionsPlugin || !waveSurfer) return;
    
    // Clear existing regions
    regionsPlugin.clearRegions();
    
    // Create region for each clip
    for (const clip of trackClips) {
      const duration = clip.out_point - clip.in_point;
      const color = clip.role ? ROLE_COLORS[clip.role] : DEFAULT_COLOR;
      
      const region = regionsPlugin.addRegion({
        id: String(clip.id),
        start: clip.start_time,
        end: clip.start_time + duration,
        color,
        drag: true,
        resize: true,
      });
      
      // Handle region update (drag/resize)
      region.on('update-end', () => {
        const newStart = region.start;
        const newEnd = region.end;
        const newDuration = newEnd - newStart;

        const EPSILON = 0.01;
        const durationChanged = Math.abs(newDuration - duration) > EPSILON;

        if (!durationChanged) {
          // Duration unchanged - this is a pure move
          const command = new MoveClipCommand(
            'Move clip',
            clip.id,
            clip.start_time,
            newStart
          );
          executeCommand(command);
        } else {
          // Duration changed - this is a resize
          const startChanged = Math.abs(newStart - clip.start_time) > EPSILON;
          const endChanged = Math.abs(newEnd - (clip.start_time + duration)) > EPSILON;

          let newInPoint = clip.in_point;
          let newOutPoint = clip.out_point;

          if (startChanged) {
            // Left edge moved - adjust in_point
            const startDelta = newStart - clip.start_time;
            newInPoint = clip.in_point + startDelta;
          }

          if (endChanged) {
            // Right edge moved - adjust out_point based on new duration
            newOutPoint = clip.in_point + newDuration;
          }

          // Validate that out_point is still greater than in_point
          if (newOutPoint > newInPoint) {
            const command = new ResizeClipCommand(
              'Resize clip',
              clip.id,
              clip.in_point,
              clip.out_point,
              newInPoint,
              newOutPoint
            );
            executeCommand(command);
          }
        }
      });
      
      // Handle click to select
      region.on('click', (e: Event) => {
        e.stopPropagation();
        selectClip(clip.id, false);
      });
    }
  }
  
  // Update regions when clips change
  $effect(() => {
    if (isReady && trackClips) {
      createClipRegions();
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
  
  :global(.wavesurfer-region:hover) {
    border-color: rgba(255, 255, 255, 0.5);
  }
  
  :global(.wavesurfer-region.selected) {
    border-color: #fff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
  }
</style>
