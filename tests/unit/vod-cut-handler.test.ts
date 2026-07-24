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
  clearVodCutDraft: vi.fn(),
  commitVodCut: vi.fn(),
  loadVodCutDraft: vi.fn(),
  saveVodCutDraft: vi.fn(),
}));

const supportMocks = vi.hoisted(() => ({
  scheduleChapterMediaPrewarm: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/ipc/handler-support.js", () => supportMocks);
vi.mock("../../src/electron/logger.js", () => ({
  createLogger: () => loggerMocks,
}));

describe("vod-cut handlers", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    electronMocks.ipcMain.handle.mockClear();
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(supportMocks).forEach((mock) => mock.mockReset());
    Object.values(loggerMocks).forEach((mock) => mock.mockReset());
    supportMocks.scheduleChapterMediaPrewarm.mockResolvedValue(undefined);

    const { registerVodCutHandlers } = await import(
      "../../src/electron/ipc/handlers/vod-cuts.js"
    );
    registerVodCutHandlers();
  });

  it("registers all four vod-cut channels exactly once", () => {
    expect(electronMocks.ipcMain.handle).toHaveBeenCalledTimes(4);
    expect(registeredHandlers.has(IPC_CHANNELS.VOD_CUT_DRAFT_SAVE)).toBe(true);
    expect(registeredHandlers.has(IPC_CHANNELS.VOD_CUT_DRAFT_LOAD)).toBe(true);
    expect(registeredHandlers.has(IPC_CHANNELS.VOD_CUT_DRAFT_CLEAR)).toBe(true);
    expect(registeredHandlers.has(IPC_CHANNELS.VOD_CUT_COMMIT)).toBe(true);
  });

  it("routes save draft ranges through to saveVodCutDraft", async () => {
    const draft = {
      project_id: 7,
      asset_id: 9,
      ranges: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    databaseMocks.saveVodCutDraft.mockResolvedValue(draft);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_DRAFT_SAVE);
    const result = await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [
        { id: "a", title: "Intro", start_time: 0, end_time: 120 },
        { id: "b", title: "Mid", start_time: 120, end_time: 300 },
      ],
      view: { playheadTime: 42, pixelsPerSecond: 8, scrollLeft: 120 },
    });

    expect(databaseMocks.saveVodCutDraft).toHaveBeenCalledWith(
      7,
      9,
      [
        { id: "a", title: "Intro", start_time: 0, end_time: 120 },
        { id: "b", title: "Mid", start_time: 120, end_time: 300 },
      ],
      { playheadTime: 42, pixelsPerSecond: 8, scrollLeft: 120 },
    );
    expect(result).toEqual({ success: true, data: draft });
  });

  it("routes load draft keys through to loadVodCutDraft", async () => {
    const draft = {
      project_id: 7,
      asset_id: 9,
      ranges: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    databaseMocks.loadVodCutDraft.mockResolvedValue(draft);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_DRAFT_LOAD);
    const result = await handler?.({}, { projectId: 7, assetId: 9 });

    expect(databaseMocks.loadVodCutDraft).toHaveBeenCalledWith(7, 9);
    expect(result).toEqual({ success: true, data: draft });
  });

  it("routes clear draft keys through to clearVodCutDraft", async () => {
    databaseMocks.clearVodCutDraft.mockResolvedValue(true);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_DRAFT_CLEAR);
    const result = await handler?.({}, { projectId: 7, assetId: 9 });

    expect(databaseMocks.clearVodCutDraft).toHaveBeenCalledWith(7, 9);
    expect(result).toEqual({ success: true, data: null });
  });

  it("forwards the ranges payload to commitVodCut in chronological order", async () => {
    const chapters = [
      {
        id: 101,
        project_id: 7,
        title: "Intro",
        start_time: 0,
        end_time: 120,
        display_order: 0,
        created_at: "t1",
      },
      {
        id: 102,
        project_id: 7,
        title: "Mid",
        start_time: 120,
        end_time: 300,
        display_order: 1,
        created_at: "t2",
      },
    ];
    databaseMocks.commitVodCut.mockResolvedValue(chapters);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);
    const ranges = [
      { title: "Intro", startTime: 0, endTime: 120 },
      { title: "Mid", startTime: 120, endTime: 300 },
    ];
    const result = await handler?.({}, { projectId: 7, assetId: 9, ranges });

    expect(databaseMocks.commitVodCut).toHaveBeenCalledWith(7, 9, ranges);
    expect(result).toEqual({ success: true, data: chapters });
  });

  it("schedules prewarm for each returned chapter when prewarmProxy is requested", async () => {
    const chapters = [
      {
        id: 101,
        project_id: 7,
        title: "Intro",
        start_time: 0,
        end_time: 120,
        display_order: 0,
        created_at: "t1",
      },
      {
        id: 102,
        project_id: 7,
        title: "Mid",
        start_time: 120,
        end_time: 300,
        display_order: 1,
        created_at: "t2",
      },
    ];
    databaseMocks.commitVodCut.mockResolvedValue(chapters);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);
    const proxyOptions = { encodingMode: "gpu", quality: "fast" };
    await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [
        { title: "Intro", startTime: 0, endTime: 120 },
        { title: "Mid", startTime: 120, endTime: 300 },
      ],
      prewarmProxy: true,
      proxyOptions,
    });

    expect(supportMocks.scheduleChapterMediaPrewarm).toHaveBeenCalledTimes(2);
    expect(supportMocks.scheduleChapterMediaPrewarm).toHaveBeenNthCalledWith(
      1,
      101,
      9,
      proxyOptions,
    );
    expect(supportMocks.scheduleChapterMediaPrewarm).toHaveBeenNthCalledWith(
      2,
      102,
      9,
      proxyOptions,
    );
  });

  it("does not schedule prewarm when prewarmProxy is omitted", async () => {
    const chapters = [
      {
        id: 101,
        project_id: 7,
        title: "Intro",
        start_time: 0,
        end_time: 120,
        display_order: 0,
        created_at: "t1",
      },
    ];
    databaseMocks.commitVodCut.mockResolvedValue(chapters);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);
    await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [{ title: "Intro", startTime: 0, endTime: 120 }],
    });

    expect(supportMocks.scheduleChapterMediaPrewarm).not.toHaveBeenCalled();
  });

  it("returns a validation failure for schema-invalid commit payloads without calling the database", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);

    const result = await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [],
    });

    expect(databaseMocks.commitVodCut).not.toHaveBeenCalled();
    expect(supportMocks.scheduleChapterMediaPrewarm).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  });

  it("maps overlap errors from commitVodCut to a validation failure", async () => {
    const overlapError = new Error("Chapter ranges cannot overlap");
    overlapError.name = "VodCutValidationError";
    databaseMocks.commitVodCut.mockRejectedValue(overlapError);

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);
    const result = await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [
        { title: "A", startTime: 0, endTime: 200 },
        { title: "B", startTime: 100, endTime: 300 },
      ],
    });

    expect(databaseMocks.commitVodCut).toHaveBeenCalledTimes(1);
    expect(supportMocks.scheduleChapterMediaPrewarm).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  });

  it("keeps database failures classified as database errors", async () => {
    databaseMocks.commitVodCut.mockRejectedValue(
      new Error("chapter_assets database constraint failed"),
    );

    const handler = registeredHandlers.get(IPC_CHANNELS.VOD_CUT_COMMIT);
    const result = await handler?.({}, {
      projectId: 7,
      assetId: 9,
      ranges: [{ title: "A", startTime: 0, endTime: 100 }],
    });

    expect(result).toMatchObject({ success: false, code: "DATABASE_ERROR" });
  });
});
