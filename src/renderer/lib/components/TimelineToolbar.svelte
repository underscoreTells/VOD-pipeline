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

<div class="flex h-[44px] flex-wrap items-center justify-between gap-4 border-b border-border-default bg-surface-base px-4 md:flex-nowrap">
  <div class="flex items-center gap-3">
    <button class="flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-accent-primary text-white transition-colors hover:bg-accent-primary-hover" onclick={togglePlayback} title="Play/Pause (Space, J/K/L shuttle)">
      {#if timelineState.isPlaying}
        <Icon icon={Pause} size={14} />
      {:else}
        <Icon icon={Play} size={14} />
      {/if}
    </button>
    <span class="font-mono text-[1rem] tabular-nums text-text-primary">{formatTimecode(timelineState.playheadTime)}</span>
  </div>

  <div class="flex items-center gap-2">
    <IconButton class="h-7 w-7 border border-border-default bg-transparent text-text-secondary hover:bg-surface-hover" icon={Minus} onclick={zoomOut} title="Zoom Out (-)" />
    <input
      class="timeline-zoom-slider ui-range-thumb-md h-1 w-20 appearance-none rounded-full bg-border-default outline-none md:w-[120px]"
      type="range"
      min="0"
      max="100"
      value={getZoomSliderValue()}
      oninput={handleZoomChange}
      title="Zoom level"
    />
    <button class="flex h-7 w-7 items-center justify-center rounded-xs border border-border-default bg-transparent text-text-secondary transition-colors hover:bg-surface-hover" onclick={zoomIn} title="Zoom In (+)">
      +
    </button>
    <Button size="sm" variant="ghost" onclick={zoomToFit} title="Fit to view (F)">Fit</Button>
  </div>

  <div class="flex items-center gap-2">
    <Button
      size="sm"
      variant="ghost"
      onclick={undo}
      disabled={!canUndo()}
      title={undoDesc ? `Undo: ${undoDesc}` : 'Undo (Ctrl+Z)'}
    >
      Undo
    </Button>
    <Button
      size="sm"
      variant="ghost"
      onclick={redo}
      disabled={!canRedo()}
      title={redoDesc ? `Redo: ${redoDesc}` : 'Redo (Ctrl+Shift+Z)'}
    >
      Redo
    </Button>
  </div>

  <div class="flex items-center gap-2">
    <button
      class={`rounded-xs border px-3 py-1 text-app-sm transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        timelineState.excludeCutContent
          ? 'border-accent-primary bg-accent-primary-subtle text-accent-primary hover:border-accent-primary-hover hover:bg-accent-primary-subtle'
          : 'border-border-default bg-transparent text-text-secondary hover:bg-surface-hover'
      }`}
      onclick={toggleExcludeCutContent}
      title="Exclude cut content (\\)"
      aria-pressed={timelineState.excludeCutContent}
    >
      Exclude cut content
    </button>
  </div>

  <div class="flex items-center gap-2">
    {#if selectionInfo}
      <span class="text-app-sm text-text-tertiary">{selectionInfo}</span>
    {/if}
  </div>
</div>
