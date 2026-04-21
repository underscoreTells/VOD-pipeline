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
  import Icon from './ui/Icon.svelte';
  import { Play, Pause, Minus } from '../constants';

  const MAX_ZOOM_LEVEL = 1000;
  
  function handleZoomChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    const minZoom = Math.max(0.05, timelineState.minZoomLevel);
    const zoomRatio = MAX_ZOOM_LEVEL / minZoom;
    const logValue = minZoom * Math.pow(zoomRatio, value / 100);
    setZoom(logValue);
  }

  function getZoomSliderValue(): number {
    const minZoom = Math.max(0.05, timelineState.minZoomLevel);
    const zoomRatio = MAX_ZOOM_LEVEL / minZoom;
    if (!Number.isFinite(zoomRatio) || zoomRatio <= 1) {
      return 0;
    }
    return (Math.log(timelineState.zoomLevel / minZoom) / Math.log(zoomRatio)) * 100;
  }
  
  const selectionInfo = $derived.by(() => {
    const count = timelineState.selectedClipIds.size;
    if (count === 0) return '';
    if (count === 1) return '1 clip selected';
    return `${count} clips selected`;
  });
  
  const undoDesc = $derived.by(() => getLastCommandDescription());
  const redoDesc = $derived.by(() => getNextRedoDescription());
</script>

<div class="toolbar">
  <div class="toolbar-section playback">
    <button class="play-btn" onclick={togglePlayback} title="Play/Pause (Space, J/K/L shuttle)">
      {#if timelineState.isPlaying}<Icon icon={Pause} size={16} />{:else}<Icon icon={Play} size={16} />{/if}
    </button>
    <span class="timecode">{formatTimecode(timelineState.playheadTime)}</span>
  </div>
  
  <div class="toolbar-section zoom">
    <button class="icon-btn" onclick={zoomOut} title="Zoom Out (-)"><Icon icon={Minus} size={14} /></button>
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
      title="Exclude cut content (\\)"
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
    padding: var(--space-2) var(--space-4);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
    height: 60px;
    gap: var(--space-4);
  }
  
  .toolbar-section {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  
  .playback {
    gap: var(--space-4);
  }
  
  .play-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: var(--accent-primary);
    color: var(--text-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    transition: background 0.2s;
  }
  
  .play-btn:hover {
    background: var(--accent-primary-hover);
  }
  
  .timecode {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 1.1rem;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  
  .icon-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-strong);
    background: var(--surface-hover);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    transition: all 0.2s;
  }
  
  .icon-btn:hover {
    background: var(--border-default);
    border-color: #555;
  }
  
  .text-btn {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border-strong);
    background: var(--surface-hover);
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    transition: all 0.2s;
  }
  
  .text-btn:hover:not(:disabled) {
    background: var(--border-default);
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
    background: var(--border-default);
    border-radius: 3px;
    outline: none;
  }
  
  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: pointer;
  }
  
  .zoom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
  
  .selection-info {
    font-size: var(--text-base);
    color: var(--text-tertiary);
    font-style: italic;
  }
  
  @media (max-width: 768px) {
    .toolbar {
      flex-wrap: wrap;
      height: auto;
      padding: var(--space-2);
    }
    
    .zoom-slider {
      width: 80px;
    }
  }
</style>
