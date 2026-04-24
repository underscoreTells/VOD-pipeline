import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyRoot = vi.hoisted(() => ({ value: "" }));

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => proxyRoot.value),
  },
}));

const databaseMocks = vi.hoisted(() => ({
  createChapterProxy: vi.fn(),
  createSuggestion: vi.fn(),
  getAsset: vi.fn(),
  getAssetsByProject: vi.fn(),
  getAssetsForChapter: vi.fn(),
  getChapter: vi.fn(),
  getChapterProxyByChapterAsset: vi.fn(),
  getClip: vi.fn(),
  getClipsByProject: vi.fn(),
  getSuggestionsByConversation: vi.fn(),
  getTranscriptsByChapter: vi.fn(),
  getWaveform: vi.fn(),
  updateChapterProxyDefinition: vi.fn(),
  updateChapterProxyMetadata: vi.fn(),
  updateChapterProxyStatus: vi.fn(),
}));

const ffmpegMocks = vi.hoisted(() => ({
  generateAIProxy: vi.fn(),
  generateChapterReverseProxy: vi.fn(),
  getVideoMetadata: vi.fn(),
}));

vi.mock("electron", () => electronMocks);
vi.mock("../../src/electron/database/index.js", () => databaseMocks);
vi.mock("../../src/pipeline/ffmpeg.js", () => ffmpegMocks);

describe("chapter proxy cache validation", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chapter-proxy-cache-"));
    proxyRoot.value = tempDir;

    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(ffmpegMocks).forEach((mock) => mock.mockReset());

    databaseMocks.createChapterProxy.mockResolvedValue({
      id: 90,
      file_path: path.join(tempDir, "proxies", "chapter_7_asset_11_ai_proxy.mp4"),
    });
    databaseMocks.updateChapterProxyDefinition.mockResolvedValue(true);
    databaseMocks.updateChapterProxyMetadata.mockResolvedValue(true);
    databaseMocks.updateChapterProxyStatus.mockResolvedValue(true);
    ffmpegMocks.getVideoMetadata.mockResolvedValue({
      width: 640,
      height: 360,
      fps: 5,
      duration: 30,
    });
    ffmpegMocks.generateAIProxy.mockImplementation(async (_inputPath: string, outputPath: string) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "proxy");
      return {
        width: 640,
        height: 360,
        framerate: 5,
        fileSize: 5,
        duration: 30,
      };
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reuses a ready chapter proxy when the cached range still matches", async () => {
    const proxyPath = path.join(tempDir, "existing.mp4");
    fs.writeFileSync(proxyPath, "ready");
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
      id: 1,
      file_path: proxyPath,
      status: "ready",
      start_time: 10,
      end_time: 40,
    });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 10, end_time: 40 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyDefinition).not.toHaveBeenCalled();
  });

  it("heals a generating proxy entry when the final proxy file already exists", async () => {
    const proxyPath = path.join(tempDir, "stale-generating.mp4");
    fs.writeFileSync(proxyPath, "proxy-ready");
    const readySize = fs.statSync(proxyPath).size;

    databaseMocks.getChapterProxyByChapterAsset
      .mockResolvedValueOnce({
        id: 12,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "generating",
        start_time: 10,
        end_time: 40,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        error_message: null,
      })
      .mockResolvedValueOnce({
        id: 12,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
        start_time: 10,
        end_time: 40,
        width: 640,
        height: 360,
        framerate: 5,
        file_size: readySize,
        duration: 30,
        error_message: null,
      });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 10, end_time: 40 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyDefinition).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyMetadata).toHaveBeenCalledWith(12, expect.objectContaining({
      width: 640,
      height: 360,
      framerate: 5,
      file_size: readySize,
      duration: 30,
    }));
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(12, "ready");
  });

  it("heals a pending proxy entry without backfilling metadata when it is already populated", async () => {
    const proxyPath = path.join(tempDir, "stale-pending.mp4");
    fs.writeFileSync(proxyPath, "proxy-ready");

    databaseMocks.getChapterProxyByChapterAsset
      .mockResolvedValueOnce({
        id: 13,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "pending",
        start_time: 10,
        end_time: 40,
        width: 640,
        height: 360,
        framerate: 5,
        file_size: 11,
        duration: 30,
        error_message: null,
      })
      .mockResolvedValueOnce({
        id: 13,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
        start_time: 10,
        end_time: 40,
        width: 640,
        height: 360,
        framerate: 5,
        file_size: 11,
        duration: 30,
        error_message: null,
      });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 10, end_time: 40 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyDefinition).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyMetadata).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(13, "ready");
  });

  it("regenerates the proxy when the cached file is missing", async () => {
    const proxyPath = path.join(tempDir, "missing.mp4");
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
      id: 2,
      file_path: proxyPath,
      status: "ready",
      start_time: 10,
      end_time: 40,
    });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 10, end_time: 40 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).toHaveBeenCalledTimes(1);
    expect(databaseMocks.updateChapterProxyDefinition).toHaveBeenCalledWith(2, expect.objectContaining({
      start_time: 10,
      end_time: 40,
      status: "pending",
    }));
    expect(fs.existsSync(proxyPath)).toBe(true);
  });

  it("regenerates and updates the proxy definition when the chapter range changes", async () => {
    const proxyPath = path.join(tempDir, "changed-range.mp4");
    fs.writeFileSync(proxyPath, "stale");
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
      id: 3,
      file_path: proxyPath,
      status: "ready",
      start_time: 5,
      end_time: 35,
    });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 12, end_time: 48 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).toHaveBeenCalledTimes(1);
    expect(databaseMocks.updateChapterProxyDefinition).toHaveBeenCalledWith(3, expect.objectContaining({
      start_time: 12,
      end_time: 48,
      status: "pending",
    }));
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(3, "ready");
  });

  it("regenerates a proxy entry that is currently in the error state", async () => {
    const proxyPath = path.join(tempDir, "error-state.mp4");
    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
      id: 4,
      file_path: proxyPath,
      status: "error",
      start_time: 10,
      end_time: 40,
    });

    const { ensureChapterProxyReady } = await import("../../src/electron/ipc/handler-support.js");
    const result = await ensureChapterProxyReady(
      { id: 7, start_time: 10, end_time: 40 } as never,
      { id: 11, file_type: "video", file_path: "/tmp/input.mp4" } as never
    );

    expect(result).toBe(proxyPath);
    expect(ffmpegMocks.generateAIProxy).toHaveBeenCalledTimes(1);
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(4, "generating");
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(4, "ready");
  });
});
