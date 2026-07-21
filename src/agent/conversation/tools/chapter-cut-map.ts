import { getClipVisibleRangeInChapter } from "../../../shared/utils/clip-timing.js";
import type {
  ConversationChapterContext,
  ConversationClipContext,
  ConversationTurnInput,
  ConversationWriter,
} from "../types.js";
import {
  AgentToolDefinition,
  defineAgentTool,
} from "../../tools/define-tool.js";
import { loadChapterCutMapSchema } from "./schemas.js";
import type { LoadChapterCutMapInput } from "./schemas.js";
import {
  DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE,
  MAX_CHAPTER_CUT_MAP_PAGE_SIZE,
} from "./constants.js";

export interface ChapterCutMapClipEntry {
  id: number;
  assetId: number;
  trackIndex: number;
  inPoint: number;
  outPoint: number;
  visibleStartLocal: number;
  visibleEndLocal: number;
  visibleDuration: number;
  role: string | null;
  description: string | null;
  isEssential: boolean;
}

export interface ChapterCutMapPerAssetEntry {
  assetId: number;
  clipCount: number;
  retainedDuration: number;
}

export interface ChapterCutMapSummary {
  totalClips: number;
  essentialClips: number;
  retainedDuration: number;
  perAsset: ChapterCutMapPerAssetEntry[];
}

export interface ChapterCutMapResult {
  page: ChapterCutMapClipEntry[];
  pagination: {
    offset: number;
    limit: number;
    totalFiltered: number;
    totalAll: number;
    hasNext: boolean;
  };
  summary: ChapterCutMapSummary;
}

interface ResolvedClipRange {
  visibleStartLocal: number;
  visibleEndLocal: number;
}

export function summarizeChapterCutMap(
  clips: ConversationClipContext[],
  chapter?: ConversationChapterContext
): ChapterCutMapSummary {
  let essentialClips = 0;
  let retainedDuration = 0;
  const perAssetMap = new Map<
    number,
    { clipCount: number; retainedDuration: number }
  >();

  for (const clip of clips) {
    if (clip.isEssential) {
      essentialClips += 1;
    }

    const range = resolveChapterLocalClipRange(clip, chapter);
    const duration = Math.max(0, range.visibleEndLocal - range.visibleStartLocal);
    retainedDuration += duration;

    const assetEntry = perAssetMap.get(clip.assetId) ?? {
      clipCount: 0,
      retainedDuration: 0,
    };
    assetEntry.clipCount += 1;
    assetEntry.retainedDuration += duration;
    perAssetMap.set(clip.assetId, assetEntry);
  }

  const perAsset = Array.from(perAssetMap.entries())
    .sort(([assetA], [assetB]) => assetA - assetB)
    .map(([assetId, entry]) => ({ assetId, ...entry }));

  return {
    totalClips: clips.length,
    essentialClips,
    retainedDuration,
    perAsset,
  };
}

export function createLoadChapterCutMapTool(
  input: ConversationTurnInput,
  writer: ConversationWriter | undefined
): AgentToolDefinition {
  return defineAgentTool<LoadChapterCutMapInput>({
    name: "loadChapterCutMap",
    description:
      "Load a bounded, paginated, filterable view of the current chapter cut map (all input.context.chapterClips) when the 18-line preview in the system prompt is not enough. Use this for whole-chapter review requests (audit the full cut, review every clip, or assess overall pacing). Supports optional chapter-local startLocalTime/endLocalTime bounds (filters by visible-range overlap), an explicit clipIds filter, and offset/limit pagination. Returns per-clip details with chapter-local visible ranges and durations, pagination metadata, and a compact summary for the filtered set. This tool only provides evidence and never creates recommendations.",
    schema: loadChapterCutMapSchema,
    execute: async ({ startLocalTime, endLocalTime, clipIds, offset, limit }) => {
      writer?.writeStatus({
        status: "loading_chapter_cut_map",
        message: "Loading the current chapter cut map...",
        progress: 50,
        nodeName: "conversation_runner",
      });

      const chapter = input.context.chapter;
      const allClips = input.context.chapterClips;
      const pageOffset = clampNonNegativeInt(offset, 0);
      const pageLimit = clampPositiveInt(
        limit,
        DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE,
        MAX_CHAPTER_CUT_MAP_PAGE_SIZE
      );

      const filteredClips = filterChapterClips(allClips, chapter, {
        startLocalTime,
        endLocalTime,
        clipIds,
      });

      // Paginate in narrative order: the input list is ordered by track, so
      // sort by source in-point (stable id tie-breaker) before slicing.
      const sortedClips = [...filteredClips].sort(
        (left, right) => left.inPoint - right.inPoint || left.id - right.id
      );

      const totalFiltered = sortedClips.length;
      const totalAll = allClips.length;
      const page = sortedClips.slice(pageOffset, pageOffset + pageLimit);

      const payload: ChapterCutMapResult = {
        page: page.map((clip) => buildClipEntry(clip, chapter)),
        pagination: {
          offset: pageOffset,
          limit: pageLimit,
          totalFiltered,
          totalAll,
          hasNext: pageOffset + pageLimit < totalFiltered,
        },
        summary: summarizeChapterCutMap(filteredClips, chapter),
      };

      return JSON.stringify(payload);
    },
  });
}

function filterChapterClips(
  clips: ConversationClipContext[],
  chapter: ConversationChapterContext | undefined,
  filters: {
    startLocalTime?: number;
    endLocalTime?: number;
    clipIds?: number[];
  }
): ConversationClipContext[] {
  const clipIdSet = filters.clipIds ? new Set(filters.clipIds) : null;
  const start = filters.startLocalTime;
  const end = filters.endLocalTime;
  const hasTimeFilter = typeof start === "number" || typeof end === "number";

  return clips.filter((clip) => {
    if (clipIdSet && !clipIdSet.has(clip.id)) {
      return false;
    }

    if (!hasTimeFilter) {
      return true;
    }

    const range = resolveChapterLocalClipRange(clip, chapter);

    if (typeof start === "number" && range.visibleEndLocal < start) {
      return false;
    }

    if (typeof end === "number" && range.visibleStartLocal > end) {
      return false;
    }

    return true;
  });
}

function buildClipEntry(
  clip: ConversationClipContext,
  chapter: ConversationChapterContext | undefined
): ChapterCutMapClipEntry {
  const range = resolveChapterLocalClipRange(clip, chapter);
  return {
    id: clip.id,
    assetId: clip.assetId,
    trackIndex: clip.trackIndex,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    visibleStartLocal: range.visibleStartLocal,
    visibleEndLocal: range.visibleEndLocal,
    visibleDuration: Math.max(
      0,
      range.visibleEndLocal - range.visibleStartLocal
    ),
    role: clip.role,
    description: clip.description,
    isEssential: clip.isEssential,
  };
}

function resolveChapterLocalClipRange(
  clip: ConversationClipContext,
  chapter: ConversationChapterContext | undefined
): ResolvedClipRange {
  if (!chapter) {
    return {
      visibleStartLocal: clip.inPoint,
      visibleEndLocal: clip.outPoint,
    };
  }

  const visibleRange = getClipVisibleRangeInChapter(
    {
      in_point: clip.inPoint,
      out_point: clip.outPoint,
    },
    {
      start_time: chapter.startTime,
      end_time: chapter.endTime,
    }
  );

  const fallbackStart = clip.inPoint;
  const fallbackEnd = clip.outPoint;
  const visibleStartLocal = Math.max(
    0,
    (visibleRange?.start ?? fallbackStart) - chapter.startTime
  );
  const visibleEndLocal = Math.max(
    visibleStartLocal,
    (visibleRange?.end ?? fallbackEnd) - chapter.startTime
  );

  return {
    visibleStartLocal,
    visibleEndLocal,
  };
}

function clampNonNegativeInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(max, Math.floor(value));
}
