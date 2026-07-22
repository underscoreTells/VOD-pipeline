import { describe, expect, it } from "vitest";
import {
  resolveChapterPreviewMediaChange,
  resolveSegmentedPreviewTime,
} from "../../src/renderer/lib/components/chapter-preview-media.js";

describe("chapter preview media decisions", () => {
  it("returns seek when the next chapter uses the currently loaded asset URL", () => {
    const asset = {
      id: 42,
      availability: { exists: true },
    };

    expect(resolveChapterPreviewMediaChange({
      asset: asset as never,
      activeSource: "normal",
      currentVideoUrl: "vod://asset/42",
    })).toEqual({
      decision: "seek",
      normalUrl: "vod://asset/42",
    });
  });

  it("returns reload when the next chapter uses a different asset URL", () => {
    const asset = {
      id: 43,
      availability: { exists: true },
    };

    expect(resolveChapterPreviewMediaChange({
      asset: asset as never,
      activeSource: "normal",
      currentVideoUrl: "vod://asset/42",
    })).toEqual({
      decision: "reload",
      normalUrl: "vod://asset/43",
    });
  });

  it("returns clear when there is no playable asset", () => {
    const unavailableAsset = {
      id: 44,
      availability: { exists: false },
    };

    expect(resolveChapterPreviewMediaChange({
      asset: null,
      activeSource: "normal",
      currentVideoUrl: "vod://asset/42",
    })).toEqual({
      decision: "clear",
      normalUrl: null,
    });

    expect(resolveChapterPreviewMediaChange({
      asset: unavailableAsset as never,
      activeSource: "normal",
      currentVideoUrl: "vod://asset/42",
    })).toEqual({
      decision: "clear",
      normalUrl: null,
    });
  });

  it("returns reload when switching away from a reverse preview source", () => {
    const asset = {
      id: 42,
      availability: { exists: true },
    };

    expect(resolveChapterPreviewMediaChange({
      asset: asset as never,
      activeSource: "reverse",
      currentVideoUrl: "vod://reverse/99/42/full",
    })).toEqual({
      decision: "reload",
      normalUrl: "vod://asset/42",
    });
  });

  it("skips omitted ranges while previewing segmented suggestions", () => {
    const ranges = [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
      { start: 50, end: 60 },
    ];

    expect(resolveSegmentedPreviewTime(ranges, 25, 1)).toBe(30);
    expect(resolveSegmentedPreviewTime(ranges, 45, 1)).toBe(50);
    expect(resolveSegmentedPreviewTime(ranges, 61, 1)).toBe(10);
    expect(resolveSegmentedPreviewTime(ranges, 45, -1)).toBe(40);
    expect(resolveSegmentedPreviewTime(ranges, 25, -1)).toBe(20);
    expect(resolveSegmentedPreviewTime(ranges, 9, -1)).toBe(60);
  });
});
