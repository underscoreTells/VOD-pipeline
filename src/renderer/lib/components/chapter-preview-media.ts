import type { Asset } from '$shared/types/database';
import type { AssetAvailability } from '$shared/contracts/ipc';
import { buildPlayableAssetUrl } from '../utils/media.js';

type AvailabilityAwareAsset = Asset & { availability?: AssetAvailability | null };

export type ChapterPreviewMediaDecision = 'clear' | 'reload' | 'seek';

export interface ResolveChapterPreviewMediaChangeParams {
  asset: AvailabilityAwareAsset | null;
  activeSource: 'normal' | 'reverse';
  currentVideoUrl: string | null;
}

export interface ResolveChapterPreviewMediaChangeResult {
  decision: ChapterPreviewMediaDecision;
  normalUrl: string | null;
}

export interface PreviewPlaybackRange {
  start: number;
  end: number;
}

export function resolveSegmentedPreviewTime(
  ranges: PreviewPlaybackRange[],
  time: number,
  direction: 1 | -1
): number {
  if (ranges.length <= 1) return time;

  if (direction === 1) {
    for (const range of ranges) {
      if (time < range.start) return range.start;
      if (time < range.end) return time;
    }
    return ranges[0].start;
  }

  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index];
    if (time > range.end) return range.end;
    if (time > range.start) return time;
  }
  return ranges[ranges.length - 1].end;
}

export function getSegmentedPreviewDuration(ranges: PreviewPlaybackRange[]): number {
  return ranges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
}

export function toSegmentedPreviewLocalTime(
  ranges: PreviewPlaybackRange[],
  globalTime: number
): number {
  let elapsed = 0;
  for (const range of ranges) {
    const duration = Math.max(0, range.end - range.start);
    if (globalTime <= range.start) return elapsed;
    if (globalTime <= range.end) return elapsed + globalTime - range.start;
    elapsed += duration;
  }
  return elapsed;
}

export function fromSegmentedPreviewLocalTime(
  ranges: PreviewPlaybackRange[],
  localTime: number
): number {
  let remaining = Math.max(0, localTime);
  for (const range of ranges) {
    const duration = Math.max(0, range.end - range.start);
    if (remaining <= duration) return range.start + remaining;
    remaining -= duration;
  }
  return ranges[ranges.length - 1]?.end ?? 0;
}

export function resolveChapterPreviewMediaChange(
  params: ResolveChapterPreviewMediaChangeParams
): ResolveChapterPreviewMediaChangeResult {
  if (!params.asset) {
    return { decision: 'clear', normalUrl: null };
  }

  const normalUrl = buildPlayableAssetUrl(params.asset);
  if (!normalUrl) {
    return { decision: 'clear', normalUrl: null };
  }

  if (params.activeSource !== 'normal') {
    return { decision: 'reload', normalUrl };
  }

  if (params.currentVideoUrl !== normalUrl) {
    return { decision: 'reload', normalUrl };
  }

  return { decision: 'seek', normalUrl };
}
