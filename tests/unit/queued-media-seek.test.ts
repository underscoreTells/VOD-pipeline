import { describe, expect, it, vi } from 'vitest';
import { createQueuedMediaSeek, type SeekableMediaElement } from '../../src/renderer/lib/utils/queuedMediaSeek.js';

type MockVideo = SeekableMediaElement & {
  fastSeek: ReturnType<typeof vi.fn>;
  writes: number[];
  resolveSeek: () => void;
};

function createMockVideo(options?: { keepSeekingOnSet?: boolean }): MockVideo {
  const keepSeekingOnSet = options?.keepSeekingOnSet ?? false;
  let currentTime = 0;

  const video = {
    seeking: false,
    writes: [] as number[],
    fastSeek: vi.fn((time: number) => {
      video.currentTime = time;
    }),
    resolveSeek: () => {
      video.seeking = false;
    },
    get currentTime() {
      return currentTime;
    },
    set currentTime(value: number) {
      currentTime = value;
      video.writes.push(value);
      if (keepSeekingOnSet) {
        video.seeking = true;
      }
    },
  } as MockVideo;

  return video;
}

function createFrameScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId += 1;
    callbacks.set(id, callback);
    return id;
  });

  const cancelFrame = vi.fn((id: number) => {
    callbacks.delete(id);
  });

  function flushNext(time = 0): boolean {
    const next = callbacks.entries().next();
    if (next.done) {
      return false;
    }

    const [id, callback] = next.value;
    callbacks.delete(id);
    callback(time);
    return true;
  }

  function flushAll(time = 0): void {
    while (flushNext(time)) {
      // drain pending animation frame callbacks
    }
  }

  return {
    requestFrame,
    cancelFrame,
    flushNext,
    flushAll,
    pendingCount: () => callbacks.size,
  };
}

describe('queued media seek', () => {
  it('uses precise currentTime for preview instead of fastSeek', () => {
    const video = createMockVideo();
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1.5);
    frameScheduler.flushAll();

    expect(video.fastSeek).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(1.5);
    expect(video.writes).toEqual([1.5]);
  });

  it('collapses rapid preview requests to the newest target before a frame flush', () => {
    const video = createMockVideo();
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1);
    controller.preview(2);
    controller.preview(3);
    frameScheduler.flushAll();

    expect(video.currentTime).toBe(3);
    expect(video.fastSeek).not.toHaveBeenCalled();
    expect(video.writes).toEqual([3]);
  });

  it('does not issue additional preview seeks while a prior seek is still unresolved', () => {
    const video = createMockVideo({ keepSeekingOnSet: true });
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1);
    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);
    expect(video.seeking).toBe(true);

    controller.preview(2);
    controller.preview(3);
    expect(frameScheduler.pendingCount()).toBe(1);

    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);
    expect(video.currentTime).toBe(1);
  });

  it('drains only the latest queued preview target after handleSeeked', () => {
    const video = createMockVideo({ keepSeekingOnSet: true });
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1);
    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);

    controller.preview(2);
    controller.preview(3);
    expect(frameScheduler.pendingCount()).toBe(1);

    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);

    video.resolveSeek();
    controller.handleSeeked();
    expect(frameScheduler.pendingCount()).toBe(1);

    frameScheduler.flushNext();
    expect(video.writes).toEqual([1, 3]);
    expect(video.currentTime).toBe(3);
  });

  it('commit cancels a queued preview target and seeks to the exact target immediately', () => {
    const video = createMockVideo({ keepSeekingOnSet: true });
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1);
    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);

    controller.preview(2);
    expect(frameScheduler.pendingCount()).toBe(1);

    controller.commit(4.25);
    expect(video.currentTime).toBe(4.25);
    expect(video.writes).toEqual([1, 4.25]);
    expect(frameScheduler.pendingCount()).toBe(0);

    video.resolveSeek();
    controller.handleSeeked();
    frameScheduler.flushAll();
    expect(video.currentTime).toBe(4.25);
  });

  it('reset clears scheduled preview work and pending targets', () => {
    const video = createMockVideo({ keepSeekingOnSet: true });
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1);
    frameScheduler.flushNext();
    expect(video.writes).toEqual([1]);

    controller.preview(2);
    expect(frameScheduler.pendingCount()).toBe(1);

    controller.reset();
    expect(frameScheduler.pendingCount()).toBe(0);
    expect(frameScheduler.cancelFrame).toHaveBeenCalledTimes(1);

    video.resolveSeek();
    controller.handleSeeked();
    frameScheduler.flushAll();
    expect(video.writes).toEqual([1]);
  });

  it('applies optional preview snapping before issuing the seek', () => {
    const video = createMockVideo();
    const frameScheduler = createFrameScheduler();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
      snapPreviewTime: (time) => Math.round(time * 2) / 2,
      requestFrame: frameScheduler.requestFrame,
      cancelFrame: frameScheduler.cancelFrame,
    });

    controller.preview(1.26);
    frameScheduler.flushNext();

    expect(video.currentTime).toBe(1.5);
    expect(video.writes).toEqual([1.5]);
  });
});
