import type {
  CreateTranscriptInput,
  Transcript,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

export async function createTranscript(transcript: CreateTranscriptInput): Promise<Transcript> {
  const database = await getDatabase();
  const result = database.prepare(
    `INSERT INTO transcripts (chapter_id, text, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  ).run(
    transcript.chapter_id,
    transcript.text,
    transcript.start_time,
    transcript.end_time
  );

  return {
    id: result.lastInsertRowid as number,
    chapter_id: transcript.chapter_id,
    text: transcript.text,
    start_time: transcript.start_time,
    end_time: transcript.end_time,
  };
}

export async function getTranscriptsByChapter(chapterId: number): Promise<Transcript[]> {
  const database = await getDatabase();
  return database.prepare(
    'SELECT id, chapter_id, text, start_time, end_time FROM transcripts WHERE chapter_id = ? ORDER BY start_time ASC'
  ).all(chapterId) as Transcript[];
}

export async function getTranscriptsByProject(projectId: number): Promise<Transcript[]> {
  const database = await getDatabase();
  return database.prepare(
    `SELECT t.id, t.chapter_id, t.text, t.start_time, t.end_time
     FROM transcripts t
     JOIN chapters c ON t.chapter_id = c.id
     WHERE c.project_id = ?
     ORDER BY c.start_time ASC, t.start_time ASC`
  ).all(projectId) as Transcript[];
}

export async function deleteTranscriptsByChapter(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?').run(chapterId);

  return result.changes;
}

export async function batchInsertTranscripts(
  chapterId: number,
  segments: Array<Omit<CreateTranscriptInput, 'chapter_id'>>
): Promise<number> {
  const database = await getDatabase();
  const insert = database.prepare(
    'INSERT INTO transcripts (chapter_id, text, start_time, end_time) VALUES (?, ?, ?, ?)'
  );

  const insertMany = database.transaction((items: typeof segments) => {
    for (const item of items) {
      insert.run(chapterId, item.text, item.start_time, item.end_time);
    }
    return items.length;
  });

  return insertMany(segments);
}

export async function replaceTranscripts(
  chapterId: number,
  segments: Array<Omit<CreateTranscriptInput, 'chapter_id'>>
): Promise<number> {
  const database = await getDatabase();
  const deleteStatement = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?');
  const insert = database.prepare(
    'INSERT INTO transcripts (chapter_id, text, start_time, end_time) VALUES (?, ?, ?, ?)'
  );

  const replaceTransaction = database.transaction((items: typeof segments) => {
    deleteStatement.run(chapterId);
    for (const item of items) {
      insert.run(chapterId, item.text, item.start_time, item.end_time);
    }
    return items.length;
  });

  return replaceTransaction(segments);
}
