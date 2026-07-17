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
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  updateProject: vi.fn(),
}));
const supportMocks = vi.hoisted(() => ({
  scheduleProjectProxyPrewarm: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/electron/ipc/handler-support.js", () => supportMocks);
vi.mock("../../src/electron/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("project handlers", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(supportMocks).forEach((mock) => mock.mockReset());
    databaseMocks.getProject.mockResolvedValue({ id: 7, name: "Project" });
    supportMocks.scheduleProjectProxyPrewarm.mockResolvedValue({ accepted: 3, skipped: 2 });
    const { registerProjectHandlers } = await import(
      "../../src/electron/ipc/handlers/projects.js"
    );
    registerProjectHandlers();
  });

  it("returns after project proxy jobs are accepted", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.PROJECT_PROXY_PREWARM);
    const result = await handler?.({}, {
      id: 7,
      proxyOptions: { encodingMode: "gpu", quality: "fast" },
    });

    expect(supportMocks.scheduleProjectProxyPrewarm).toHaveBeenCalledWith(7, {
      encodingMode: "gpu",
      quality: "fast",
    });
    expect(result).toEqual({
      success: true,
      data: { accepted: 3, skipped: 2 },
    });
  });

  it("rejects invalid project proxy options", async () => {
    const handler = registeredHandlers.get(IPC_CHANNELS.PROJECT_PROXY_PREWARM);
    const result = await handler?.({}, {
      id: 7,
      proxyOptions: { encodingMode: "quantum", quality: "fast" },
    });

    expect(supportMocks.scheduleProjectProxyPrewarm).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  });
});
