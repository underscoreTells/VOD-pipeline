<script lang="ts">
  import { timelineState, getSelectedClips } from '../state/timeline.svelte';
  import { formatTime, formatTimecode } from '../state/keyboard.svelte';
  import { projectDetail } from '../state/project-detail.svelte';
  import { buildAssetUrl } from '../utils/media';
  
  // Get selected clip
  const selectedClip = $derived.by(() => {
    const selected = getSelectedClips();
    return selected.length === 1 ? selected[0] : null;
  });

  const selectedAsset = $derived.by(() => {
    if (!selectedClip) return null;
    return projectDetail.assets.find((asset) => asset.id === selectedClip.asset_id) ?? null;
  });

  const videoSrc = $derived.by(() => {
    return selectedAsset ? buildAssetUrl(selectedAsset.id) : '';
  });
  
  // Video player state
  let videoRef: HTMLVideoElement | null = $state(null);
  let isLooping = $state(true);
  let currentTime = $state(0);
  let lastVideoSrc = '';
  
  // Derived values
  const clipDuration = $derived.by(() => {
    if (!selectedClip) return 0;
    return selectedClip.out_point - selectedClip.in_point;
  });
  
  // Handle nudge buttons
  function nudgeInPoint(delta: number) {
    if (!selectedClip) return;
    const fps = 30;
    const frameDuration = 1 / fps;
    const newInPoint = Math.max(0, selectedClip.in_point + (delta * frameDuration));
    // This would need to update the clip via IPC
    console.log('Nudge in point:', newInPoint);
  }
  
  function nudgeOutPoint(delta: number) {
    if (!selectedClip) return;
    const fps = 30;
    const frameDuration = 1 / fps;
    const newOutPoint = Math.max(selectedClip.in_point + frameDuration, selectedClip.out_point + (delta * frameDuration));
    console.log('Nudge out point:', newOutPoint);
  }
  
  // Video event handlers
  function handleTimeUpdate() {
    if (videoRef) {
      currentTime = videoRef.currentTime;
      if (selectedClip && videoRef.currentTime >= selectedClip.out_point) {
        if (isLooping) {
          videoRef.currentTime = selectedClip.in_point;
          videoRef.play().catch(() => undefined);
        } else {
          videoRef.pause();
          videoRef.currentTime = selectedClip.out_point;
        }
      }
    }
  }
  
  function handleEnded() {
    if (isLooping && videoRef && selectedClip) {
      videoRef.currentTime = selectedClip.in_point;
      videoRef.play().catch(() => undefined);
    }
  }

  function handleVideoLoadedMetadata() {
    if (!videoRef || !selectedClip) return;
    if (videoRef.currentTime < selectedClip.in_point || videoRef.currentTime > selectedClip.out_point) {
      videoRef.currentTime = selectedClip.in_point;
      currentTime = selectedClip.in_point;
    }
  }

  function handleVideoError() {
    const error = videoRef?.error;
    console.error('[ClipPreview] Video playback error', error);
  }

  $effect(() => {
    if (!videoRef) return;
    if (videoSrc && videoSrc !== lastVideoSrc) {
      lastVideoSrc = videoSrc;
      videoRef.load();
    }
  });
  
  // Load clip into video player when selection changes
  $effect(() => {
    if (!videoRef) return;
    if (!selectedClip || !selectedAsset) {
      videoRef.pause();
      currentTime = 0;
      return;
    }

    const seekToClipStart = () => {
      if (!videoRef || !selectedClip) return;
      videoRef.currentTime = selectedClip.in_point;
      currentTime = selectedClip.in_point;
    };

    if (videoRef.readyState >= 1) {
      seekToClipStart();
    } else {
      const onLoaded = () => {
        seekToClipStart();
        videoRef?.removeEventListener('loadedmetadata', onLoaded);
      };
      videoRef.addEventListener('loadedmetadata', onLoaded);
      return () => videoRef?.removeEventListener('loadedmetadata', onLoaded);
    }
  });
</script>

<div class="clip-preview">
  {#if selectedClip}
    <div class="preview-header">
      <h4>Clip Preview</h4>
      <span class="role-badge" data-role={selectedClip.role}>
        {selectedClip.role || 'No role'}
      </span>
    </div>
    
    <div class="video-container">
      <video
        bind:this={videoRef}
        src={videoSrc}
        ontimeupdate={handleTimeUpdate}
        onended={handleEnded}
        onloadedmetadata={handleVideoLoadedMetadata}
        onerror={handleVideoError}
        controls
        class="preview-video"
        preload="metadata"
      >
        <track kind="captions" />
      </video>
      
      <div class="video-overlay">
        <span class="time-display">{formatTimecode(currentTime)}</span>
      </div>
    </div>
    
    <div class="clip-controls">
      <div class="trim-controls">
        <div class="trim-row">
          <span class="trim-label">In:</span>
          <span class="trim-time">{formatTimecode(selectedClip.in_point)}</span>
          <div class="trim-buttons">
            <button onclick={() => nudgeInPoint(-1)} title="-1 frame">◀</button>
            <button onclick={() => nudgeInPoint(1)} title="+1 frame">▶</button>
          </div>
        </div>
        
        <div class="trim-row">
          <span class="trim-label">Out:</span>
          <span class="trim-time">{formatTimecode(selectedClip.out_point)}</span>
          <div class="trim-buttons">
            <button onclick={() => nudgeOutPoint(-1)} title="-1 frame">◀</button>
            <button onclick={() => nudgeOutPoint(1)} title="+1 frame">▶</button>
          </div>
        </div>
      </div>
      
      <div class="playback-controls">
        <label class="loop-toggle">
          <input type="checkbox" bind:checked={isLooping} />
          <span>Loop</span>
        </label>
        <span class="duration">Duration: {formatTime(clipDuration)}</span>
      </div>
    </div>
    
    <div class="clip-info">
      {#if selectedClip.description}
        <p class="description">{selectedClip.description}</p>
      {:else}
        <p class="description empty">No description</p>
      {/if}
      
      <div class="meta">
        <span>Track {selectedClip.track_index + 1}</span>
        <span>•</span>
        <span>{selectedClip.is_essential ? 'Essential' : 'Optional'}</span>
      </div>
    </div>
  {:else}
    <div class="empty-state">
      <p>Select a clip to preview</p>
    </div>
  {/if}
</div>

<style>
  .clip-preview {
    background: #1a1a1a;
    border-top: 1px solid #333;
    padding: 1rem;
    min-height: 300px;
  }
  
  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .preview-header h4 {
    margin: 0;
    font-size: 0.875rem;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  
  .role-badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 12px;
    background: #333;
    color: #888;
    text-transform: capitalize;
  }
  
  .role-badge[data-role="setup"] { background: #ef444420; color: #ef4444; }
  .role-badge[data-role="escalation"] { background: #f9731620; color: #f97316; }
  .role-badge[data-role="twist"] { background: #eab30820; color: #eab308; }
  .role-badge[data-role="payoff"] { background: #22c55e20; color: #22c55e; }
  .role-badge[data-role="transition"] { background: #3b82f620; color: #3b82f6; }
  
  .video-container {
    position: relative;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 1rem;
    aspect-ratio: 16/9;
  }
  
  .preview-video {
    width: 100%;
    height: 100%;
    display: block;
  }
  
  .video-overlay {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    background: rgba(0, 0, 0, 0.7);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.875rem;
    color: #fff;
    pointer-events: none;
  }
  
  .clip-controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  
  .trim-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .trim-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .trim-label {
    width: 40px;
    font-size: 0.75rem;
    color: #888;
    text-transform: uppercase;
  }
  
  .trim-time {
    flex: 1;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.875rem;
    color: #ccc;
  }
  
  .trim-buttons {
    display: flex;
    gap: 0.25rem;
  }
  
  .trim-buttons button {
    width: 28px;
    height: 28px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #888;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.75rem;
    transition: all 0.15s;
  }
  
  .trim-buttons button:hover {
    background: #333;
    border-color: #555;
    color: #fff;
  }
  
  .playback-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.5rem;
    border-top: 1px solid #333;
  }
  
  .loop-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: #888;
    cursor: pointer;
  }
  
  .loop-toggle input {
    cursor: pointer;
  }
  
  .duration {
    font-size: 0.75rem;
    color: #666;
    font-family: 'SF Mono', Monaco, monospace;
  }
  
  .clip-info {
    padding-top: 0.5rem;
    border-top: 1px solid #333;
  }
  
  .description {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    color: #ccc;
    line-height: 1.4;
  }
  
  .description.empty {
    color: #666;
    font-style: italic;
  }
  
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: #888;
  }
  
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: #666;
    font-size: 0.875rem;
  }
</style>
