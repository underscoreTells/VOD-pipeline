import { describe, expect, it, vi } from 'vitest';
import { createQueuedMediaSeek, type SeekableMediaElement } from '../../src/renderer/lib/utils/queuedMediaSeek.js';

type MockVideo = SeekableMediaElement & {
  fastSeek: ReturnType<typeof vi.fn>;
};

function createMockVideo(): MockVideo {
  const video: MockVideo = {
    currentTime: 0,
    seeking: false,
    fastSeek: vi.fn((time: number) => {
      video.currentTime = time;
    }),
  };

  return video;
}

describe('queued media seek', () => {
  it('performs one preview seek at a time and drains the latest queued request', () => {
    const video = createMockVideo();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
    });

    controller.preview(1);
    controller.preview(2);
    controller.preview(3);

    expect(video.fastSeek).toHaveBeenCalledTimes(1);
    expect(video.fastSeek).toHaveBeenLastCalledWith(1);

    controller.handleSeeked();

    expect(video.fastSeek).toHaveBeenCalledTimes(2);
    expect(video.fastSeek).toHaveBeenLastCalledWith(3);

    controller.handleSeeked();

    expect(video.fastSeek).toHaveBeenCalledTimes(2);
  });

  it('uses precise currentTime on commit even when fastSeek exists', () => {
    const video = createMockVideo();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
    });

    controller.commit(7.5);

    expect(video.fastSeek).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(7.5);
  });

  it('clears queued targets on reset', () => {
    const video = createMockVideo();
    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
    });

    controller.preview(4);
    controller.preview(9);
    controller.reset();
    controller.handleSeeked();

    expect(video.fastSeek).toHaveBeenCalledTimes(1);
    expect(video.fastSeek).toHaveBeenLastCalledWith(4);
  });

  it('falls back to currentTime if fastSeek throws', () => {
    const video = createMockVideo();
    video.fastSeek.mockImplementation(() => {
      throw new Error('fastSeek failed');
    });

    const controller = createQueuedMediaSeek({
      getVideo: () => video,
      normalizeTime: (time) => time,
    });

    controller.preview(6);

    expect(video.fastSeek).toHaveBeenCalledWith(6);
    expect(video.currentTime).toBe(6);
  });
});
