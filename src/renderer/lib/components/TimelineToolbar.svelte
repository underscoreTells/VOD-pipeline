<script lang="ts">
  import {
    timelineState,
    togglePlayback,
    toggleExcludeCutContent,
    zoomIn,
    zoomOut,
    zoomToFit,
    setZoom,
    getTotalDuration,
  } from '../state/timeline.svelte';
  import { undo, redo, canUndo, canRedo, getLastCommandDescription, getNextRedoDescription } from '../state/undo-redo.svelte';
  import { formatTimecode } from '../state/keyboard.svelte';
  
  // Play/Pause icon
  function getPlayIcon() {
    return timelineState.isPlaying ? '⏸' : '▶';
  }
  
  // Zoom slider logarithmic scale
  function handleZoomChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    // Logarithmic scale: 10-1000
    const logValue = 10 * Math.pow(100, value / 100);
    setZoom(logValue);
  }
  
  // Convert current zoom to slider value
  function getZoomSliderValue(): number {
    return (Math.log(timelineState.zoomLevel / 10) / Math.log(100)) * 100;
  }
  
  // Selection info
  const selectionInfo = $derived.by(() => {
    const count = timelineState.selectedClipIds.size;
    if (count === 0) return '';
    if (count === 1) return '1 clip selected';
    return `${count} clips selected`;
  });
  
  // Undo/Redo descriptions
  const undoDesc = $derived.by(() => getLastCommandDescription());
  const redoDesc = $derived.by(() => getNextRedoDescription());
</script>

<div class="toolbar">
  <div class="toolbar-section playback">
    <button class="play-btn" onclick={togglePlayback} title="Play/Pause (Space)">
      <span class="icon">{getPlayIcon()}</span>
    </button>
    <span class="timecode">{formatTimecode(timelineState.playheadTime)}</span>
  </div>
  
  <div class="toolbar-section zoom">
    <button class="icon-btn" onclick={zoomOut} title="Zoom Out (-)">−</button>
    <input 
      type="range" 
      min="0" 
      max="100" 
      value={getZoomSliderValue()}
      oninput={handleZoomChange}
      class="zoom-slider"
      title="Zoom level"
    />
    <button class="icon-btn" onclick={zoomIn} title="Zoom In (+)">+</button>
    <button class="text-btn" onclick={zoomToFit} title="Fit to view (F)">Fit</button>
  </div>
  
  <div class="toolbar-section history">
    <button 
      class="text-btn" 
      onclick={undo} 
      disabled={!canUndo()}
      title={undoDesc ? `Undo: ${undoDesc}` : 'Undo (Ctrl+Z)'}
    >
      Undo
    </button>
    <button 
      class="text-btn" 
      onclick={redo} 
      disabled={!canRedo()}
      title={redoDesc ? `Redo: ${redoDesc}` : 'Redo (Ctrl+Shift+Z)'}
    >
      Redo
    </button>
  </div>

  <div class="toolbar-section toggle">
    <button
      class="text-btn toggle-btn"
      class:active={timelineState.excludeCutContent}
      onclick={toggleExcludeCutContent}
      title="Exclude cut content (skip gaps while playing)"
      aria-pressed={timelineState.excludeCutContent}
    >
      Exclude cut content
    </button>
  </div>
  
  <div class="toolbar-section info">
    {#if selectionInfo}
      <span class="selection-info">{selectionInfo}</span>
    {/if}
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: #1e1e1e;
    border-bottom: 1px solid #333;
    height: 60px;
    gap: 1rem;
  }
  
  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .playback {
    gap: 1rem;
  }
  
  .play-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: #007bff;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    transition: background 0.2s;
  }
  
  .play-btn:hover {
    background: #0056b3;
  }
  
  .timecode {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 1.1rem;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  
  .icon-btn {
    width: 32px;
    height: 32px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    transition: all 0.2s;
  }
  
  .icon-btn:hover {
    background: #333;
    border-color: #555;
  }
  
  .text-btn {
    padding: 0.4rem 0.8rem;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
  }
  
  .text-btn:hover:not(:disabled) {
    background: #333;
    border-color: #555;
  }

  .toggle-btn.active {
    background: #1f2a1f;
    border-color: #2f4a2f;
    color: #b7f7c2;
  }
  
  .text-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .zoom-slider {
    width: 120px;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: #333;
    border-radius: 3px;
    outline: none;
  }
  
  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: #007bff;
    border-radius: 50%;
    cursor: pointer;
  }
  
  .zoom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: #007bff;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
  
  .selection-info {
    font-size: 0.875rem;
    color: #888;
    font-style: italic;
  }
  
  @media (max-width: 768px) {
    .toolbar {
      flex-wrap: wrap;
      height: auto;
      padding: 0.5rem;
    }
    
    .zoom-slider {
      width: 80px;
    }
  }
</style>
