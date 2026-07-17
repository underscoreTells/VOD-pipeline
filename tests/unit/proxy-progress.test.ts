import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../src/electron/ipc/channels.js";

type MockIpcHandler = (...args: unknown[]) => unknown;

const proxyRoot = vi.hoisted(() => ({ value: "" }));

const registeredHandlers = vi.hoisted(() => new Map<string, MockIpcHandler>());

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => proxyRoot.value),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: MockIpcHandler) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const databaseMocks = vi.hoisted(() => ({
  createChapterProxy: vi.fn(),
  getAsset: vi.fn(),
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChapterProxyByChapterAsset: vi.fn(),
  getProject: vi.fn(),
  updateChapterProxyDefinition: vi.fn(),
  updateChapterProxyMetadata: vi.fn(),
  updateChapterProxyStatus: vi.fn(),
}));

const ffmpegMocks = vi.hoisted(() => ({
  generateAIProxy: vi.fn(),
  getVideoMetadata: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/pipeline/ffmpeg.js", () => ffmpegMocks);

describe("proxy:progress IPC emission", () => {
  let tempDir: string;
  let sourcePath: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-progress-"));
    proxyRoot.value = tempDir;
    sourcePath = path.join(tempDir, "source.mp4");
    fs.writeFileSync(sourcePath, "source");

    registeredHandlers.clear();
    Object.values(electronMocks).forEach((mock) => {
      if (typeof mock === "object" && mock) {
        Object.values(mock).forEach((fn) => {
          if (typeof fn === "function" && "mockClear" in fn) fn.mockClear();
        });
      }
    });
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(ffmpegMocks).forEach((mock) => mock.mockReset());

    databaseMocks.getProject.mockResolvedValue({ id: 1, name: "Project 1" });
    databaseMocks.getChapter.mockResolvedValue({
      id: 7,
      project_id: 1,
      title: "Chapter 7",
      start_time: 10,
      end_time: 40,
    });
    databaseMocks.getAssetsByProject.mockResolvedValue([
      { id: 11, file_type: "video", file_path: sourcePath },
    ]);
    databaseMocks.getAssetsForChapter.mockResolvedValue([11]);
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue(null);
    databaseMocks.createChapterProxy.mockResolvedValue({
      id: 90,
      file_path: path.join(tempDir, "proxies", "chapter_7_asset_11_ai_proxy.mp4"),
    });
    databaseMocks.updateChapterProxyStatus.mockResolvedValue(true);
    databaseMocks.updateChapterProxyMetadata.mockResolvedValue(true);

    ffmpegMocks.getVideoMetadata.mockResolvedValue({
      duration: 30,
      width: 640,
      height: 360,
      fps: 5,
      videoCodec: "h264",
      audioTracks: [],
      bitrate: 0,
      container: "mp4",
    });
    ffmpegMocks.generateAIProxy.mockImplementation(
      async (_input: string, output: string, onProgress?: (pct: number) => void) => {
        if (onProgress) {
          onProgress(25);
          onProgress(50);
          onProgress(100);
        }
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, "proxy");
        return { width: 640, height: 360, framerate: 5, fileSize: 5, duration: 30 };
      }
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("continues forwarding progress after the initial status IPC returns", async () => {
    const { registerAgentGroundingHandler } = await import("../../src/electron/ipc/handlers/agent/grounding.js");
    registerAgentGroundingHandler();

    const handler = registeredHandlers.get(IPC_CHANNELS.AGENT_GROUNDING_STATUS);
    expect(handler).toBeDefined();

    let emitProgress: ((percent: number) => void) | undefined;
    let finishEncode!: () => void;
    const encodeGate = new Promise<void>((resolve) => {
      finishEncode = resolve;
    });
    ffmpegMocks.generateAIProxy.mockImplementation(
      async (_input: string, output: string, onProgress?: (pct: number) => void) => {
        emitProgress = onProgress;
        await encodeGate;
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, "proxy");
        return { width: 640, height: 360, framerate: 5, fileSize: 5, duration: 30 };
      }
    );

    const senderSend = vi.fn();
    const mockEvent = { sender: { send: senderSend, isDestroyed: vi.fn(() => false) } };

    const result = await handler?.(mockEvent, {
      projectId: "1",
      chapterId: "7",
      ensureReady: true,
    });

    expect(result).toMatchObject({ success: true, data: { status: "generating" } });
    await vi.waitFor(() => expect(ffmpegMocks.generateAIProxy).toHaveBeenCalled());

    emitProgress?.(25);
    emitProgress?.(50);
    emitProgress?.(100);

    const progressCalls = senderSend.mock.calls.filter(
      (call) => call[0] === IPC_CHANNELS.PROXY_PROGRESS
    );
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);

    expect(progressCalls[0][1]).toMatchObject({
      chapterId: 7,
      assetId: 11,
      percent: 25,
    });
    expect(progressCalls[1][1]).toMatchObject({
      chapterId: 7,
      assetId: 11,
      percent: 50,
    });
    expect(progressCalls[2][1]).toMatchObject({
      chapterId: 7,
      assetId: 11,
      percent: 100,
    });
    finishEncode();
    await vi.waitFor(() => {
      expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(90, "ready");
    });
  });

  it("does not send progress after the originating renderer is destroyed", async () => {
    const { registerAgentGroundingHandler } = await import("../../src/electron/ipc/handlers/agent/grounding.js");
    registerAgentGroundingHandler();
    const handler = registeredHandlers.get(IPC_CHANNELS.AGENT_GROUNDING_STATUS);
    const senderSend = vi.fn();
    const mockEvent = { sender: { send: senderSend, isDestroyed: vi.fn(() => true) } };

    await handler?.(mockEvent, { projectId: "1", chapterId: "7", ensureReady: true });
    await vi.waitFor(() => expect(ffmpegMocks.generateAIProxy).toHaveBeenCalled());
    await vi.waitFor(() => {
      expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(90, "ready");
    });

    expect(senderSend).not.toHaveBeenCalled();
  });

  it("does not emit progress when ensureReady is false", async () => {
    const { registerAgentGroundingHandler } = await import("../../src/electron/ipc/handlers/agent/grounding.js");
    registerAgentGroundingHandler();

    const handler = registeredHandlers.get(IPC_CHANNELS.AGENT_GROUNDING_STATUS);
    const senderSend = vi.fn();
    const mockEvent = { sender: { send: senderSend } };

    await handler?.(mockEvent, {
      projectId: "1",
      chapterId: "7",
      ensureReady: false,
    });

    const progressCalls = senderSend.mock.calls.filter(
      (call) => call[0] === IPC_CHANNELS.PROXY_PROGRESS
    );
    expect(progressCalls).toHaveLength(0);
  });
});
