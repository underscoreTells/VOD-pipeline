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
  batchUpdateClips: vi.fn(),
  createClip: vi.fn(),
  deleteClip: vi.fn(),
  getClip: vi.fn(),
  getClipsByAsset: vi.fn(),
  getClipsByProject: vi.fn(),
  updateClip: vi.fn(),
}));

const namingServiceMocks = vi.hoisted(() => ({
  suggestChapterClipName: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/services/naming-service.js", () => namingServiceMocks);

describe("clip suggest-name handler", () => {
  beforeEach(async () => {
    registeredHandlers.clear();
    Object.values(electronMocks.ipcMain).forEach((mock) => mock.mockClear());
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(namingServiceMocks).forEach((mock) => mock.mockReset());

    const { registerClipHandlers } = await import("../../src/electron/ipc/handlers/clips.js");
    registerClipHandlers();
  });

  it("passes the selected naming model and provider config through to the naming service", async () => {
    namingServiceMocks.suggestChapterClipName.mockResolvedValue("Gemini Discovery");

    const handler = registeredHandlers.get(IPC_CHANNELS.CLIP_SUGGEST_NAME);
    const result = await handler?.({}, {
      chapterId: 12,
      inPoint: 4,
      outPoint: 9,
      model: "gemini-3.5-flash-lite",
      providerConfig: {
        providers: {
          gemini: "AIza-gemini",
        },
      },
      chapterTitle: "Discovery",
    });

    expect(namingServiceMocks.suggestChapterClipName).toHaveBeenCalledWith({
      chapterId: 12,
      inPoint: 4,
      outPoint: 9,
      model: "gemini-3.5-flash-lite",
      providerConfig: {
        providers: {
          gemini: "AIza-gemini",
        },
      },
      chapterTitle: "Discovery",
    });
    expect(result).toEqual({
      success: true,
      data: {
        name: "Gemini Discovery",
      },
    });
  });

  it("normalizes deprecated model values and returns null when naming is unavailable", async () => {
    namingServiceMocks.suggestChapterClipName.mockResolvedValue(null);

    const handler = registeredHandlers.get(IPC_CHANNELS.CLIP_SUGGEST_NAME);
    const result = await handler?.({}, {
      chapterId: 12,
      inPoint: 4,
      outPoint: 9,
      model: "gpt-4o-mini",
      providerConfig: {
        providers: {},
      },
    });

    expect(namingServiceMocks.suggestChapterClipName).toHaveBeenCalledWith({
      chapterId: 12,
      inPoint: 4,
      outPoint: 9,
      model: "gpt-5-nano",
      providerConfig: {
        providers: {},
      },
      chapterTitle: undefined,
    });
    expect(result).toEqual({
      success: true,
      data: {
        name: null,
      },
    });
  });
});
