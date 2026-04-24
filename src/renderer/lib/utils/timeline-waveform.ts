interface WaveformPeakPair {
  min: number;
  max: number;
}

interface TimelineWaveformData {
  peaks: WaveformPeakPair[];
  duration: number;
}

interface TimelineChapterRange {
  start: number;
  end: number;
  duration: number;
}

export interface TimelineWaveformLoadPayload {
  peaks: Float32Array[];
  duration: number;
  hasRealWaveform: boolean;
}

const BLANK_WAVEFORM_PEAK_COUNT = 2048;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildWaveSurferPeaks(peaks: WaveformPeakPair[]): Float32Array | null {
  if (peaks.length === 0) {
    return null;
  }

  const values = new Float32Array(peaks.length);
  for (let index = 0; index < peaks.length; index += 1) {
    const peak = peaks[index];
    values[index] = Math.max(Math.abs(peak.min), Math.abs(peak.max));
  }
  return values;
}

function sliceWaveformData(
  waveformData: TimelineWaveformData,
  chapterRange: TimelineChapterRange,
  assetDurationSeconds: number | null
): WaveformPeakPair[] | null {
  const totalDuration = waveformData.duration;
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    return null;
  }

  const effectiveAssetDuration =
    assetDurationSeconds && assetDurationSeconds > 0
      ? assetDurationSeconds
      : totalDuration;

  const safeStart = clamp(chapterRange.start, 0, effectiveAssetDuration);
  const safeEnd = clamp(chapterRange.end, safeStart + 0.01, effectiveAssetDuration);
  const durationRatio = totalDuration / effectiveAssetDuration;
  const start = clamp(safeStart * durationRatio, 0, totalDuration);
  const end = clamp(safeEnd * durationRatio, start + 0.01, totalDuration);
  const peaksPerSecond = waveformData.peaks.length / totalDuration;
  const startIndex = Math.floor(start * peaksPerSecond);
  const endIndex = Math.ceil(end * peaksPerSecond);
  const slicedPeaks = waveformData.peaks.slice(startIndex, Math.max(startIndex + 1, endIndex));

  return slicedPeaks.length > 0 ? slicedPeaks : null;
}

export function resolveTimelineWaveformLoadPayload(params: {
  waveformData: TimelineWaveformData | null;
  chapterRange: TimelineChapterRange | null;
  assetDuration: number | null;
}): TimelineWaveformLoadPayload | null {
  const { waveformData, chapterRange, assetDuration } = params;

  if (!chapterRange || !Number.isFinite(chapterRange.duration) || chapterRange.duration <= 0) {
    return null;
  }

  if (!waveformData) {
    return {
      peaks: [new Float32Array(BLANK_WAVEFORM_PEAK_COUNT)],
      duration: chapterRange.duration,
      hasRealWaveform: false,
    };
  }

  const slicedPeaks = sliceWaveformData(waveformData, chapterRange, assetDuration);
  if (!slicedPeaks) {
    return null;
  }

  const loadPeaks = buildWaveSurferPeaks(slicedPeaks);
  if (!loadPeaks) {
    return null;
  }

  return {
    peaks: [loadPeaks],
    duration: chapterRange.duration,
    hasRealWaveform: true,
  };
}
