const DEFAULT_PREVIEW_FPS = 24;
const MIN_PREVIEW_FPS = 5;
const MAX_PREVIEW_FPS = 30;

export function clampPreviewFps(fps: number | null | undefined): number {
  if (typeof fps !== 'number' || !Number.isFinite(fps)) {
    return DEFAULT_PREVIEW_FPS;
  }

  return Math.min(MAX_PREVIEW_FPS, Math.max(MIN_PREVIEW_FPS, fps));
}

export function getReversePreviewFps(quality: 'quick' | 'full' | null): number {
  if (quality === 'quick') {
    return 10;
  }

  return 15;
}

export function snapToPreviewSample(time: number, fps: number): number {
  const normalizedFps = clampPreviewFps(fps);
  const frameDuration = 1 / normalizedFps;
  return Math.round(time / frameDuration) * frameDuration;
}
