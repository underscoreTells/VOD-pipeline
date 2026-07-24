import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setDatabaseForTesting } from '../../src/electron/database/client.js';
import {
  commitVodCut,
  loadVodCutDraft,
  saveVodCutDraft,
} from '../../src/electron/database/repositories/vod-cut-drafts.js';

describe('VOD cut commit integration', () => {
  let database: Database.Database | null = null;
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-cut-test-'));
    database = new Database(path.join(tempDir, 'test.db'));
    database.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(path.resolve('database/schema.sql'), 'utf8');
    database.exec(schema);
    setDatabaseForTesting(database);
  });

  beforeEach(() => {
    database!.prepare('DELETE FROM projects').run();
    database!.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(1, 'VOD project');
    database!.prepare(`
      INSERT INTO assets (id, project_id, file_path, file_type, duration)
      VALUES (?, ?, ?, ?, ?)
    `).run(2, 1, '/tmp/vod.mp4', 'video', 3600);
  });

  afterAll(() => {
    database?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists a draft and atomically commits chronologically ordered chapters', async () => {
    await saveVodCutDraft(1, 2, [
      { id: 'later', title: 'Later', start_time: 600, end_time: 720 },
      { id: 'intro', title: 'Intro', start_time: 20, end_time: 80 },
    ], { playheadTime: 640, pixelsPerSecond: 12, scrollLeft: 3200 });

    const created = await commitVodCut(1, 2, [
      { title: 'Later', startTime: 600, endTime: 720 },
      { title: 'Intro', startTime: 20, endTime: 80 },
    ]);

    expect(created.map((chapter) => chapter.title)).toEqual(['Intro', 'Later']);
    expect(created.map((chapter) => chapter.display_order)).toEqual([0, 1]);
    expect(database!.prepare(
      'SELECT chapter_id, asset_id FROM chapter_assets ORDER BY chapter_id'
    ).all()).toEqual([
      { chapter_id: created[0].id, asset_id: 2 },
      { chapter_id: created[1].id, asset_id: 2 },
    ]);
    expect(await loadVodCutDraft(1, 2)).toBeNull();
  });

  it('rejects overlapping ranges without changing chapters or the saved draft', async () => {
    const draftRanges = [
      { id: 'one', title: 'One', start_time: 10, end_time: 30 },
    ];
    await saveVodCutDraft(1, 2, draftRanges);

    await expect(commitVodCut(1, 2, [
      { title: 'One', startTime: 10, endTime: 30 },
      { title: 'Overlap', startTime: 20, endTime: 40 },
    ])).rejects.toThrow('Chapter ranges cannot overlap');

    expect(database!.prepare('SELECT COUNT(*) AS count FROM chapters').get()).toEqual({ count: 0 });
    expect((await loadVodCutDraft(1, 2))?.ranges).toEqual(draftRanges);
  });
});
