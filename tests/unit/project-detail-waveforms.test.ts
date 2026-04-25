import { describe, expect, it, vi } from "vitest";
import { createChapterWaveformScheduler } from "../../src/renderer/lib/components/project-detail-waveforms.js";

describe("project detail waveform helpers", () => {
  it("generates only the mix waveform for MKV assets", async () => {
    const generateAssetWaveform = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChapterWaveformScheduler({
      resolveAsset: () => ({
        id: 1,
        file_path: "/tmp/test.mkv",
        availability: { exists: true },
        metadata: { audioTracks: [{ index: 0 }, { index: 1 }] },
      }) as never,
      getAssetWaveform: vi.fn().mockResolvedValue(null),
      generateAssetWaveform,
      isPlaybackActive: () => true,
    });

    await scheduler.ensureChapterWaveforms([1], -1);

    expect(generateAssetWaveform).toHaveBeenCalledTimes(1);
    expect(generateAssetWaveform).toHaveBeenCalledWith(1, -1, {
      playbackActive: true,
    }, {
      uiMode: "background",
    });
  });

  it("passes background UI mode for single-track chapter prewarm", async () => {
    const generateAssetWaveform = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChapterWaveformScheduler({
      resolveAsset: () => ({
        id: 2,
        file_path: "/tmp/test.mp4",
        availability: { exists: true },
        metadata: { audioTracks: [{ index: 0 }] },
      }) as never,
      getAssetWaveform: vi.fn().mockResolvedValue(null),
      generateAssetWaveform,
      isPlaybackActive: () => false,
    });

    await scheduler.ensureChapterWaveforms([2], -1);

    expect(generateAssetWaveform).toHaveBeenCalledTimes(1);
    expect(generateAssetWaveform).toHaveBeenCalledWith(2, -1, {
      playbackActive: false,
    }, {
      uiMode: "background",
    });
  });

  it("skips generation when the mix waveform is already cached", async () => {
    const generateAssetWaveform = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChapterWaveformScheduler({
      resolveAsset: () => ({
        id: 3,
        file_path: "/tmp/test.mkv",
        availability: { exists: true },
        metadata: { audioTracks: [{ index: 0 }, { index: 1 }] },
      }) as never,
      getAssetWaveform: vi.fn().mockResolvedValue({ peaks: [] }),
      generateAssetWaveform,
      isPlaybackActive: () => true,
    });

    await scheduler.ensureChapterWaveforms([3], -1);

    expect(generateAssetWaveform).not.toHaveBeenCalled();
  });
});
