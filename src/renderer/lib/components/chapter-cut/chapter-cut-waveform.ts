export type ChapterWaveformStatus = 'loading' | 'ready' | 'unavailable';

interface ShouldRequestChapterWaveformParams {
  assetId: number;
  waveformAssetId: number | null;
  waveformStatus: ChapterWaveformStatus;
  isInFlight: boolean;
}

export function shouldRequestChapterWaveform({
  assetId,
  waveformAssetId,
  waveformStatus,
  isInFlight,
}: ShouldRequestChapterWaveformParams): boolean {
  if (isInFlight) return false;
  if (waveformAssetId !== assetId) return true;
  return waveformStatus === 'loading';
}

interface ShouldReloadWaveformOnProgressParams {
  eventAssetId: number;
  primaryAssetId: number | null;
  percent: number;
  isInFlight: boolean;
}

/**
 * A completed generation should trigger a reload only when no load for the
 * asset is already in flight — an in-flight load installs the generated
 * peaks itself, and re-entering would clear its tracking state and strand
 * the timeline in `loading`.
 */
export function shouldReloadWaveformOnProgress({
  eventAssetId,
  primaryAssetId,
  percent,
  isInFlight,
}: ShouldReloadWaveformOnProgressParams): boolean {
  if (eventAssetId !== primaryAssetId) return false;
  if (percent < 100) return false;
  return !isInFlight;
}
