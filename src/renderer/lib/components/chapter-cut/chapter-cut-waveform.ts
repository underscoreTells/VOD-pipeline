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
