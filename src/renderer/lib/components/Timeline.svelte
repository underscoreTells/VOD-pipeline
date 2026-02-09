<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TimelineTrack from './TimelineTrack.svelte';
  import { timelineState, loadTimeline, setPlaying, setZoom } from '../state/timeline.svelte';
  import type { Clip, TimelineState as TimelineStateType } from '../../../shared/types/database';
  
  interface Props {
    projectId: number;
    audioUrls: string[]; // Array of audio URLs, one per track
    trackAssetIds: number[];
    clips: Clip[];
    displayClips?: Clip[];
    initialState?: TimelineStateType | null;
  }
  
  let { projectId, audioUrls, trackAssetIds, clips, displayClips, initialState = null }: Props = $props();
  
  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let lastProjectId = $state<number | null>(null);
  
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

  // Handle wheel for ctrl+scroll zoom
  function handleWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    const multiplier = direction > 0 ? 0.9 : 1.1;
    setZoom(timelineState.zoomLevel * multiplier);
  }
</script>

<div class="timeline" onwheel={handleWheel}>
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
      {#each audioUrls as audioUrl, index (index)}
        <TimelineTrack 
          {audioUrl} 
          assetId={trackAssetIds[index]}
          trackIndex={index} 
          height={100}
          clips={displayClips ?? clips}
        />
      {/each}
    </div>
    
    {#if audioUrls.length === 0}
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
