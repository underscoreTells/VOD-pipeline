import { describe, expect, it } from "vitest";
import { generateChapterTitleFromFilename } from "../../src/renderer/lib/state/chapter-import-helpers.js";
import { defaultSettings } from "../../src/renderer/lib/state/settings-helpers.js";

describe("dual-path import helpers", () => {
  it("keeps the import-related defaults enabled", () => {
    expect(defaultSettings.autoChapterNamingEnabled).toBe(true);
    expect(defaultSettings.autoChapterNamingModel).toBe("gpt-4o-mini");
    expect(defaultSettings.autoTranscribeOnImport).toBe(true);
  });

  it("derives chapter titles from POSIX and Windows paths", () => {
    expect(generateChapterTitleFromFilename("/path/to/video.mp4", [])).toBe("video");
    expect(generateChapterTitleFromFilename("C:\\Users\\test\\clip.mkv", [])).toBe("clip");
    expect(generateChapterTitleFromFilename("my_video_file_001.mp4", [])).toBe("my_video_file_001");
  });

  it("deduplicates generated chapter titles with numeric suffixes", () => {
    expect(generateChapterTitleFromFilename("intro.mp4", ["intro"])).toBe("intro_1");
    expect(
      generateChapterTitleFromFilename("clip.mp4", ["clip", "clip_1", "clip_2"])
    ).toBe("clip_3");
    expect(generateChapterTitleFromFilename("video.mkv", ["video"])).toBe("video_1");
  });
});
