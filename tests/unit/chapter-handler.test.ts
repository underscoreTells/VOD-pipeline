import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/electron/ipc/channels.js";

type MockIpcHandler = (...args: unknown[]) => unknown;

const registeredHandlers = vi.hoisted(() => new Map<string, MockIpcHandler>());

const electronMocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: MockIpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const databaseMocks = vi.hoisted(() => ({
  addAssetToChapter: vi.fn(),
  createChapter: vi.fn(),
  deleteChapter: vi.fn(),
  deleteDetailedTranscriptsByChapter: vi.fn(),
  deleteTranscriptsByChapter: vi.fn(),
  getAsset: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChaptersByProject: vi.fn(),
  removeAssetFromChapter: vi.fn(),
  updateChapter: vi.fn(),
}));

const handlerSupportMocks = vi.hoisted(() => ({
  ensureChapterReverseProxyQuickReady: vi.fn(),
  getChapterReverseProxyStatus: vi.fn(),
  invalidateChapterProxy: vi.fn(),
  invalidateChapterReverseProxy: vi.fn(),
  scheduleChapterMediaPrewarm: vi.fn(),
  scheduleChapterReverseProxyFullWarm: vi.fn(),
  toNumberOrNull: vi.fn((value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/ipc/handler-support.js", () => handlerSupportMocks);
vi.mock("../../src/electron/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("chapter handlers", () => {
  beforeEach(async () => {
    registeredHandlers.clear();
    Object.values(electronMocks.ipcMain).forEach((mock) => mock.mockClear());
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(handlerSupportMocks).forEach((mock) => mock.mockReset());

    databaseMocks.getChaptersByProject.mockResolvedValue([{ id: 11, title: "Intro" }]);
    databaseMocks.addAssetToChapter.mockResolvedValue(undefined);
    databaseMocks.deleteTranscriptsByChapter.mockResolvedValue(undefined);
    databaseMocks.deleteDetailedTranscriptsByChapter.mockResolvedValue(undefined);
    databaseMocks.getChapter.mockResolvedValue({
      id: 11,
      project_id: 1,
      start_time: 0,
      end_time: 60,
    });
    databaseMocks.getAsset.mockResolvedValue({
      id: 12,
      file_type: "video",
      file_path: "/tmp/input.mp4",
    });
    databaseMocks.getAssetsForChapter.mockResolvedValue([12]);
    handlerSupportMocks.getChapterReverseProxyStatus.mockResolvedValue({ status: "missing" });
    handlerSupportMocks.scheduleChapterMediaPrewarm.mockResolvedValue(undefined);
    handlerSupportMocks.ensureChapterReverseProxyQuickReady.mockResolvedValue(undefined);

    const { registerChapterHandlers } = await import("../../src/electron/ipc/handlers/chapters.js");
    registerChapterHandlers();
  });

  it("does not prewarm chapter proxies when listing chapters for a project", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.CHAPTER_GET_BY_PROJECT);

    const result = await handler?.({}, { projectId: 1 });

    expect(databaseMocks.getChaptersByProject).toHaveBeenCalledWith(1);
    expect(handlerSupportMocks.scheduleChapterMediaPrewarm).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: [{ id: 11, title: "Intro" }],
    });
  });

  it("only prewarms linked chapter proxies when explicitly requested", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.CHAPTER_ADD_ASSET);

    await handler?.({}, {
      chapterId: 11,
      assetId: 12,
      prewarmProxy: false,
      proxyOptions: {
        encodingMode: "gpu",
        quality: "fast",
      },
    });

    expect(databaseMocks.addAssetToChapter).toHaveBeenCalledWith(11, 12);
    expect(handlerSupportMocks.invalidateChapterProxy).toHaveBeenCalledWith(11, 12);
    expect(handlerSupportMocks.invalidateChapterReverseProxy).toHaveBeenCalledWith(11, 12);
    expect(handlerSupportMocks.scheduleChapterMediaPrewarm).not.toHaveBeenCalled();

    await handler?.({}, {
      chapterId: 11,
      assetId: 12,
      prewarmProxy: true,
      proxyOptions: {
        encodingMode: "gpu",
        quality: "fast",
      },
    });

    expect(handlerSupportMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledWith(11, 12, {
      encodingMode: "gpu",
      quality: "fast",
    });
  });

  it("promotes reverse proxy warmups to interactive mode when reverse playback requests them", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.CHAPTER_REVERSE_PROXY_GET);
    handlerSupportMocks.getChapterReverseProxyStatus
      .mockResolvedValueOnce({ status: "generating" })
      .mockResolvedValueOnce({ status: "generating" });

    const result = await handler?.({}, {
      chapterId: 11,
      assetId: 12,
      ensureReady: true,
      requestMode: "interactive",
      proxyOptions: {
        encodingMode: "gpu",
        quality: "fast",
      },
    });
    await Promise.resolve();

    expect(handlerSupportMocks.ensureChapterReverseProxyQuickReady).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11 }),
      expect.objectContaining({ id: 12 }),
      { encodingMode: "gpu", quality: "fast" },
      { priority: "interactive", executionMode: "interactive" }
    );
    expect(handlerSupportMocks.scheduleChapterReverseProxyFullWarm).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11 }),
      expect.objectContaining({ id: 12 }),
      { encodingMode: "gpu", quality: "fast" }
    );
    expect(result).toEqual({
      success: true,
      data: { status: "generating" },
    });
  });
});
