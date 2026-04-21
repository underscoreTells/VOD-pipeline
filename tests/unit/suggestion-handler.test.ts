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
  applySuggestionWithClip: vi.fn(),
  cancelSuggestionPreview: vi.fn(),
  createSuggestion: vi.fn(),
  getClip: vi.fn(),
  getSuggestion: vi.fn(),
  getSuggestionsByConversation: vi.fn(),
  previewSuggestionWithClip: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

const handlerSupportMocks = vi.hoisted(() => ({
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

describe("suggestion handlers", () => {
  beforeEach(async () => {
    registeredHandlers.clear();
    Object.values(electronMocks.ipcMain).forEach((mock) => mock.mockClear());
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    handlerSupportMocks.toNumberOrNull.mockClear();

    databaseMocks.getSuggestionsByConversation.mockResolvedValue([]);
    databaseMocks.applySuggestionWithClip.mockResolvedValue({ success: true });

    const { registerSuggestionHandlers } = await import("../../src/electron/ipc/handlers/suggestions.js");
    registerSuggestionHandlers();
  });

  it("coerces string chapter ids for chapter-scoped suggestion reads", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.SUGGESTION_GET_BY_CHAPTER);

    const result = await handler?.({}, {
      chapterId: "7",
      conversationId: 12,
      status: "pending",
    });

    expect(handlerSupportMocks.toNumberOrNull).toHaveBeenCalledWith("7");
    expect(databaseMocks.getSuggestionsByConversation).toHaveBeenCalledWith(12, 7, "pending");
    expect(result).toEqual({
      success: true,
      data: [],
    });
  });

  it("coerces string chapter ids before applying all pending suggestions", async () => {
    databaseMocks.getSuggestionsByConversation.mockResolvedValue([{ id: 21 }, { id: 22 }]);
    databaseMocks.applySuggestionWithClip
      .mockResolvedValueOnce({ success: true, clip: { id: 100 } })
      .mockResolvedValueOnce({ success: false, error: "boom" });

    const handler = registeredHandlers.get(IPC_CHANNELS.SUGGESTION_APPLY_ALL);

    const result = await handler?.({}, {
      chapterId: "7",
      conversationId: 12,
    });

    expect(handlerSupportMocks.toNumberOrNull).toHaveBeenCalledWith("7");
    expect(databaseMocks.getSuggestionsByConversation).toHaveBeenCalledWith(12, 7, "pending");
    expect(databaseMocks.applySuggestionWithClip).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: true,
      data: {
        appliedCount: 1,
        total: 2,
      },
    });
  });
});
