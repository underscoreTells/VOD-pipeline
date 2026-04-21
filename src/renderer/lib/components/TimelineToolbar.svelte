<script lang="ts">
  import {
    timelineState,
    togglePlayback,
    toggleExcludeCutContent,
    zoomIn,
    zoomOut,
    zoomToFit,
    setZoom,
  } from '../state/timeline.svelte';
  import { undo, redo, canUndo, canRedo, getLastCommandDescription, getNextRedoDescription } from '../state/undo-redo.svelte';
  import { formatTimecode } from '../state/keyboard.svelte';
  import Button from './ui/Button.svelte';
  import Icon from './ui/Icon.svelte';
  import IconButton from './ui/IconButton.svelte';
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

<div class="flex h-[60px] flex-wrap items-center justify-between gap-4 border-b border-border-default bg-surface-raised px-4 py-2 md:flex-nowrap">
  <div class="flex items-center gap-4">
    <button class="flex h-10 w-10 items-center justify-center rounded-full bg-accent-primary text-white transition-colors hover:bg-accent-primary-hover" onclick={togglePlayback} title="Play/Pause (Space, J/K/L shuttle)">
      {#if timelineState.isPlaying}
        <Icon icon={Pause} size={16} />
      {:else}
        <Icon icon={Play} size={16} />
      {/if}
    </button>
    <span class="font-mono text-[1.1rem] tabular-nums text-text-primary">{formatTimecode(timelineState.playheadTime)}</span>
  </div>

  <div class="flex items-center gap-2">
    <IconButton class="h-8 w-8 border border-border-strong bg-surface-hover text-text-secondary hover:border-border-default" icon={Minus} onclick={zoomOut} title="Zoom Out (-)" />
    <input
      class="timeline-zoom-slider h-1.5 w-20 appearance-none rounded-full bg-border-default outline-none md:w-[120px]"
      type="range"
      min="0"
      max="100"
      value={getZoomSliderValue()}
      oninput={handleZoomChange}
      title="Zoom level"
    />
    <button class="flex h-8 w-8 items-center justify-center rounded-sm border border-border-strong bg-surface-hover text-text-secondary transition-colors hover:border-border-default hover:bg-border-default" onclick={zoomIn} title="Zoom In (+)">
      +
    </button>
    <Button size="sm" variant="secondary" onclick={zoomToFit} title="Fit to view (F)">Fit</Button>
  </div>

  <div class="flex items-center gap-2">
    <Button
      size="sm"
      variant="secondary"
      onclick={undo}
      disabled={!canUndo()}
      title={undoDesc ? `Undo: ${undoDesc}` : 'Undo (Ctrl+Z)'}
    >
      Undo
    </Button>
    <Button
      size="sm"
      variant="secondary"
      onclick={redo}
      disabled={!canRedo()}
      title={redoDesc ? `Redo: ${redoDesc}` : 'Redo (Ctrl+Shift+Z)'}
    >
      Redo
    </Button>
  </div>

  <div class="flex items-center gap-2">
    <button
      class:bg-[#1f2a1f]={timelineState.excludeCutContent}
      class:border-[#2f4a2f]={timelineState.excludeCutContent}
      class:text-[#b7f7c2]={timelineState.excludeCutContent}
      class="rounded-sm border border-border-strong bg-surface-hover px-3 py-1.5 text-app-base text-text-secondary transition-colors hover:border-border-default hover:bg-border-default disabled:pointer-events-none disabled:opacity-40"
      onclick={toggleExcludeCutContent}
      title="Exclude cut content (\\)"
      aria-pressed={timelineState.excludeCutContent}
    >
      Exclude cut content
    </button>
  </div>

  <div class="flex items-center gap-2">
    {#if selectionInfo}
      <span class="text-app-base italic text-text-tertiary">{selectionInfo}</span>
    {/if}
  </div>
</div>

<style lang="postcss">
  @reference "tailwindcss";

  .timeline-zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 9999px;
    background: var(--accent-primary);
    cursor: pointer;
  }

  .timeline-zoom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 9999px;
    background: var(--accent-primary);
    cursor: pointer;
  }
</style>
