export interface SeekableMediaElement {
  currentTime: number;
  seeking?: boolean;
  fastSeek?: (time: number) => void;
}

interface QueuedMediaSeekOptions {
  getVideo: () => SeekableMediaElement | null;
  normalizeTime: (time: number) => number;
  snapPreviewTime?: (time: number) => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
  epsilon?: number;
}

function clampEpsilonEqual(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) <= epsilon;
}

function defaultRequestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function defaultCancelFrame(id: number): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(id);
    return;
  }

  globalThis.clearTimeout(id as unknown as ReturnType<typeof globalThis.setTimeout>);
}

export function createQueuedMediaSeek(options: QueuedMediaSeekOptions) {
  const epsilon = options.epsilon ?? 0.001;
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;

  let latestPreviewTarget: number | null = null;
  let lastIssuedPreviewTarget: number | null = null;
  let previewFrameId: number | null = null;
  let seekInFlight = false;

  function normalizePreviewTarget(time: number): number {
    const normalizedTime = options.normalizeTime(time);
    if (!options.snapPreviewTime) {
      return normalizedTime;
    }

    return options.normalizeTime(options.snapPreviewTime(normalizedTime));
  }

  function clearScheduledPreviewFlush(): void {
    if (previewFrameId === null) {
      return;
    }

    cancelFrame(previewFrameId);
    previewFrameId = null;
  }

  function schedulePreviewFlush(): void {
    if (previewFrameId !== null) {
      return;
    }

    previewFrameId = requestFrame(() => {
      previewFrameId = null;
      flushPreviewSeek();
    });
  }

  function flushPreviewSeek(): void {
    const target = latestPreviewTarget;
    const video = options.getVideo();

    if (target === null || !video) {
      return;
    }

    if (seekInFlight || video.seeking) {
      return;
    }

    if (
      lastIssuedPreviewTarget !== null &&
      clampEpsilonEqual(lastIssuedPreviewTarget, target, epsilon)
    ) {
      return;
    }

    video.currentTime = target;
    lastIssuedPreviewTarget = target;
    seekInFlight = true;
  }

  return {
    preview(time: number): void {
      latestPreviewTarget = normalizePreviewTarget(time);
      schedulePreviewFlush();
    },

    commit(time: number): void {
      clearScheduledPreviewFlush();
      latestPreviewTarget = null;

      const video = options.getVideo();
      if (!video) {
        lastIssuedPreviewTarget = null;
        seekInFlight = false;
        return;
      }

      const nextTime = options.normalizeTime(time);
      video.currentTime = nextTime;
      lastIssuedPreviewTarget = nextTime;
      seekInFlight = true;
    },

    handleSeeked(): void {
      seekInFlight = false;

      if (
        latestPreviewTarget !== null &&
        (
          lastIssuedPreviewTarget === null ||
          !clampEpsilonEqual(latestPreviewTarget, lastIssuedPreviewTarget, epsilon)
        )
      ) {
        schedulePreviewFlush();
      }
    },

    reset(): void {
      clearScheduledPreviewFlush();
      latestPreviewTarget = null;
      lastIssuedPreviewTarget = null;
      seekInFlight = false;
    },
  };
}
