export const WAVEFORM_BLOCK_DURATION_SECONDS = 5 * 60;
export const WAVEFORM_RESOLUTION_TIERS = [1, 4, 16, 64, 256, 500] as const;
export const COARSE_WAVEFORM_PIXELS_PER_SECOND = WAVEFORM_RESOLUTION_TIERS[0];
export const STANDARD_WAVEFORM_PIXELS_PER_SECOND = WAVEFORM_RESOLUTION_TIERS[2];
export const DEFAULT_WAVEFORM_PIXELS_PER_SECOND = STANDARD_WAVEFORM_PIXELS_PER_SECOND;

export function getWaveformResolutionForZoom(pixelsPerSecond: number): number {
  const safePixelsPerSecond = Number.isFinite(pixelsPerSecond)
    ? Math.max(COARSE_WAVEFORM_PIXELS_PER_SECOND, pixelsPerSecond)
    : COARSE_WAVEFORM_PIXELS_PER_SECOND;
  return WAVEFORM_RESOLUTION_TIERS.find((tier) => tier >= safePixelsPerSecond)
    ?? WAVEFORM_RESOLUTION_TIERS[WAVEFORM_RESOLUTION_TIERS.length - 1];
}

export function getWaveformBlockKey(blockIndex: number, pixelsPerSecond: number): string {
  return `${pixelsPerSecond}:${blockIndex}`;
}

export function getWaveformBlockIndexes(
  startTime: number,
  endTime: number,
  blockDuration = WAVEFORM_BLOCK_DURATION_SECONDS
): number[] {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new Error('Waveform range must have a finite endTime greater than startTime');
  }
  const first = Math.max(0, Math.floor(startTime / blockDuration));
  const last = Math.max(first, Math.ceil(endTime / blockDuration) - 1);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}
