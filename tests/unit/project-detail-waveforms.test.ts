import { describe, expect, it, vi } from "vitest";
import {
  createChapterWaveformScheduler,
  getWaveformTrackIndices,
} from "../../src/renderer/lib/components/project-detail-waveforms.js";

describe("project detail waveform helpers", () => {
  it("returns only the mix track when source tracks are hidden", () => {
    const asset = {
      id: 1,
      file_path: "/tmp/test.mkv",
      metadata: {
        audioTracks: [{ index: 0 }, { index: 1 }],
      },
    };

    expect(getWaveformTrackIndices(asset as never, false, -1)).toEqual([-1]);
    expect(getWaveformTrackIndices(asset as never, true, -1)).toEqual([-1, 0, 1]);
  });

  it("batches mkv source-track generation when any track is missing", async () => {
    const generateAssetWaveform = vi.fn().mockResolvedValue(undefined);
    const scheduler = createChapterWaveformScheduler({
      resolveAsset: () => ({
        id: 1,
        file_path: "/tmp/test.mkv",
        availability: { exists: true },
        metadata: { audioTracks: [{ index: 0 }, { index: 1 }] },
      }) as never,
      getAssetWaveform: vi
        .fn()
        .mockResolvedValueOnce({ peaks: [] })
        .mockResolvedValueOnce(null),
      generateAssetWaveform,
      isPlaybackActive: () => true,
    });

    await scheduler.ensureChapterWaveforms([1], true, -1);

    expect(generateAssetWaveform).toHaveBeenCalledTimes(1);
    expect(generateAssetWaveform).toHaveBeenCalledWith(1, -1, {
      includeSourceTracks: true,
      playbackActive: true,
    });
  });
});
