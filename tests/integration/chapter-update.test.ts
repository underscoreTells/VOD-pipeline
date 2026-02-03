import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { getChapter, setDatabaseForTesting, updateChapter } from '../../src/electron/database/db.js';

describe('Chapter update integration', () => {
  let tempDir: string;
  let db: Database.Database;
  let chapterId: number;

  beforeAll(async () => {
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

    db.prepare('DELETE FROM chapters').run();
    db.prepare('DELETE FROM projects').run();

    const projectResult = db
      .prepare('INSERT INTO projects (name) VALUES (?)')
      .run('Test Project');
    const projectId = projectResult.lastInsertRowid as number;

    const chapterResult = db
      .prepare(
        'INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)'
      )
      .run(projectId, 'Test Chapter', 10, 20);
    chapterId = chapterResult.lastInsertRowid as number;
  });

  it('updates chapter bounds in database', async () => {
    const success = await updateChapter(chapterId, { start_time: 15, end_time: 25 });
    expect(success).toBe(true);

    const updated = await getChapter(chapterId);
    expect(updated?.start_time).toBe(15);
    expect(updated?.end_time).toBe(25);
  });

  it('rejects invalid chapter ranges', async () => {
    await expect(updateChapter(chapterId, { start_time: 30, end_time: 20 })).rejects.toThrow(
      'End time must be greater than start time'
    );
  });
});
