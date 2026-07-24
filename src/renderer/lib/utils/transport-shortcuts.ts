export const SHUTTLE_SPEED_TIERS = [1, 2, 4, 8] as const;

export function nextShuttleSpeed(current: number): number {
  return SHUTTLE_SPEED_TIERS.find((speed) => speed > current)
    ?? SHUTTLE_SPEED_TIERS[SHUTTLE_SPEED_TIERS.length - 1];
}

export function getArrowNavigationDelta(options: {
  key: string;
  shiftKey: boolean;
  fps: number;
  coarseJumpSeconds: number;
}): number | null {
  const direction = options.key === 'ArrowLeft' ? -1 : options.key === 'ArrowRight' ? 1 : 0;
  if (direction === 0) return null;
  const fps = Number.isFinite(options.fps) ? Math.max(1, Math.min(240, options.fps)) : 30;
  const coarseJump = Number.isFinite(options.coarseJumpSeconds)
    ? Math.max(1, Math.min(300, options.coarseJumpSeconds))
    : 10;
  return direction * (options.shiftKey ? coarseJump : 1 / fps);
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
