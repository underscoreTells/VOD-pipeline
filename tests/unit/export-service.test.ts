import { describe, expect, it } from 'vitest';
import type { Chapter, Clip } from '../../src/shared/types/database.js';
import { deriveOrderedExportClips } from '../../src/electron/services/export-service.js';
import { generateEDL, generateFCPXML, generateJSON } from '../../src/pipeline/export/index.js';

function createChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 1,
    project_id: 1,
    title: 'Chapter',
    start_time: 0,
    end_time: 60,
    display_order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 1,
    project_id: 1,
    asset_id: 1,
    track_index: 0,
    in_point: 10,
    out_point: 20,
    role: null,
    description: null,
    is_essential: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('export service ordering', () => {
  it('derives export order from chapter order then clip source timing', () => {
    const chapters = [
      createChapter({ id: 11, display_order: 1, start_time: 200, end_time: 260 }),
      createChapter({ id: 10, display_order: 1, start_time: 100, end_time: 180 }),
      createChapter({ id: 9, display_order: 0, start_time: 0, end_time: 50 }),
    ];
    const clips = [
      createClip({ id: 30, asset_id: 2, in_point: 10, out_point: 20 }),
      createClip({ id: 31, asset_id: 1, in_point: 150, out_point: 160 }),
      createClip({ id: 32, asset_id: 1, in_point: 120, out_point: 130 }),
      createClip({ id: 29, asset_id: 1, in_point: 120, out_point: 125 }),
      createClip({ id: 40, asset_id: 1, in_point: 220, out_point: 230 }),
    ];

    const ordered = deriveOrderedExportClips({
      chapters,
      clips,
      chapterAssetIds: new Map([
        [9, new Set([2])],
        [10, new Set([1])],
        [11, new Set([1])],
      ]),
    });

    expect(ordered.map((item) => item.clip.id)).toEqual([30, 29, 32, 31, 40]);
  });

  it('fails export ordering when a clip maps to zero chapters', () => {
    expect(() =>
      deriveOrderedExportClips({
        chapters: [createChapter({ id: 1, start_time: 0, end_time: 50 })],
        clips: [createClip({ id: 99, asset_id: 7, in_point: 80, out_point: 90 })],
        chapterAssetIds: new Map([[1, new Set([1])]]),
      })
    ).toThrow(/does not map to any chapter/i);
  });

  it('fails export ordering when a clip maps to multiple chapters', () => {
    expect(() =>
      deriveOrderedExportClips({
        chapters: [
          createChapter({ id: 1, start_time: 0, end_time: 100 }),
          createChapter({ id: 2, start_time: 50, end_time: 120 }),
        ],
        clips: [createClip({ id: 99, asset_id: 1, in_point: 60, out_point: 70 })],
        chapterAssetIds: new Map([
          [1, new Set([1])],
          [2, new Set([1])],
        ]),
      })
    ).toThrow(/maps to multiple chapters/i);
  });
});

describe('export generators', () => {
  const orderedClips = [
    createClip({ id: 1, asset_id: 1, in_point: 10, out_point: 20, description: 'Clip A' }),
    createClip({ id: 2, asset_id: 1, in_point: 30, out_point: 35, description: 'Clip B' }),
    createClip({ id: 3, asset_id: 2, in_point: 50, out_point: 60, description: 'Clip C' }),
  ];

  it('accumulates FCPXML offsets from clip durations', () => {
    const xml = generateFCPXML({
      projectName: 'Test Project',
      projectId: 1,
      frameRate: 30,
      clips: orderedClips,
      assetPaths: new Map([
        [1, '/tmp/a.mp4'],
        [2, '/tmp/b.mp4'],
      ]),
      assetDurations: new Map([
        [1, 100],
        [2, 100],
      ]),
    });

    expect(xml).toContain('<clip name="Clip A" offset="0/30s" duration="300/30s">');
    expect(xml).toContain('<clip name="Clip B" offset="300/30s" duration="150/30s">');
    expect(xml).toContain('<clip name="Clip C" offset="450/30s" duration="300/30s">');
  });

  it('keeps EDL record order derived from export order', () => {
    const edl = generateEDL({
      title: 'Test Project',
      frameRate: 30,
      clips: orderedClips,
      reelNames: new Map([
        [1, 'REEL1'],
        [2, 'REEL2'],
      ]),
    });

    const eventLines = edl.split('\n').filter((line) => /^\d{3}\s+/.test(line));
    expect(eventLines[0]).toContain('REEL1');
    expect(eventLines[1]).toContain('REEL1');
    expect(eventLines[2]).toContain('REEL2');
  });

  it('emits ordered JSON clips without persisted startTime and includes sequenceIndex', () => {
    const json = generateJSON({
      projectId: 1,
      projectName: 'Test Project',
      frameRate: 30,
      totalDuration: 25,
      clips: orderedClips,
      assetPaths: new Map([
        [1, '/tmp/a.mp4'],
        [2, '/tmp/b.mp4'],
      ]),
      audioTracks: [],
    });

    const parsed = JSON.parse(json) as {
      clips: Array<Record<string, unknown>>;
    };

    expect(parsed.clips.map((clip) => clip.id)).toEqual([1, 2, 3]);
    expect(parsed.clips[0]?.sequenceIndex).toBe(0);
    expect(parsed.clips[1]).not.toHaveProperty('startTime');
  });
});
