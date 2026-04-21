export interface SeekableMediaElement {
  currentTime: number;
  seeking?: boolean;
  fastSeek?: (time: number) => void;
}

interface QueuedMediaSeekOptions {
  getVideo: () => SeekableMediaElement | null;
  normalizeTime: (time: number) => number;
  epsilon?: number;
}

type QueuedSeekRequest = {
  time: number;
  precise: boolean;
};

function clampEpsilonEqual(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) <= epsilon;
}

export function createQueuedMediaSeek(options: QueuedMediaSeekOptions) {
  const epsilon = options.epsilon ?? 0.001;

  let seekInFlight = false;
  let pendingRequest: QueuedSeekRequest | null = null;

  function getNormalizedTime(time: number): number {
    return options.normalizeTime(time);
  }

  function issueSeek(request: QueuedSeekRequest): void {
    const video = options.getVideo();
    if (!video) {
      seekInFlight = false;
      return;
    }

    const nextTime = getNormalizedTime(request.time);
    const currentTime = video.currentTime;
    if (!video.seeking && clampEpsilonEqual(currentTime, nextTime, epsilon)) {
      seekInFlight = false;
      return;
    }

    seekInFlight = true;

    if (!request.precise && typeof video.fastSeek === 'function') {
      try {
        video.fastSeek(nextTime);
      } catch {
        video.currentTime = nextTime;
      }
      return;
    }

    video.currentTime = nextTime;
  }

  function enqueue(time: number, precise: boolean): void {
    const request = {
      time: getNormalizedTime(time),
      precise,
    };

    const video = options.getVideo();
    if (!video) return;

    if (seekInFlight || video.seeking) {
      pendingRequest = request;
      return;
    }

    issueSeek(request);
  }

  return {
    preview(time: number): void {
      enqueue(time, false);
    },

    commit(time: number): void {
      enqueue(time, true);
    },

    handleSeeked(): void {
      if (!pendingRequest) {
        seekInFlight = false;
        return;
      }

      const nextRequest = pendingRequest;
      pendingRequest = null;
      issueSeek(nextRequest);
    },

    reset(): void {
      seekInFlight = false;
      pendingRequest = null;
    },
  };
}
