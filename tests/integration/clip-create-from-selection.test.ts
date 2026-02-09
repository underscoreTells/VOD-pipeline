import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { createClip, getClip, setDatabaseForTesting } from '../../src/electron/database/db.js';

describe('Clip creation from selection', () => {
  let tempDir: string;
  let db: Database.Database;
  let projectId: number;
  let assetId: number;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vod-pipeline-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    const schemaPath = path.join(process.cwd(), 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    setDatabaseForTesting(db);

    db.prepare('DELETE FROM clips').run();
    db.prepare('DELETE FROM assets').run();
    db.prepare('DELETE FROM projects').run();

    const projectResult = db
      .prepare('INSERT INTO projects (name) VALUES (?)')
      .run('Test Project');
    projectId = projectResult.lastInsertRowid as number;

    const assetResult = db
      .prepare('INSERT INTO assets (project_id, file_path, file_type, duration) VALUES (?, ?, ?, ?)')
      .run(projectId, '/test/video.mp4', 'video', 3600);
    assetId = assetResult.lastInsertRowid as number;
  });

  it('creates clip with start_time matching in_point', async () => {
    const clip = await createClip({
      project_id: projectId,
      asset_id: assetId,
      track_index: 0,
      start_time: 120,
      in_point: 120,
      out_point: 150,
      role: null,
      description: null,
      is_essential: true,
    });

    const fetched = await getClip(clip.id);
    expect(fetched?.start_time).toBe(120);
    expect(fetched?.in_point).toBe(120);
    expect(fetched?.out_point).toBe(150);
  });
});
