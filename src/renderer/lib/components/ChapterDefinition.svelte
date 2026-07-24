<script lang="ts">
  import { onMount } from 'svelte';
  import type { Asset, VodCutRange } from '$shared/types/database';
  import type { AssetAvailability } from '$shared/contracts/ipc';
  import { clearVodCutDraft, loadVodCutDraft, saveVodCutDraft } from '../api/vod-cuts.js';
  import {
    addVodCutRange,
    canRedoVodCut,
    canUndoVodCut,
    clearVodCut,
    clearVodCutPendingRange,
    deleteVodCutRange,
    initializeVodCut,
    markVodCutIn,
    markVodCutOut,
    markVodCutSaved,
    redoVodCut,
    selectVodCutRange,
    setVodCutDuration,
    setVodCutError,
    setVodCutPendingRange,
    setVodCutPlayhead,
    setVodCutSaving,
    undoVodCut,
    updateVodCutRange,
    vodCutState,
  } from '../state/vod-cut.svelte.js';
  import { buildPlayableAssetUrl, setPitchPreservingPlaybackRate } from '../utils/media.js';
  import { createQueuedMediaSeek } from '../utils/queuedMediaSeek.js';
  import { formatTime, formatTimePrecise } from '../utils/time.js';
  import { settingsState } from '../state/settings.svelte.js';
  import {
    getArrowNavigationDelta,
    isEditableKeyboardTarget,
    nextShuttleSpeed,
  } from '../utils/transport-shortcuts.js';
  import VodCutTimeline from './vod-cut/VodCutTimeline.svelte';

  type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };

  interface Props {
    asset: AvailabilityAwareAsset;
    projectId: number;
    onComplete: (ranges: VodCutRange[]) => void | Promise<void>;
    onCancel: () => void | Promise<void>;
    onDiscard: () => void | Promise<void>;
  }

  let { asset, projectId, onComplete, onCancel, onDiscard }: Props = $props();

  let videoRef = $state<HTMLVideoElement | null>(null);
  let isPlaying = $state(false);
  let isReady = $state(false);
  let isCompleting = $state(false);
  let discardArmed = $state(false);
  let previewRangeId = $state<string | null>(null);
  let shuttleDirection = $state<-1 | 0 | 1>(0);
  let shuttleSpeed = $state(1);
  let mediaDuration = $state(0);
  let saveTimer: number | null = null;
  let preserveDraftOnCleanup = true;
  let reverseAnimationFrame: number | null = null;
  let reversePreviousTime: number | null = null;
  const videoSrc = $derived(buildPlayableAssetUrl(asset));
  const assetUnavailable = $derived(asset.availability?.exists === false);
  const selectedRange = $derived(vodCutState.ranges.find((range) => range.id === vodCutState.selectedRangeId) ?? null);
  const pendingDuration = $derived(
    vodCutState.pendingIn !== null && vodCutState.pendingOut !== null
      ? Math.abs(vodCutState.pendingOut - vodCutState.pendingIn)
      : 0,
  );

  const seekController = createQueuedMediaSeek({
    getVideo: () => videoRef,
    normalizeTime: (time) => Math.min(vodCutState.duration, Math.max(0, time)),
    snapPreviewTime: (time) => {
      const fps = Math.max(1, Math.min(240, asset.metadata?.fps ?? 24));
      return Math.round(time * fps) / fps;
    },
  });

  function handleVideoTimeUpdate(): void {
    if (!videoRef || videoRef.seeking) return;
    setVodCutPlayhead(videoRef.currentTime);
    if (previewRangeId) {
      const range = vodCutState.ranges.find((item) => item.id === previewRangeId);
      if (!range || videoRef.currentTime >= range.end_time) {
        videoRef.pause();
        isPlaying = false;
        previewRangeId = null;
        if (range) {
          videoRef.currentTime = range.end_time;
          setVodCutPlayhead(range.end_time);
        }
      }
    }
  }

  function handleSeeked(): void {
    seekController.handleSeeked();
  }

  function handleLoadedMetadata(): void {
    if (!videoRef || !Number.isFinite(videoRef.duration) || videoRef.duration <= 0) return;
    mediaDuration = videoRef.duration;
    setVodCutDuration(videoRef.duration);
  }

  function handleTimelineSeek(time: number, commit: boolean): void {
    if (!videoRef || assetUnavailable) return;
    if (!videoRef.paused) videoRef.pause();
    isPlaying = false;
    stopVodShuttle();
    previewRangeId = null;
    if (commit) seekController.commit(time);
    else seekController.preview(time);
  }

  async function togglePlayback(): Promise<void> {
    if (!videoRef || assetUnavailable) return;
    previewRangeId = null;
    if (isPlaying) {
      stopVodShuttle();
      return;
    }
    shuttleDirection = 1;
    shuttleSpeed = 1;
    setPitchPreservingPlaybackRate(videoRef, 1);
    await videoRef.play();
    isPlaying = true;
  }

  function stopVodShuttle(): void {
    if (reverseAnimationFrame !== null) cancelAnimationFrame(reverseAnimationFrame);
    reverseAnimationFrame = null;
    reversePreviousTime = null;
    shuttleDirection = 0;
    shuttleSpeed = 1;
    if (videoRef && !videoRef.paused) videoRef.pause();
    if (videoRef) setPitchPreservingPlaybackRate(videoRef, 1);
    isPlaying = false;
  }

  async function shuttleForward(): Promise<void> {
    if (!videoRef || assetUnavailable) return;
    if (reverseAnimationFrame !== null) cancelAnimationFrame(reverseAnimationFrame);
    reverseAnimationFrame = null;
    reversePreviousTime = null;
    shuttleSpeed = shuttleDirection === 1 ? nextShuttleSpeed(shuttleSpeed) : 1;
    shuttleDirection = 1;
    setPitchPreservingPlaybackRate(videoRef, shuttleSpeed);
    await videoRef.play();
    isPlaying = true;
  }

  function shuttleReverse(): void {
    if (!videoRef || assetUnavailable) return;
    shuttleSpeed = shuttleDirection === -1 ? nextShuttleSpeed(shuttleSpeed) : 1;
    shuttleDirection = -1;
    if (!videoRef.paused) videoRef.pause();
    isPlaying = true;
    if (reverseAnimationFrame === null) reverseAnimationFrame = requestAnimationFrame(stepReverseShuttle);
  }

  function stepReverseShuttle(timestamp: number): void {
    reverseAnimationFrame = null;
    if (!videoRef || shuttleDirection !== -1) return;
    const elapsed = reversePreviousTime === null ? 0 : Math.min(0.1, (timestamp - reversePreviousTime) / 1000);
    reversePreviousTime = timestamp;
    const next = Math.max(0, videoRef.currentTime - elapsed * shuttleSpeed);
    videoRef.currentTime = next;
    setVodCutPlayhead(next);
    if (next <= 0) {
      stopVodShuttle();
      return;
    }
    reverseAnimationFrame = requestAnimationFrame(stepReverseShuttle);
  }

  async function previewRange(range: VodCutRange): Promise<void> {
    if (!videoRef || assetUnavailable) return;
    selectVodCutRange(range.id);
    previewRangeId = range.id;
    setVodCutPlayhead(range.start_time);
    seekController.commit(range.start_time);
    await videoRef.play();
    isPlaying = true;
  }

  function addPendingRange(): void {
    addVodCutRange();
  }

  function handleRangeTimeChange(range: VodCutRange, edge: 'start_time' | 'end_time', value: string): void {
    const parts = value.trim().split(':');
    if (parts.length === 0 || parts.length > 3) {
      setVodCutError('Use a time such as 1:23:45.12 or 12:34.');
      return;
    }
    const values = parts.map(Number);
    const parsed = values.some((part) => !Number.isFinite(part) || part < 0)
      ? null
      : values.reduce((total, part) => total * 60 + part, 0);
    if (parsed === null) {
      setVodCutError('Use a time such as 1:23:45.12 or 12:34.');
      return;
    }
    updateVodCutRange(range.id, { [edge]: parsed });
  }

  async function saveNow(): Promise<boolean> {
    if (!isReady || !vodCutState.projectId || !vodCutState.assetId) return false;
    if (!vodCutState.dirty && vodCutState.lastSavedAt) return true;
    const projectIdAtSave = vodCutState.projectId;
    const assetIdAtSave = vodCutState.assetId;
    const savedRevision = vodCutState.revision;
    const rangesAtSave = vodCutState.ranges.map((range) => ({ ...range }));
    setVodCutSaving(true);
    let result;
    try {
      result = await saveVodCutDraft({
        projectId: projectIdAtSave,
        assetId: assetIdAtSave,
        ranges: rangesAtSave,
        view: {
          playheadTime: vodCutState.playheadTime,
          pixelsPerSecond: vodCutState.pixelsPerSecond,
          scrollLeft: vodCutState.scrollLeft,
        },
      });
    } catch (error) {
      setVodCutSaving(false);
      setVodCutError(error instanceof Error ? error.message : String(error));
      return false;
    }
    if (!result.success || !result.data) {
      setVodCutSaving(false);
      setVodCutError(result.error || 'Could not save this VOD cut draft.');
      return false;
    }
    if (
      vodCutState.projectId === projectIdAtSave
      && vodCutState.assetId === assetIdAtSave
    ) {
      markVodCutSaved(result.data.updated_at, savedRevision);
    }
    return true;
  }

  async function handleBack(): Promise<void> {
    const saved = await saveNow();
    if (!saved) return;
    clearVodCut();
    await onCancel();
  }

  async function handleDiscard(): Promise<void> {
    if (!discardArmed) {
      discardArmed = true;
      return;
    }
    try {
      await clearVodCutDraft(projectId, asset.id);
      clearVodCut();
      await onDiscard();
    } catch (error) {
      discardArmed = false;
      setVodCutError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleComplete(): Promise<void> {
    if (vodCutState.ranges.length === 0 || isCompleting) return;
    isCompleting = true;
    preserveDraftOnCleanup = false;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await onComplete(vodCutState.ranges);
    } catch (error) {
      preserveDraftOnCleanup = true;
      setVodCutError(error instanceof Error ? error.message : String(error));
    } finally {
      isCompleting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!isReady) return;
    if (isEditableKeyboardTarget(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoVodCut();
      else undoVodCut();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const time = vodCutState.playheadTime + (getArrowNavigationDelta({
        key: event.key,
        shiftKey: event.shiftKey,
        fps: vodCutState.fps,
        coarseJumpSeconds: settingsState.settings.coarseJumpSeconds,
      }) ?? 0);
      setVodCutPlayhead(time);
      handleTimelineSeek(vodCutState.playheadTime, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const time = vodCutState.playheadTime + (getArrowNavigationDelta({
        key: event.key,
        shiftKey: event.shiftKey,
        fps: vodCutState.fps,
        coarseJumpSeconds: settingsState.settings.coarseJumpSeconds,
      }) ?? 0);
      setVodCutPlayhead(time);
      handleTimelineSeek(vodCutState.playheadTime, true);
    } else if (event.key.toLowerCase() === 'j') {
      event.preventDefault();
      shuttleReverse();
    } else if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      stopVodShuttle();
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      void shuttleForward();
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      markVodCutIn();
    } else if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      markVodCutOut();
    } else if (event.key === 'Enter' && pendingDuration > 0) {
      event.preventDefault();
      addPendingRange();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearVodCutPendingRange();
      selectVodCutRange(null);
      discardArmed = false;
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && vodCutState.selectedRangeId) {
      event.preventDefault();
      deleteVodCutRange(vodCutState.selectedRangeId);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setVodCutPlayhead(0);
      handleTimelineSeek(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      setVodCutPlayhead(vodCutState.duration);
      handleTimelineSeek(vodCutState.duration, true);
    }
  }

  $effect(() => {
    if (!isReady || isCompleting || !vodCutState.dirty || vodCutState.isSaving) return;
    const rangeSignature = vodCutState.ranges.map((range) => `${range.id}:${range.title}:${range.start_time}:${range.end_time}`).join('|');
    const viewSignature = `${vodCutState.playheadTime}:${vodCutState.pixelsPerSecond}:${vodCutState.scrollLeft}`;
    void rangeSignature;
    void viewSignature;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, 800);
    return () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
    };
  });

  onMount(() => {
    initializeVodCut({
      projectId,
      assetId: asset.id,
      duration: mediaDuration || asset.duration || 0,
      fps: asset.metadata?.fps,
    });
    const initialize = async () => {
      const result = await loadVodCutDraft(projectId, asset.id);
      initializeVodCut({
        projectId,
        assetId: asset.id,
        duration: mediaDuration || asset.duration || 0,
        fps: asset.metadata?.fps,
        draft: result.success ? result.data : null,
      });
      if (!result.success) setVodCutError(result.error || 'Could not load the saved VOD cut draft.');
      isReady = true;
    };
    void initialize();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      seekController.reset();
      stopVodShuttle();
      const pendingDraft = preserveDraftOnCleanup && vodCutState.dirty && vodCutState.projectId && vodCutState.assetId
        ? {
            projectId: vodCutState.projectId,
            assetId: vodCutState.assetId,
            ranges: vodCutState.ranges.map((range) => ({ ...range })),
            view: {
              playheadTime: vodCutState.playheadTime,
              pixelsPerSecond: vodCutState.pixelsPerSecond,
              scrollLeft: vodCutState.scrollLeft,
            },
          }
        : null;
      clearVodCut();
      if (pendingDraft) {
        void saveVodCutDraft(pendingDraft).catch((error) => {
          console.error('[VodCut] Failed to save draft during cleanup:', error);
        });
      }
    };
  });
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden bg-surface-page" aria-label="Cut VOD into chapters">
  <header class="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border-default bg-surface-base px-5 py-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="m-0 truncate text-app-lg font-semibold text-text-primary">Cut VOD into chapters</h2>
        <span class="rounded-sm border border-border-default bg-surface-raised px-2 py-0.5 text-app-xs text-text-tertiary">
          {vodCutState.isLoading ? 'Loading draft...' : vodCutState.isSaving ? 'Saving...' : vodCutState.dirty ? 'Unsaved' : vodCutState.lastSavedAt ? 'Draft saved' : 'New draft'}
        </span>
      </div>
      <p class="mt-1 truncate text-app-sm text-text-tertiary">{asset.file_path.split(/[/\\]/).pop()} · {formatTime(vodCutState.duration)} · {vodCutState.ranges.length} chapter{vodCutState.ranges.length === 1 ? '' : 's'}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button class="rounded-sm border border-border-default px-3 py-2 text-app-sm text-text-secondary hover:bg-surface-hover" onclick={handleBack}>Save & exit</button>
      <button
        class="rounded-sm border border-accent-destructive/50 px-3 py-2 text-app-sm text-accent-destructive hover:bg-accent-destructive/10"
        onclick={handleDiscard}
        onblur={() => discardArmed = false}
      >{discardArmed ? 'Click again to discard' : 'Discard import'}</button>
      <button
        class="rounded-sm bg-accent-primary px-4 py-2 text-app-sm font-semibold text-white hover:bg-accent-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
        onclick={handleComplete}
        disabled={vodCutState.ranges.length === 0 || isCompleting}
      >{isCompleting ? 'Creating chapters...' : `Create ${vodCutState.ranges.length} chapters`}</button>
    </div>
  </header>

  {#if vodCutState.error}
    <div class="flex shrink-0 items-center justify-between border-b border-accent-destructive/30 bg-accent-destructive/10 px-5 py-2 text-app-sm text-accent-destructive">
      <span>{vodCutState.error}</span>
      <button class="px-2 py-1" onclick={() => setVodCutError(null)} aria-label="Dismiss error">Dismiss</button>
    </div>
  {/if}

  <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] max-[980px]:grid-cols-1 max-[980px]:grid-rows-[minmax(0,1fr)_280px]">
    <main class="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-4">
      <section class="relative min-h-[260px] flex-1 overflow-hidden rounded-lg border border-border-default bg-black">
        {#if assetUnavailable}
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-raised p-6 text-center">
            <p class="font-semibold text-text-primary">The VOD source is unavailable</p>
            <p class="max-w-[65ch] break-all text-app-sm text-text-tertiary">{asset.availability?.savedPath ?? asset.file_path}</p>
          </div>
        {:else}
          <video
            bind:this={videoRef}
            class="h-full w-full object-contain"
            src={videoSrc}
            preload="metadata"
            playsinline
            ontimeupdate={handleVideoTimeUpdate}
            onseeked={handleSeeked}
            onloadedmetadata={handleLoadedMetadata}
            onplay={() => isPlaying = true}
            onpause={() => { if (shuttleDirection !== -1) isPlaying = false; }}
          ><track kind="captions" /></video>
        {/if}
        <div class="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/75 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md">
          <button class="h-8 min-w-16 rounded-sm bg-white px-3 text-app-sm font-semibold text-[#161616] active:translate-y-px disabled:opacity-40" onclick={togglePlayback} disabled={assetUnavailable || !isReady}>{isPlaying ? 'Pause' : 'Play'}</button>
          <button class="h-8 rounded-sm border border-white/15 px-3 text-app-sm text-white/80 hover:bg-white/10 disabled:opacity-40" onclick={() => { setVodCutPlayhead(vodCutState.playheadTime - settingsState.settings.coarseJumpSeconds); handleTimelineSeek(vodCutState.playheadTime, true); }} disabled={!isReady}>-{settingsState.settings.coarseJumpSeconds}s</button>
          <button class="h-8 rounded-sm border border-white/15 px-3 text-app-sm text-white/80 hover:bg-white/10 disabled:opacity-40" onclick={() => { setVodCutPlayhead(vodCutState.playheadTime + settingsState.settings.coarseJumpSeconds); handleTimelineSeek(vodCutState.playheadTime, true); }} disabled={!isReady}>+{settingsState.settings.coarseJumpSeconds}s</button>
          <span class="ml-auto font-mono text-app-sm tabular-nums text-white/85">{formatTimePrecise(vodCutState.playheadTime)}</span>
        </div>
      </section>

      <div class="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-surface-base p-2">
        <button class="rounded-sm border border-border-default px-3 py-2 text-app-sm text-text-secondary hover:bg-surface-hover disabled:opacity-40" onclick={() => markVodCutIn()} disabled={!isReady}>Mark In <kbd class="ml-1 text-app-xs text-text-disabled">I</kbd></button>
        <button class="rounded-sm border border-border-default px-3 py-2 text-app-sm text-text-secondary hover:bg-surface-hover disabled:opacity-40" onclick={() => markVodCutOut()} disabled={!isReady}>Mark Out <kbd class="ml-1 text-app-xs text-text-disabled">O</kbd></button>
        <div class="min-w-0 flex-1 px-2 font-mono text-app-sm tabular-nums text-text-tertiary">
          {#if vodCutState.pendingIn !== null}
            {formatTimePrecise(vodCutState.pendingIn)} → {vodCutState.pendingOut === null ? 'Mark an out point' : `${formatTimePrecise(vodCutState.pendingOut)} · ${formatTimePrecise(pendingDuration)}`}
          {:else}
            Drag the chapter lane, or mark an In and Out point.
          {/if}
        </div>
        <button class="rounded-sm px-3 py-2 text-app-sm text-text-tertiary hover:bg-surface-hover disabled:opacity-40" onclick={clearVodCutPendingRange} disabled={vodCutState.pendingIn === null}>Clear</button>
        <button class="rounded-sm bg-accent-primary px-3 py-2 text-app-sm font-semibold text-white hover:bg-accent-primary-hover disabled:opacity-40" onclick={addPendingRange} disabled={pendingDuration <= 0}>Add chapter <kbd class="ml-1 text-app-xs text-white/70">Enter</kbd></button>
      </div>

      {#if isReady}
        <VodCutTimeline assetId={asset.id} disabled={assetUnavailable} onSeekPreview={handleTimelineSeek} />
      {:else}
        <div class="min-h-[240px] animate-pulse rounded-lg border border-border-default bg-surface-raised"></div>
      {/if}
    </main>

    <aside class="flex min-h-0 flex-col border-l border-border-default bg-surface-base max-[980px]:border-l-0 max-[980px]:border-t">
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-border-default px-3">
        <div>
          <h3 class="m-0 text-app-sm font-semibold text-text-primary">Chapter ranges</h3>
          <p class="m-0 text-app-xs text-text-disabled">Gaps are omitted from the finished project</p>
        </div>
        <div class="flex items-center gap-1">
          <button class="rounded-sm px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover disabled:opacity-30" onclick={undoVodCut} disabled={!canUndoVodCut()}>Undo</button>
          <button class="rounded-sm px-2 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover disabled:opacity-30" onclick={redoVodCut} disabled={!canRedoVodCut()}>Redo</button>
        </div>
      </div>

      <div class="scrollbar-thin flex-1 overflow-y-auto p-2">
        {#if vodCutState.ranges.length === 0}
          <div class="flex h-full min-h-44 flex-col items-center justify-center px-6 text-center">
            <p class="font-medium text-text-secondary">No chapter ranges yet</p>
            <p class="mt-2 text-app-sm leading-5 text-text-disabled">Drag across the chapter lane below the waveform to keep your first range.</p>
          </div>
        {:else}
          <div class="flex flex-col gap-2">
            {#each vodCutState.ranges as range, index (range.id)}
              <article
                class="rounded-md border p-3 transition-colors"
                class:border-accent-primary={vodCutState.selectedRangeId === range.id}
                class:bg-accent-primary-subtle={vodCutState.selectedRangeId === range.id}
                class:border-border-default={vodCutState.selectedRangeId !== range.id}
                class:bg-surface-raised={vodCutState.selectedRangeId !== range.id}
              >
                <div class="mb-2 flex items-center gap-2">
                  <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-surface-active font-mono text-app-xs text-text-tertiary">{index + 1}</span>
                  <button
                    class="rounded-sm px-1.5 py-1 text-app-xs text-text-tertiary hover:bg-surface-hover hover:text-text-primary"
                    onclick={() => { selectVodCutRange(range.id); setVodCutPlayhead(range.start_time); handleTimelineSeek(range.start_time, true); }}
                    aria-label={`Jump to ${range.title}`}
                  >Jump</button>
                  <input
                    class="min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-app-sm font-medium text-text-primary hover:border-border-default focus:border-accent-primary"
                    value={range.title}
                    onclick={(event) => event.stopPropagation()}
                    onchange={(event) => updateVodCutRange(range.id, { title: event.currentTarget.value })}
                    aria-label={`Chapter ${index + 1} title`}
                  />
                  <button class="rounded-sm px-1.5 py-1 text-app-xs text-accent-destructive hover:bg-accent-destructive/10" onclick={(event) => { event.stopPropagation(); deleteVodCutRange(range.id); }} aria-label={`Delete ${range.title}`}>Delete</button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <label class="text-app-xs text-text-disabled">In
                    <input class="mt-1 w-full rounded-sm border border-border-default bg-surface-base px-2 py-1 font-mono text-app-xs tabular-nums text-text-secondary" value={formatTimePrecise(range.start_time)} onclick={(event) => event.stopPropagation()} onchange={(event) => handleRangeTimeChange(range, 'start_time', event.currentTarget.value)} />
                  </label>
                  <label class="text-app-xs text-text-disabled">Out
                    <input class="mt-1 w-full rounded-sm border border-border-default bg-surface-base px-2 py-1 font-mono text-app-xs tabular-nums text-text-secondary" value={formatTimePrecise(range.end_time)} onclick={(event) => event.stopPropagation()} onchange={(event) => handleRangeTimeChange(range, 'end_time', event.currentTarget.value)} />
                  </label>
                </div>
                <div class="mt-2 flex items-center justify-between text-app-xs text-text-disabled">
                  <span>{formatTime(range.end_time - range.start_time)} kept</span>
                  <button class="rounded-sm px-2 py-1 text-text-tertiary hover:bg-surface-hover hover:text-text-primary" onclick={(event) => { event.stopPropagation(); void previewRange(range); }}>{previewRangeId === range.id ? 'Playing...' : 'Preview'}</button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </div>

      {#if selectedRange}
        <div class="shrink-0 border-t border-border-default px-3 py-2 text-app-xs text-text-tertiary">Selected: {selectedRange.title} · {formatTime(selectedRange.end_time - selectedRange.start_time)}</div>
      {/if}
    </aside>
  </div>
</div>
