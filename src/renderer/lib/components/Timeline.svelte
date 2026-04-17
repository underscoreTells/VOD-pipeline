<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TimelineTrack from './TimelineTrack.svelte';
  import { timelineState, loadTimeline, setMinZoom, setZoom } from '../state/timeline.svelte';
  import type { Clip, TimelineState as TimelineStateType } from '../../../shared/types/database';

  const DEFAULT_MIN_ZOOM_LEVEL = 10;

  interface TimelineLane {
    id: string;
    label: string;
    audioUrl: string;
    missing: boolean;
    assetId: number | null;
    editable: boolean;
    clipTrackIndex: number;
    waveformTrackIndex: number;
    createTrackIndex?: number;
  }
  
  interface Props {
    projectId: number;
    lanes: TimelineLane[];
    clips: Clip[];
    displayClips?: Clip[];
    initialState?: TimelineStateType | null;
    chapterDuration?: number | null;
  }

  let {
    projectId,
    lanes,
    clips,
    displayClips,
    initialState = null,
    chapterDuration = null,
  }: Props = $props();

  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let lastProjectId = $state<number | null>(null);
  let timelineRef: HTMLDivElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  function updateMinZoomToFitChapter() {
    if (!timelineRef || !chapterDuration || chapterDuration <= 0) {
      setMinZoom(DEFAULT_MIN_ZOOM_LEVEL);
      return;
    }

    const width = timelineRef.clientWidth;
    if (!width) return;

    const fitZoom = Math.max(0.05, (width - 1) / chapterDuration);
    setMinZoom(fitZoom);
  }

  onMount(() => {
    updateMinZoomToFitChapter();

    if (timelineRef) {
      resizeObserver = new ResizeObserver(() => {
        updateMinZoomToFitChapter();
      });
      resizeObserver.observe(timelineRef);
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    setMinZoom(DEFAULT_MIN_ZOOM_LEVEL);
  });
  
  // Load timeline data
  $effect(() => {
    if (!projectId || !clips) return;
    if (timelineState.projectId === projectId) {
      lastProjectId = projectId;
      isLoading = false;
      return;
    }
    if (projectId !== lastProjectId) {
      lastProjectId = projectId;
      loadTimeline(projectId, clips, initialState);
      isLoading = false;
    }
  });
  
  // Update loading state when clips change
  $effect(() => {
    if (clips && clips.length > 0) {
      isLoading = false;
    }
  });

  $effect(() => {
    const _chapterDuration = chapterDuration;
    void _chapterDuration;
    updateMinZoomToFitChapter();
  });

  // Handle wheel for ctrl+scroll zoom
  function handleWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    const multiplier = direction > 0 ? 0.9 : 1.1;
    setZoom(timelineState.zoomLevel * multiplier);
  }
</script>

<div class="timeline" onwheel={handleWheel} bind:this={timelineRef}>
    {#if isLoading}
      <div class="loading">
        <span class="loading-spinner"></span>
        <p>Loading timeline...</p>
      </div>
  {:else if error}
    <div class="error">
      <p>Error: {error}</p>
    </div>
  {:else}
    <div class="tracks-container">
      {#each lanes as lane (lane.id)}
        <TimelineTrack 
          audioUrl={lane.audioUrl}
          missing={lane.missing}
          assetId={lane.assetId}
          laneLabel={lane.label}
          editable={lane.editable}
          clipTrackIndex={lane.clipTrackIndex}
          waveformTrackIndex={lane.waveformTrackIndex}
          createTrackIndex={lane.createTrackIndex ?? 0}
          height={100}
          clips={displayClips ?? clips}
        />
      {/each}
    </div>
    
    {#if lanes.length === 0}
      <div class="empty">
        <p>No audio tracks loaded</p>
        <p class="hint">Import a video to see the timeline</p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f0f;
    overflow: hidden;
  }
  
  .tracks-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  
  .loading, .error, .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    padding: 2rem;
  }
  
  .loading-spinner {
    display: inline-block;
    width: 40px;
    height: 40px;
    border: 3px solid #333;
    border-top-color: #007bff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error {
    color: #dc3545;
  }
  
  .empty .hint {
    font-size: 0.875rem;
    color: #666;
  }
</style>
