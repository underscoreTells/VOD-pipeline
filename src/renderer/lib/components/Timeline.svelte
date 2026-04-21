<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import TimelineTrack from './TimelineTrack.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import Spinner from './ui/Spinner.svelte';
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

  function handleWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    const multiplier = direction > 0 ? 0.9 : 1.1;
    setZoom(timelineState.zoomLevel * multiplier);
  }
</script>

<div class="flex h-full flex-col overflow-hidden bg-surface-page" onwheel={handleWheel} bind:this={timelineRef}>
  {#if isLoading}
    <div class="flex h-full flex-col items-center justify-center gap-4 px-8 text-text-tertiary">
      <Spinner />
      <p>Loading timeline...</p>
    </div>
  {:else if error}
    <div class="flex h-full flex-col items-center justify-center px-8 text-accent-destructive">
      <p>Error: {error}</p>
    </div>
  {:else}
    <div class="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden">
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
      <EmptyState title="No audio tracks loaded" description="Import a video to see the timeline" />
    {/if}
  {/if}
</div>
