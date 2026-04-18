import type {
  CreateDetailedTranscriptInput,
  DetailedTranscript,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';
import { getAsset } from './assets.js';
import { getChapter } from './chapters.js';

function parseDetailedTranscriptSegments(
  raw: string
): DetailedTranscript['segments_json'] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((segment, index) => {
        if (!segment || typeof segment !== 'object') {
          return null;
        }

        const record = segment as Record<string, unknown>;
        if (
          typeof record.start !== 'number' ||
          !Number.isFinite(record.start) ||
          typeof record.end !== 'number' ||
          !Number.isFinite(record.end) ||
          typeof record.text !== 'string'
        ) {
          return null;
        }

        const words = Array.isArray(record.words)
          ? record.words
              .map((word) => {
                if (!word || typeof word !== 'object') {
                  return null;
                }

                const wordRecord = word as Record<string, unknown>;
                if (
                  typeof wordRecord.word !== 'string' ||
                  typeof wordRecord.start !== 'number' ||
                  !Number.isFinite(wordRecord.start) ||
                  typeof wordRecord.end !== 'number' ||
                  !Number.isFinite(wordRecord.end)
                ) {
                  return null;
                }

                return {
                  word: wordRecord.word,
                  start: wordRecord.start,
                  end: wordRecord.end,
                  probability:
                    typeof wordRecord.probability === 'number' && Number.isFinite(wordRecord.probability)
                      ? wordRecord.probability
                      : undefined,
                };
              })
              .filter((word): word is NonNullable<typeof word> => word !== null)
          : undefined;

        return {
          id: typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : index,
          start: record.start,
          end: record.end,
          text: record.text,
          words: words && words.length > 0 ? words : undefined,
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
  } catch {
    return [];
  }
}

interface DetailedTranscriptRow {
  id: number;
  chapter_id: number;
  asset_id: number;
  window_start: number;
  window_end: number;
  model: string;
  compute_type: string;
  word_timestamps: number;
  text: string;
  segments_json: string;
  created_at: string;
}

function mapDetailedTranscriptRow(row: DetailedTranscriptRow): DetailedTranscript {
  return {
    id: row.id,
    chapter_id: row.chapter_id,
    asset_id: row.asset_id,
    window_start: row.window_start,
    window_end: row.window_end,
    model: row.model,
    compute_type: row.compute_type,
    word_timestamps: Boolean(row.word_timestamps),
    text: row.text,
    segments_json: parseDetailedTranscriptSegments(row.segments_json),
    created_at: row.created_at,
  };
}

export async function getDetailedTranscriptWindow(
  chapterId: number,
  assetId: number,
  windowStart: number,
  windowEnd: number,
  model: string,
  computeType: string,
  wordTimestamps: boolean
): Promise<DetailedTranscript | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps, text, segments_json, created_at
     FROM detailed_transcripts
     WHERE chapter_id = ?
       AND asset_id = ?
       AND window_start = ?
       AND window_end = ?
       AND model = ?
       AND compute_type = ?
       AND word_timestamps = ?`
  ).get(
    chapterId,
    assetId,
    windowStart,
    windowEnd,
    model,
    computeType,
    wordTimestamps ? 1 : 0
  ) as DetailedTranscriptRow | undefined;

  return result ? mapDetailedTranscriptRow(result) : null;
}

export async function upsertDetailedTranscript(
  transcript: CreateDetailedTranscriptInput
): Promise<DetailedTranscript> {
  const database = await getDatabase();

  if (transcript.window_start < 0) {
    throw new Error('Detailed transcript window_start must be >= 0');
  }
  if (transcript.window_end <= transcript.window_start) {
    throw new Error('Detailed transcript window_end must be greater than window_start');
  }

  const chapter = await getChapter(transcript.chapter_id);
  if (!chapter) {
    throw new Error(`Chapter not found: ${transcript.chapter_id}`);
  }

  const asset = await getAsset(transcript.asset_id);
  if (!asset) {
    throw new Error(`Asset not found: ${transcript.asset_id}`);
  }

  database.prepare(
    `INSERT INTO detailed_transcripts (
      chapter_id,
      asset_id,
      window_start,
      window_end,
      model,
      compute_type,
      word_timestamps,
      text,
      segments_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps)
    DO UPDATE SET
      text = excluded.text,
      segments_json = excluded.segments_json,
      created_at = CURRENT_TIMESTAMP`
  ).run(
    transcript.chapter_id,
    transcript.asset_id,
    transcript.window_start,
    transcript.window_end,
    transcript.model,
    transcript.compute_type,
    transcript.word_timestamps ? 1 : 0,
    transcript.text,
    JSON.stringify(transcript.segments_json)
  );

  const created = await getDetailedTranscriptWindow(
    transcript.chapter_id,
    transcript.asset_id,
    transcript.window_start,
    transcript.window_end,
    transcript.model,
    transcript.compute_type,
    transcript.word_timestamps
  );

  if (!created) {
    throw new Error('Failed to persist detailed transcript');
  }

  return created;
}

export async function getDetailedTranscriptsByChapter(
  chapterId: number
): Promise<DetailedTranscript[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps, text, segments_json, created_at
     FROM detailed_transcripts
     WHERE chapter_id = ?
     ORDER BY window_start ASC, window_end ASC, created_at DESC`
  ).all(chapterId) as DetailedTranscriptRow[];

  return results.map(mapDetailedTranscriptRow);
}

export async function deleteDetailedTranscriptsByChapter(
  chapterId: number
): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare(
    'DELETE FROM detailed_transcripts WHERE chapter_id = ?'
  ).run(chapterId);

  return result.changes;
}
