import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createTranscript,
  ensureSchemaColumns,
  getTranscriptsByChapter,
  replaceTranscripts,
  setDatabaseForTesting,
} from '../../src/electron/database/index.js';

const canUseNativeSqlite = (() => {
  try {
    const probe = new Database(':memory:');
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

const describeNative = canUseNativeSqlite ? describe : describe.skip;

function createDatabase(): { database: Database.Database; chapterId: number } {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8'));
  const projectId = database.prepare('INSERT INTO projects (name) VALUES (?)')
    .run('Transcript Test').lastInsertRowid as number;
  const chapterId = database.prepare(
    'INSERT INTO chapters (project_id, title, start_time, end_time) VALUES (?, ?, ?, ?)'
  ).run(projectId, 'Chapter', 0, 60).lastInsertRowid as number;
  setDatabaseForTesting(database);
  return { database, chapterId };
}

describeNative('transcript repository word timestamps', () => {
  it('migrates legacy transcript tables and reads legacy rows as empty word lists', async () => {
    const database = new Database(':memory:');
    database.exec(fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8'));
    database.exec(`
      DROP TABLE transcripts;
      CREATE TABLE transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL
      );
      INSERT INTO transcripts (chapter_id, text, start_time, end_time)
      VALUES (7, 'Legacy text', 1, 2);
    `);

    try {
      ensureSchemaColumns(database);
      setDatabaseForTesting(database);
      await expect(getTranscriptsByChapter(7)).resolves.toEqual([
        expect.objectContaining({ text: 'Legacy text', words_json: [] }),
      ]);
    } finally {
      setDatabaseForTesting(null);
      database.close();
    }
  });

  it('round-trips word timestamps for create and replace operations', async () => {
    const { database, chapterId } = createDatabase();

    try {
      await createTranscript({
        chapter_id: chapterId,
        text: ' Um hello',
        start_time: 1,
        end_time: 2,
        words_json: [
          { word: ' Um', start: 1, end: 1.2, probability: 0.95 },
          { word: ' hello', start: 1.25, end: 2 },
        ],
      });

      expect(await getTranscriptsByChapter(chapterId)).toEqual([
        expect.objectContaining({
          words_json: [
            { word: ' Um', start: 1, end: 1.2, probability: 0.95 },
            { word: ' hello', start: 1.25, end: 2, probability: undefined },
          ],
        }),
      ]);

      await replaceTranscripts(chapterId, [{
        text: 'Replacement',
        start_time: 3,
        end_time: 4,
        words_json: [{ word: ' Replacement', start: 3, end: 4 }],
      }]);

      expect(await getTranscriptsByChapter(chapterId)).toEqual([
        expect.objectContaining({
          text: 'Replacement',
          words_json: [{ word: ' Replacement', start: 3, end: 4, probability: undefined }],
        }),
      ]);
    } finally {
      setDatabaseForTesting(null);
      database.close();
    }
  });
});
