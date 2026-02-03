# Editor Fixes Implementation Plan (Detailed)

## Overview

This plan addresses the seven blocking issues in the editor experience:

1. Chapter preview allows scrubbing outside bounds.
2. No manual clip creation in chapter editing view.
3. Missing shortcuts (space, ctrl+scroll zoom, ctrl+b in/out).
4. Editing portal layout/scrolling is broken and oversized.
5. Agent chat says "open project" despite project being open.
6. Transcripts are not visibly generated.
7. UX needs immediate quality-of-life improvements to make rough-cut creation effortless.

The focus is to fix functional blockers first, then add minimal UX improvements that reduce friction without redesigning the app.

## Methodology

1. Reproduce each issue in `pnpm dev` and capture console output.
2. Implement in small vertical slices (UI -> state -> IPC -> renderer state sync).
3. Add temporary logs only when needed, remove before finishing the slice.
4. Prefer minimal schema changes (none expected here).
5. Manual verification after each slice with a known test project.
6. Avoid "big bang" refactors; keep changes isolated and reversible.

## Implementation Sequence

1. Fix layout/scrolling (foundation for all other work).
2. Clamp chapter preview to bounds and sync playhead.
3. Add clip builder state + manual clip creation UI.
4. Fix keyboard shortcuts + playback wiring.
5. Add ctrl+scroll zoom in timeline.
6. Wire transcription (preload + renderer + UI status).
7. Wire agent context + Settings keys into worker process.
8. Apply small UX polish to streamline rough cut creation.

## Workstreams and Steps

### 1) Layout/Scrolling Fix (Issue 4)

**Files**
- `src/renderer/App.svelte`
- `src/renderer/lib/components/ProjectDetail.svelte`

**Intent**
- Make the project editor view scroll internally rather than the entire page.
- Prevent panels from clipping by allowing flex children to shrink and scroll.

**Implementation details**
- Add a `project-open` class to `.container` in `App.svelte` when a project is selected.
- Move padding to only the project list view (not the editor view).
- Add `min-height: 0` to key flex containers; set explicit `overflow` for the editor panes.

**CSS snippet**
```css
/* App.svelte */
.container.project-open {
  padding: 0;
  overflow: hidden;
}

/* ProjectDetail.svelte */
.detail-content,
.project-layout,
.main-content,
.editor-layout,
.editor-main,
.editor-side {
  min-height: 0;
}

.editor-main {
  overflow: hidden;
}

.editor-side {
  overflow: hidden;
}

.timeline-container {
  overflow: auto;
}
```

**Acceptance**
- The project view does not scroll the full page.
- Timeline, chat, and clip list scroll inside their own panes.

### 2) Chapter Preview Boundaries (Issue 1)

**Files**
- `src/renderer/lib/components/ChapterPreview.svelte`

**Intent**
- Prevent users from scrubbing outside chapter bounds while still using the VOD asset.

**Implementation details**
- Add a clamp helper and apply it on `seeking`, `timeupdate`, and `loadedmetadata`.
- Always reset to `chapter.start_time` when chapter changes.

**Svelte snippet**
```svelte
<script lang="ts">
  function clampToChapter(time: number) {
    if (!chapter) return time;
    return Math.max(chapter.start_time, Math.min(time, chapter.end_time));
  }

  function handleSeeking() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(videoRef.currentTime);
    if (Math.abs(next - videoRef.currentTime) > 0.01) {
      videoRef.currentTime = next;
    }
  }

  function handleTimeUpdate() {
    if (!videoRef || !chapter) return;
    const next = clampToChapter(videoRef.currentTime);
    if (next !== videoRef.currentTime) {
      videoRef.pause();
      videoRef.currentTime = next;
    }
    currentTime = next;
  }

  function handleLoadedMetadata() {
    if (!videoRef || !chapter) return;
    videoRef.currentTime = clampToChapter(chapter.start_time);
    currentTime = videoRef.currentTime;
  }
</script>

<video
  bind:this={videoRef}
  on:seeking={handleSeeking}
  on:timeupdate={handleTimeUpdate}
  on:loadedmetadata={handleLoadedMetadata}
  controls
  preload="metadata"
/>
```

**Acceptance**
- Seeking outside bounds snaps to the nearest valid boundary.
- Playback stops at `end_time` and never plays before `start_time`.

### 3) Manual Clip Creation (Issue 2)

**Files**
- `src/renderer/lib/state/clip-builder.svelte.ts` (new)
- `src/renderer/lib/components/ChapterPreview.svelte` (controls)
- `src/renderer/lib/state/project-detail.svelte.ts`

**Intent**
- Provide a straightforward Mark In/Out -> Create Clip flow from the chapter view.

**Implementation details**
- Add a small state module to track `inPoint` and `outPoint`.
- Use `timelineState.playheadTime` for mark-in/out.
- Create a clip using `createProjectClip` with `start_time = inPoint` and track 0.
- Clear selection after clip creation; select the new clip for immediate feedback.

**State module snippet**
```ts
// clip-builder.svelte.ts
export const clipBuilderState = $state({
  inPoint: null as number | null,
  outPoint: null as number | null,
});

export function setInPoint(time: number) {
  clipBuilderState.inPoint = time;
  if (clipBuilderState.outPoint !== null && clipBuilderState.outPoint <= time) {
    clipBuilderState.outPoint = null;
  }
}

export function setOutPoint(time: number) {
  if (clipBuilderState.inPoint === null) {
    clipBuilderState.inPoint = time;
    return;
  }
  clipBuilderState.outPoint = Math.max(time, clipBuilderState.inPoint + 0.01);
}

export function clearSelection() {
  clipBuilderState.inPoint = null;
  clipBuilderState.outPoint = null;
}

export function hasCompleteSelection() {
  return (
    clipBuilderState.inPoint !== null &&
    clipBuilderState.outPoint !== null &&
    clipBuilderState.outPoint > clipBuilderState.inPoint
  );
}
```

**UI snippet**
```svelte
<script lang="ts">
  import { clipBuilderState, setInPoint, setOutPoint, clearSelection, hasCompleteSelection } from '../state/clip-builder.svelte';
  import { timelineState } from '../state/timeline.svelte';
  import { createProjectClip } from '../state/project-detail.svelte';

  async function handleCreateClip() {
    if (!projectDetail.projectId || !chapter || !asset) return;
    if (!hasCompleteSelection()) return;

    const inPoint = clipBuilderState.inPoint!;
    const outPoint = clipBuilderState.outPoint!;
    await createProjectClip(
      projectDetail.projectId,
      asset.id,
      0,
      inPoint,
      inPoint,
      outPoint,
      undefined,
      undefined,
      true
    );
    clearSelection();
  }
</script>

<div class="clip-builder">
  <button on:click={() => setInPoint(timelineState.playheadTime)}>Mark In</button>
  <button on:click={() => setOutPoint(timelineState.playheadTime)}>Mark Out</button>
  <button on:click={clearSelection}>Clear</button>
  <button on:click={handleCreateClip} disabled={!hasCompleteSelection()}>Create Clip</button>
</div>
```

**Acceptance**
- Mark In/Out and Create Clip adds a clip to the timeline immediately.
- Clip duration matches selection.

### 4) Keyboard Shortcuts + Playback Wiring (Issue 3)

**Files**
- `src/renderer/lib/state/keyboard.svelte.ts`
- `src/renderer/lib/components/ChapterPreview.svelte`

**Intent**
- Space toggles playback reliably.
- Ctrl+B sets in/out points using the clip builder state.

**Implementation details**
- Normalize space handling using `event.code === "Space"`.
- Wire `setInPoint` / `setOutPoint` into shortcuts.
- Ensure `timelineState.isPlaying` controls preview video playback, and playhead updates on timeupdate.

**Snippet**
```ts
// keyboard.svelte.ts
function getShortcutKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');

  const key = event.code === 'Space' ? 'Space' : event.key;
  parts.push(key);
  return parts.join('+');
}

const SHORTCUTS = {
  Space: togglePlayback,
  'Ctrl+b': toggleInOut,
  i: setInPointFromPlayhead,
  o: setOutPointFromPlayhead,
} as const;
```

**Acceptance**
- Space toggles playback.
- Ctrl+B toggles in/out in a predictable cycle.
- Playhead is synchronized with video playback.

### 5) Ctrl+Scroll Zoom (Issue 3)

**Files**
- `src/renderer/lib/components/Timeline.svelte`

**Intent**
- Zoom timeline in/out using Ctrl+scroll without affecting the browser zoom.

**Implementation details**
- Attach a wheel handler to the timeline container.
- Use `on:wheel|passive={false}` to allow `preventDefault()`.

**Svelte snippet**
```svelte
<script lang="ts">
  function handleWheel(event: WheelEvent) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    const multiplier = direction > 0 ? 0.9 : 1.1;
    setZoom(timelineState.zoomLevel * multiplier);
  }
</script>

<div class="timeline" on:wheel|passive={false}={handleWheel}>
  <!-- tracks -->
</div>
```

**Acceptance**
- Ctrl+scroll zooms timeline smoothly.
- Normal scroll still works without ctrl.

### 6) Transcription Wiring + Visibility (Issue 6)

**Files**
- `src/electron/preload.ts`
- `src/renderer/lib/state/electron.svelte.ts`
- `src/renderer/lib/state/transcription.svelte.ts` (new)
- `src/renderer/lib/components/ProjectDetail.svelte`
- `src/renderer/lib/components/ChapterPanel.svelte` or `ChapterPreview.svelte`

**Intent**
- Ensure transcription runs on import and show progress visibly per chapter.

**Implementation details**
- Expose `transcription.transcribe` and `transcribe:progress` in preload.
- Track progress in a new state module keyed by `chapterId`.
- Trigger transcription for both VOD and file imports when `autoTranscribeOnImport` is true.
- Display a status badge next to chapters.

**Preload snippet**
```ts
// preload.ts
transcription: {
  transcribe: (chapterId: number, options?: Record<string, unknown>) =>
    ipcRenderer.invoke('transcribe:chapter', { chapterId, options }),
  onProgress: (callback) => {
    const handler = (_: any, data: { chapterId: number; progress: { percent: number; status: string } }) => callback(data);
    ipcRenderer.on('transcribe:progress', handler);
    return () => ipcRenderer.removeListener('transcribe:progress', handler);
  },
},
```

**State snippet**
```ts
// transcription.svelte.ts
export const transcriptionState = $state({
  byChapter: new Map<number, { status: 'idle' | 'running' | 'done' | 'error'; percent: number; message: string }>(),
});

export function setTranscriptionProgress(chapterId: number, progress: { percent: number; status: string }) {
  transcriptionState.byChapter.set(chapterId, {
    status: progress.percent >= 100 ? 'done' : 'running',
    percent: progress.percent,
    message: progress.status,
  });
  transcriptionState.byChapter = new Map(transcriptionState.byChapter);
}
```

**Acceptance**
- Transcription triggers for VOD and file imports when enabled.
- Progress is visible in chapter list or preview panel.

### 7) Agent Context + Settings Keys (Issue 5)

**Files**
- `src/renderer/lib/components/ProjectDetail.svelte`
- `src/renderer/lib/state/agent.svelte.ts`
- `src/electron/ipc/channels.ts`
- `src/electron/ipc/handlers.ts`
- `src/electron/agent-bridge.ts`

**Intent**
- Ensure the agent always has project context and valid provider keys from Settings.

**Implementation details**
- Set agent context on mount and clear on destroy.
- Add an IPC channel to pass Settings provider keys to main.
- Store keys in main, spawn agent with env overrides.
- If the agent has not started yet, start it when the first chat message arrives.

**Renderer snippet**
```ts
// ProjectDetail.svelte
onMount(() => {
  setProjectContext(String(project.id));
});

onDestroy(() => {
  setProjectContext(null);
});

$effect(() => {
  const chapterId = selectedChapter?.id ? String(selectedChapter.id) : null;
  setChapterContext(chapterId, null);
});
```

**Main process snippet**
```ts
// handlers.ts
ipcMain.handle(IPC_CHANNELS.AGENT_CONFIG_SET, async (_, config) => {
  agentConfigCache = config;
  return createSuccessResponse({ ok: true });
});

// agent-bridge.ts
async start(options?: { env?: Record<string, string> }) {
  this.process = spawn('node', [agentPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options?.env },
  });
}
```

**Acceptance**
- Chat works when a project is open.
- Agent uses API keys from Settings without requiring `.env`.

### 8) Immediate UX Wins (Issue 7)

**Files**
- `src/renderer/lib/components/ChapterPreview.svelte`
- `src/renderer/lib/components/TimelineToolbar.svelte`

**Intent**
- Make rough-cut creation feel obvious and low-friction.

**Implementation details**
- Display selection duration next to Mark In/Out.
- Add clear controls for playback and clip creation.
- Reduce padding in the editor column to maximize usable space.

**UI snippet**
```svelte
<div class="selection-info">
  {#if hasCompleteSelection()}
    <span>Selection: {formatTime(inPoint)} - {formatTime(outPoint)} ({formatTime(outPoint - inPoint)})</span>
  {:else}
    <span>No selection yet</span>
  {/if}
</div>
```

**Acceptance**
- Manual clip creation is discoverable without hunting through the UI.

## Validation Checklist

- Chapter preview cannot seek outside chapter bounds.
- Mark In/Out + Create Clip works and adds a timeline clip.
- Space toggles playback and is reflected in preview.
- Ctrl+scroll zoom works in the timeline.
- Editor portal scrolls internally; no clipped sections.
- Chat works with project context and Settings API keys.
- Transcription runs and progress is visible.

## Risks and Mitigations

- **Agent keys in Settings**: Cache keys in main and pass into agent spawn env.
- **Playback sync**: Keep ChapterPreview as the source of truth for playback state.
- **Timeline state**: Store clip builder selection in its own module (no schema changes).

## Rollback Plan

- Each slice is isolated to 1-2 files; revert that slice if it introduces regressions.
- Keep the clip builder in a separate module for easy removal.
- Agent key propagation can be disabled without affecting project loading.
