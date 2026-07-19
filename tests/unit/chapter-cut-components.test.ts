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
});
