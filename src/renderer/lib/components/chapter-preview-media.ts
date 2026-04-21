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
