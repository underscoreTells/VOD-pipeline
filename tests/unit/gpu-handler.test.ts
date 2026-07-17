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
const gpuDetectorMocks = vi.hoisted(() => ({
  detectGPUEncoders: vi.fn(),
  getGPUStatus: vi.fn(),
}));
const ffmpegDetectorMocks = vi.hoisted(() => ({
  getFFmpegPath: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/gpuDetector.js", () => gpuDetectorMocks);
vi.mock("../../src/electron/ffmpegDetector.js", () => ffmpegDetectorMocks);
vi.mock("../../src/electron/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("GPU status handler", () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers.clear();
    gpuDetectorMocks.detectGPUEncoders.mockReset();
    gpuDetectorMocks.getGPUStatus.mockReset();
    ffmpegDetectorMocks.getFFmpegPath.mockReset();
    ffmpegDetectorMocks.getFFmpegPath.mockReturnValue({ path: "/bundled/ffmpeg" });
    const { registerGpuHandlers } = await import("../../src/electron/ipc/handlers/gpu.js");
    registerGpuHandlers();
  });

  it("returns normal cached status without forcing detection", async () => {
    const cached = {
      backend: "cpu",
      encoderName: null,
      encoder: null,
      source: null,
      fallbackReason: "cached negative result",
      hwaccels: [],
      detected: false,
    };
    gpuDetectorMocks.getGPUStatus.mockReturnValue(cached);

    const handler = registeredHandlers.get(IPC_CHANNELS.GPU_STATUS);
    const result = await handler?.({}, undefined);

    expect(result).toEqual({ success: true, data: cached });
    expect(gpuDetectorMocks.detectGPUEncoders).not.toHaveBeenCalled();
  });

  it("forces detection when requested", async () => {
    const initial = {
      backend: "cpu",
      encoderName: null,
      encoder: null,
      source: null,
      fallbackReason: "runtime failure",
      hwaccels: ["cuda"],
      detected: false,
    };
    const refreshed = {
      backend: "nvenc",
      encoderName: "NVIDIA NVENC",
      encoder: "h264_nvenc",
      source: "ffmpeg",
      fallbackReason: null,
      hwaccels: ["cuda"],
      detected: true,
    };
    gpuDetectorMocks.getGPUStatus.mockReturnValueOnce(initial).mockReturnValueOnce(refreshed);

    const handler = registeredHandlers.get(IPC_CHANNELS.GPU_STATUS);
    const result = await handler?.({}, { force: true });

    expect(gpuDetectorMocks.detectGPUEncoders).toHaveBeenCalledWith("/bundled/ffmpeg", true);
    expect(result).toEqual({ success: true, data: refreshed });
  });

  it("accepts a missing payload and lazily runs normal detection", async () => {
    const empty = {
      backend: "cpu",
      encoderName: null,
      encoder: null,
      source: null,
      fallbackReason: null,
      hwaccels: [],
      detected: false,
    };
    gpuDetectorMocks.getGPUStatus.mockReturnValue(empty);

    const handler = registeredHandlers.get(IPC_CHANNELS.GPU_STATUS);
    await handler?.({}, undefined);

    expect(gpuDetectorMocks.detectGPUEncoders).toHaveBeenCalledWith("/bundled/ffmpeg", false);
  });
});
