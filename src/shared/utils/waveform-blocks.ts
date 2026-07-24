export const WAVEFORM_BLOCK_DURATION_SECONDS = 5 * 60;
export const DEFAULT_WAVEFORM_PIXELS_PER_SECOND = 50;

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
