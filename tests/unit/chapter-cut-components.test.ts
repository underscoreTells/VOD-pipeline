import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cutListSource = readFileSync(
  new URL('../../src/renderer/lib/components/CutListPanel.svelte', import.meta.url),
  'utf8'
);
const timelineSource = readFileSync(
  new URL('../../src/renderer/lib/components/chapter-cut/ChapterCutTimeline.svelte', import.meta.url),
  'utf8'
);
const contextMenuSource = readFileSync(
  new URL('../../src/renderer/lib/components/ui/ContextMenu.svelte', import.meta.url),
  'utf8'
);
const projectDetailSource = readFileSync(
  new URL('../../src/renderer/lib/components/ProjectDetail.svelte', import.meta.url),
  'utf8'
);

describe('chapter cut workspace', () => {
  it('keeps cut rows full-width and moves deletion into a context menu', () => {
    expect(cutListSource).toContain('oncontextmenu={(event) => openCutContextMenu(event, clip)}');
    expect(cutListSource).toContain("label: 'Delete cut'");
    expect(cutListSource).toContain('action: deleteContextCut');
    expect(cutListSource).not.toContain('w-12 shrink-0 justify-end');
    expect(cutListSource).not.toContain('>Delete</button>');
  });

  it('offers the same delete action from timeline clip context menus', () => {
    expect(timelineSource).toContain('oncontextmenu={(event) => openClipContextMenu(event, clip)}');
    expect(timelineSource).toContain("label: 'Delete cut'");
    expect(timelineSource).toContain('action: deleteContextClip');
    expect(timelineSource).toContain('void executeDeleteClip(clipContextMenu.clipId)');
  });

  it('uses compact context-menu text', () => {
    expect(contextMenuSource).toContain('text-app-sm');
    expect(contextMenuSource).not.toContain('text-app-base');
  });

  it('renders retained ranges in the waveform track even when peaks are unavailable', () => {
    expect(timelineSource).toContain('chapter-waveform-track');
    expect(timelineSource).toContain('{#each clips as clip (clip.id)}');
    expect(timelineSource).toContain('chapter-clip-overlay');
    expect(timelineSource).toContain('Waveform unavailable · timeline editing still works');
    expect(timelineSource).not.toContain('{#each assets as asset (asset.id)}');
  });

  it('treats a click as a scrub and only creates a range after crossing the drag threshold', () => {
    expect(timelineSource).toContain('!dragMoved && Math.abs(event.clientX');
    expect(timelineSource).toContain('if (!dragMoved) {');
    expect(timelineSource).toContain('scrubTo(pointerTime(event));');
  });

  it('requires Ctrl or Cmd to move a retained clip manually', () => {
    expect(timelineSource).toContain('if (!event.ctrlKey && !event.metaKey)');
    expect(timelineSource).toContain('Ctrl/Cmd-drag to move');
  });

  it('restores the Exclude cut content control and shortcut hint', () => {
    expect(timelineSource).toContain('>Exclude cut content');
    expect(timelineSource).toContain('title="Exclude cut content (\\)"');
    expect(timelineSource).toContain('aria-pressed={timelineState.excludeCutContent}');
  });

  it('clears waveform data while loading a different asset', () => {
    expect(timelineSource).toContain('waveformPeaks = [];');
    expect(timelineSource).toContain('waveformDuration = 0;');
  });

  it('previews the selected cut asset and clamps displayed times to the chapter', () => {
    expect(projectDetailSource).toContain('asset.id === selectedClip.asset_id');
    expect(projectDetailSource).toContain('chapterEndTime={selectedChapter?.end_time}');
    expect(cutListSource).toContain('Math.min(Math.max(0, seconds - chapterStartTime), chapterDuration)');
  });

  it('previews suggestions against their source asset', () => {
    expect(projectDetailSource).toContain('suggestion.id === agentState.selectedSuggestionId');
    expect(projectDetailSource).toContain('clip.id === selectedSuggestion.target_clip_id');
    expect(projectDetailSource).toContain('payload.create?.assetId');
    expect(projectDetailSource).toContain('?? selectedSuggestionAsset');
  });

  it('cancels an active agent turn before completing a chapter', () => {
    expect(projectDetailSource).toContain('pendingChapterCompletion = chapterId;');
    expect(projectDetailSource).toContain('await persistChapterCompletion(completionChapterId, false);');
  });

  it('stops and disables playback when the previewed asset is unavailable', () => {
    expect(projectDetailSource).toContain('playbackAvailable={chapterPreviewAsset !== null && chapterPreviewAsset.availability.exists !== false}');
    expect(timelineSource).toContain('if (!playbackAvailable && timelineState.isPlaying) setPlaying(false);');
    expect(timelineSource).toContain('disabled={!playbackAvailable}');
  });

  it('routes import-driven chapter selection through the active-turn guard', () => {
    expect(projectDetailSource).toContain('selectChapter: requestChapterSelection');
    expect(projectDetailSource).toContain('requestChapterSelection(result.data[0].id);');
    expect(projectDetailSource).toContain('requestChapterSelection(created[0].id);');
  });

  it('pins the viewed asset before clearing selection for a create drag', () => {
    expect(timelineSource).toContain('pinnedDragAsset ?? viewedAsset');
    expect(timelineSource).toContain('const dragAsset = activeAsset;');
    expect(timelineSource.indexOf('const dragAsset = activeAsset;')).toBeLessThan(
      timelineSource.indexOf('clearSelection();')
    );
    expect(timelineSource).toContain('setPinnedDragAsset(dragAsset);');
    expect(timelineSource).toContain('setPinnedDragAsset(null);');
  });

  it('propagates the pinned drag asset to the parent viewer state', () => {
    expect(timelineSource).toContain('onPinnedAssetChange?.(asset);');
    expect(projectDetailSource).toContain('let pinnedDragAsset = $state<ProjectAsset | null>(null);');
    expect(projectDetailSource).toContain('return pinnedDragAsset');
    expect(projectDetailSource.indexOf('return pinnedDragAsset')).toBeLessThan(
      projectDetailSource.indexOf('?? selectedClipAsset')
    );
    expect(projectDetailSource).toContain('onPinnedAssetChange={(asset) => (pinnedDragAsset = asset)}');
    expect(projectDetailSource.indexOf('clearTimelineSelection();')).toBeLessThan(
      projectDetailSource.indexOf('pinnedDragAsset = null;')
    );
  });

  it('keeps cuts from other assets selectable without stealing drag hit-testing', () => {
    expect(timelineSource).toContain('editable = clip.asset_id === activeAsset?.id');
    expect(timelineSource).toContain('if (clip.asset_id !== activeAsset?.id) return;');
    expect(timelineSource).toContain("editable ? 'z-[5] cursor-grab active:cursor-grabbing' : 'z-[4] cursor-pointer opacity-60'");
    expect(timelineSource).toContain('Select to edit on its source');
  });
});
