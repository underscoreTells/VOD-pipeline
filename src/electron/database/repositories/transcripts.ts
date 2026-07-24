import type {
  CreateTranscriptInput,
  Transcript,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

interface TranscriptRow extends Omit<Transcript, 'words_json'> {
  words_json: string | null;
}

function parseTranscriptWords(raw: string | null): Transcript['words_json'] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') {
        return [];
      }

      const word = value as Record<string, unknown>;
      if (
        typeof word.word !== 'string'
        || typeof word.start !== 'number'
        || !Number.isFinite(word.start)
        || typeof word.end !== 'number'
        || !Number.isFinite(word.end)
        || word.end < word.start
      ) {
        return [];
      }

      return [{
        word: word.word,
        start: word.start,
        end: word.end,
        probability: typeof word.probability === 'number' && Number.isFinite(word.probability)
          ? word.probability
          : undefined,
      }];
    });
  } catch {
    return [];
  }
}

function mapTranscriptRow(row: TranscriptRow): Transcript {
  return {
    ...row,
    words_json: parseTranscriptWords(row.words_json),
  };
}

export async function createTranscript(transcript: CreateTranscriptInput): Promise<Transcript> {
  const database = await getDatabase();
  const result = database.prepare(
    `INSERT INTO transcripts (chapter_id, text, start_time, end_time, words_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    transcript.chapter_id,
    transcript.text,
    transcript.start_time,
    transcript.end_time,
    JSON.stringify(transcript.words_json ?? [])
  );

  return {
    id: result.lastInsertRowid as number,
    chapter_id: transcript.chapter_id,
    text: transcript.text,
    start_time: transcript.start_time,
    end_time: transcript.end_time,
    words_json: transcript.words_json ?? [],
  };
}

export async function getTranscriptsByChapter(chapterId: number): Promise<Transcript[]> {
  const database = await getDatabase();
  const rows = database.prepare(
    'SELECT id, chapter_id, text, start_time, end_time, words_json FROM transcripts WHERE chapter_id = ? ORDER BY start_time ASC'
  ).all(chapterId) as TranscriptRow[];

  return rows.map(mapTranscriptRow);
}

export async function deleteTranscriptsByChapter(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?').run(chapterId);

  return result.changes;
}

export async function replaceTranscripts(
  chapterId: number,
  segments: Array<Omit<CreateTranscriptInput, 'chapter_id'>>
): Promise<number> {
  const database = await getDatabase();
  const deleteStatement = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?');
  const insert = database.prepare(
    'INSERT INTO transcripts (chapter_id, text, start_time, end_time, words_json) VALUES (?, ?, ?, ?, ?)'
  );

  const replaceTransaction = database.transaction((items: typeof segments) => {
    deleteStatement.run(chapterId);
    for (const item of items) {
      insert.run(
        chapterId,
        item.text,
        item.start_time,
        item.end_time,
        JSON.stringify(item.words_json ?? [])
      );
    }
    return items.length;
  });

  return replaceTransaction(segments);
}
