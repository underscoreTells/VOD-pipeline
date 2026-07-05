import { clamp } from '../../../shared/utils/clip-timing.js';

const OVERVIEW_TRANSCRIPT_CHUNK_SECONDS = 15;
const OVERVIEW_TRANSCRIPT_MAX_LINES = 320;
const OVERVIEW_TRANSCRIPT_MAX_CHARS = 30000;

function normalizeChapterLocalSegment(
  segment: { start_time: number; end_time: number; text: string },
  chapterStart: number,
  chapterDuration: number
): { start: number; end: number; text: string } | null {
  if (!segment.text || !segment.text.trim()) return null;

  const looksLikeLegacyGlobal =
    segment.start_time > chapterDuration + 1 ||
    segment.end_time > chapterDuration + 1 ||
    segment.start_time < -0.001;

  const localStartRaw = looksLikeLegacyGlobal ? segment.start_time - chapterStart : segment.start_time;
  const localEndRaw = looksLikeLegacyGlobal ? segment.end_time - chapterStart : segment.end_time;

  const start = clamp(localStartRaw, 0, chapterDuration);
  const end = clamp(localEndRaw, start, chapterDuration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return {
    start,
    end,
    text: segment.text.trim(),
  };
}

export function formatOverviewTranscript(
  transcriptSegments: Array<{ start_time: number; end_time: number; text: string }>,
  chapterStart: number,
  chapterEnd: number
): string {
  const chapterDuration = Math.max(0.01, chapterEnd - chapterStart);

  const normalized = transcriptSegments
    .map((segment) => normalizeChapterLocalSegment(segment, chapterStart, chapterDuration))
    .filter((segment): segment is NonNullable<typeof segment> => segment !== null)
    .sort((a, b) => a.start - b.start);

  if (normalized.length === 0) return '';

  const chunks = new Map<number, { start: number; end: number; textParts: string[] }>();
  for (const segment of normalized) {
    const bucket = Math.floor(segment.start / OVERVIEW_TRANSCRIPT_CHUNK_SECONDS);
    const existing = chunks.get(bucket);
    if (existing) {
      existing.end = Math.max(existing.end, segment.end);
      existing.textParts.push(segment.text);
      continue;
    }

    chunks.set(bucket, {
      start: bucket * OVERVIEW_TRANSCRIPT_CHUNK_SECONDS,
      end: segment.end,
      textParts: [segment.text],
    });
  }

  const lines = [...chunks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, OVERVIEW_TRANSCRIPT_MAX_LINES)
    .map(([, chunk]) => {
      const text = chunk.textParts.join(' ').replace(/\s+/g, ' ').trim();
      return `[${chunk.start.toFixed(2)}-${chunk.end.toFixed(2)}] ${text}`;
    });

  return lines.join('\n').slice(0, OVERVIEW_TRANSCRIPT_MAX_CHARS);
}
