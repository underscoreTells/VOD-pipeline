import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapterProxyByChapterAsset: vi.fn(),
  getChaptersByProject: vi.fn(),
}));

const chapterProxyMocks = vi.hoisted(() => ({
  getReusableChapterProxy: vi.fn(),
  recoverChapterProxyIfCurrent: vi.fn(),
  scheduleChapterMediaPrewarm: vi.fn(),
}));

vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/ipc/support/chapter-proxies.js", () => chapterProxyMocks);

describe("project proxy prewarm", () => {
  beforeEach(() => {
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(chapterProxyMocks).forEach((mock) => mock.mockReset());
    databaseMocks.getChaptersByProject.mockResolvedValue([
      { id: 1, start_time: 0, end_time: 10 },
      { id: 2, start_time: 10, end_time: 20 },
    ]);
    databaseMocks.getAssetsByProject.mockResolvedValue([
      { id: 11, file_type: "video" },
      { id: 12, file_type: "audio" },
    ]);
    databaseMocks.getAssetsForChapter.mockResolvedValue([11, 12]);
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue(null);
    chapterProxyMocks.recoverChapterProxyIfCurrent.mockImplementation(async (proxy) => proxy);
    chapterProxyMocks.getReusableChapterProxy.mockResolvedValue(null);
    chapterProxyMocks.scheduleChapterMediaPrewarm.mockResolvedValue(undefined);
  });

  it("accepts missing linked video proxies without waiting for completion", async () => {
    let finish!: () => void;
    chapterProxyMocks.scheduleChapterMediaPrewarm.mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const { scheduleProjectProxyPrewarm } = await import(
      "../../src/electron/ipc/support/project-prewarm.js"
    );

    const result = await scheduleProjectProxyPrewarm(7, {
      encodingMode: "gpu",
      quality: "fast",
    });

    expect(result).toEqual({ accepted: 2, skipped: 0 });
    expect(chapterProxyMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledTimes(2);
    expect(chapterProxyMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledWith(1, 11, {
      encodingMode: "gpu",
      quality: "fast",
    });
    finish();
  });

  it("skips reusable proxies and non-video assets", async () => {
    chapterProxyMocks.getReusableChapterProxy
      .mockResolvedValueOnce({ file_path: "/tmp/reusable.mp4" })
      .mockResolvedValueOnce(null);
    const { scheduleProjectProxyPrewarm } = await import(
      "../../src/electron/ipc/support/project-prewarm.js"
    );

    const result = await scheduleProjectProxyPrewarm(7);

    expect(result).toEqual({ accepted: 1, skipped: 1 });
    expect(chapterProxyMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledOnce();
    expect(chapterProxyMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledWith(2, 11, undefined);
  });
});
