import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DetailedTranscriptWindow, TranscriptDetailRequest } from "../types/agent-ipc.js";
import type { Asset, DetailedTranscript } from "../types/database.js";
import {
  getAsset,
  getDetailedTranscriptWindow,
  upsertDetailedTranscript,
} from "../../electron/database/index.js";
import { extractAudio } from "../../pipeline/ffmpeg.js";
import { transcribe } from "../../pipeline/whisper.js";

const MAX_DETAILED_TRANSCRIPT_REQUESTS = 3;
const MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS = 90;
const DETAILED_TRANSCRIPT_MODEL = "small";
const DETAILED_TRANSCRIPT_COMPUTE_TYPE: "int8" | "float16" = "int8";
const DETAILED_TRANSCRIPT_WORD_TIMESTAMPS = true;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapDetailedTranscriptForContext(
  detailed: DetailedTranscript,
  reason?: string
): DetailedTranscriptWindow {
  return {
    assetId: detailed.asset_id,
    windowStart: detailed.window_start,
    windowEnd: detailed.window_end,
    reason,
    text: detailed.text,
    segments: detailed.segments_json,
  };
}

export function normalizeTranscriptDetailRequests(
  value: unknown,
  chapterDuration: number,
  chapterAssetIds: number[]
): TranscriptDetailRequest[] {
  if (!Array.isArray(value)) return [];

  const chapterAssetSet = new Set(chapterAssetIds);
  const dedupe = new Set<string>();
  const requests: TranscriptDetailRequest[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    const startRaw = typeof record.windowStart === "number" ? record.windowStart : NaN;
    const endRaw = typeof record.windowEnd === "number" ? record.windowEnd : NaN;
    if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) continue;

    const start = clamp(startRaw, 0, chapterDuration);
    let end = clamp(endRaw, 0, chapterDuration);
    if (end <= start) continue;

    if (end - start > MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS) {
      end = Math.min(chapterDuration, start + MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS);
    }

    const normalizedStart = roundSeconds(start);
    const normalizedEnd = roundSeconds(end);
    if (normalizedEnd <= normalizedStart) continue;

    let assetId: number | undefined;
    if (
      typeof record.assetId === "number" &&
      Number.isFinite(record.assetId) &&
      chapterAssetSet.has(record.assetId)
    ) {
      assetId = record.assetId;
    }

    const reason =
      typeof record.reason === "string" && record.reason.trim().length > 0
        ? record.reason.trim().slice(0, 240)
        : undefined;

    const key = `${assetId ?? "auto"}:${normalizedStart}-${normalizedEnd}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    requests.push({
      windowStart: normalizedStart,
      windowEnd: normalizedEnd,
      assetId,
      reason,
    });

    if (requests.length >= MAX_DETAILED_TRANSCRIPT_REQUESTS) {
      break;
    }
  }

  return requests;
}

export async function generateDetailedTranscriptsForRequests(
  chapter: {
    id: number;
    start_time: number;
    end_time: number;
  },
  chapterAssetIds: number[],
  requests: TranscriptDetailRequest[]
): Promise<DetailedTranscriptWindow[]> {
  if (requests.length === 0) return [];

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const chapterAssetSet = new Set(chapterAssetIds);
  const windows: DetailedTranscriptWindow[] = [];

  for (const request of requests) {
    const assetId = request.assetId ?? chapterAssetIds[0];
    if (!assetId || !chapterAssetSet.has(assetId)) {
      continue;
    }

    const windowStart = roundSeconds(clamp(request.windowStart, 0, chapterDuration));
    const requestedEnd = roundSeconds(clamp(request.windowEnd, 0, chapterDuration));
    const maxEnd = windowStart + MAX_DETAILED_TRANSCRIPT_WINDOW_SECONDS;
    const windowEnd = roundSeconds(Math.min(requestedEnd, chapterDuration, maxEnd));
    if (windowEnd <= windowStart) continue;

    const cached = await getDetailedTranscriptWindow(
      chapter.id,
      assetId,
      windowStart,
      windowEnd,
      DETAILED_TRANSCRIPT_MODEL,
      DETAILED_TRANSCRIPT_COMPUTE_TYPE,
      DETAILED_TRANSCRIPT_WORD_TIMESTAMPS
    );

    if (cached) {
      windows.push(mapDetailedTranscriptForContext(cached, request.reason));
      continue;
    }

    const asset = await getAsset(assetId);
    if (!asset) {
      continue;
    }

    const generatedWindow = await generateDetailedTranscriptWindow(
      chapter,
      asset,
      windowStart,
      windowEnd,
      request.reason
    );

    if (generatedWindow) {
      windows.push(generatedWindow);
    }
  }

  return windows.sort((a, b) => a.windowStart - b.windowStart);
}

async function generateDetailedTranscriptWindow(
  chapter: {
    id: number;
    start_time: number;
    end_time: number;
  },
  asset: Asset,
  windowStart: number,
  windowEnd: number,
  reason?: string
): Promise<DetailedTranscriptWindow | null> {
  const tempAudioPath = path.join(
    os.tmpdir(),
    `vod-pipeline-detailed-${chapter.id}-${asset.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
  );

  try {
    const globalStart = roundSeconds(chapter.start_time + windowStart);
    const globalEnd = roundSeconds(chapter.start_time + windowEnd);

    await extractAudio(asset.file_path, tempAudioPath, {
      trackIndex: 0,
      sampleRate: 16000,
      channels: 1,
      startTime: globalStart,
      endTime: globalEnd,
    });

    const transcription = await transcribe({
      audioPath: tempAudioPath,
      model: DETAILED_TRANSCRIPT_MODEL,
      computeType: DETAILED_TRANSCRIPT_COMPUTE_TYPE,
      wordTimestamps: DETAILED_TRANSCRIPT_WORD_TIMESTAMPS,
    });

    const detailedSegments = transcription.segments.map((segment, index) => ({
      id: typeof segment.id === "number" && Number.isFinite(segment.id) ? segment.id : index,
      start: roundSeconds(windowStart + segment.start),
      end: roundSeconds(windowStart + segment.end),
      text: segment.text,
      words: Array.isArray(segment.words)
        ? segment.words.map((word) => ({
            word: word.word,
            start: roundSeconds(windowStart + word.start),
            end: roundSeconds(windowStart + word.end),
            probability: word.probability,
          }))
        : undefined,
    }));

    const saved = await upsertDetailedTranscript({
      chapter_id: chapter.id,
      asset_id: asset.id,
      window_start: windowStart,
      window_end: windowEnd,
      model: DETAILED_TRANSCRIPT_MODEL,
      compute_type: DETAILED_TRANSCRIPT_COMPUTE_TYPE,
      word_timestamps: DETAILED_TRANSCRIPT_WORD_TIMESTAMPS,
      text: transcription.text,
      segments_json: detailedSegments,
    });

    return mapDetailedTranscriptForContext(saved, reason);
  } catch (error) {
    console.warn(
      `[AgentChat] Failed to generate detailed transcript for chapter=${chapter.id} asset=${asset.id} window=${windowStart}-${windowEnd}:`,
      error
    );
    return null;
  } finally {
    if (fs.existsSync(tempAudioPath)) {
      fs.unlinkSync(tempAudioPath);
    }
  }
}
