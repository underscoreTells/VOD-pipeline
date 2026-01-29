<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
  import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
  import type { Clip } from '../../../shared/types/database';
  import { timelineState, selectClip, getClipsByTrack, setScroll, getTotalDuration } from '../state/timeline.svelte';
  import { MoveClipCommand, ResizeClipCommand, executeCommand } from '../state/undo-redo.svelte';
  import { formatTime } from '../state/keyboard.svelte';
  
  interface Props {
    audioUrl: string;
    trackIndex: number;
    height?: number;
  }
  
  let { audioUrl, trackIndex, height = 100 }: Props = $props();
  
  let container: HTMLDivElement;
  let waveSurfer: WaveSurfer | null = null;
  let regionsPlugin: RegionsPlugin | null = null;
  let isReady = $state(false);
  
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
  
  // Initialize WaveSurfer
  onMount(() => {
    if (!container) return;
    
    // Initialize WaveSurfer with plugins
    regionsPlugin = RegionsPlugin.create();
    
    waveSurfer = WaveSurfer.create({
      container,
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
    
    // Load audio
    waveSurfer.load(audioUrl);
    
    // Event handlers
    waveSurfer.on('ready', () => {
      isReady = true;
      createClipRegions();
    });
    
    waveSurfer.on('timeupdate', (time: number) => {
      // Sync with global playhead
      if (Math.abs(time - timelineState.playheadTime) > 0.1) {
        // This would sync the playhead - implement if needed
      }
    });
    
    waveSurfer.on('scroll', (scrollLeft: number) => {
      // Convert scroll position to seconds
      if (waveSurfer) {
        const scrollTime = scrollLeft / waveSurfer.options.minPxPerSec;
        setScroll(scrollTime);
      }
    });
    
    // Cleanup
    return () => {
      waveSurfer?.destroy();
    };
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
        
        // Determine if this was a move or resize
        if (Math.abs(newStart - clip.start_time) > 0.01) {
          // This is a move
          const command = new MoveClipCommand(
            'Move clip',
            clip.id,
            clip.start_time,
            newStart
          );
          executeCommand(command);
        }
        
        if (Math.abs(newDuration - duration) > 0.01) {
          // This is a resize - adjust out_point proportionally
          const ratio = newDuration / duration;
          const newOutPoint = clip.in_point + (duration * ratio);
          
          const command = new ResizeClipCommand(
            'Resize clip',
            clip.id,
            clip.in_point,
            clip.out_point,
            clip.in_point,
            newOutPoint
          );
          executeCommand(command);
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
    if (container && isReady) {
      const scrollLeft = timelineState.scrollPosition * timelineState.zoomLevel;
      container.scrollLeft = scrollLeft;
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
