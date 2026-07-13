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

describe("agent grounding status", () => {
  let tempDir: string;
  let sourcePath: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-grounding-status-"));
    proxyRoot.value = tempDir;
    sourcePath = path.join(tempDir, "source.mp4");
    fs.writeFileSync(sourcePath, "source");

    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(ffmpegMocks).forEach((mock) => mock.mockReset());

    databaseMocks.createChapterProxy.mockResolvedValue({
      id: 90,
      file_path: path.join(tempDir, "proxies", "chapter_7_asset_11_ai_proxy.mp4"),
    });
    databaseMocks.getChapter.mockResolvedValue({
      id: 7,
      project_id: 1,
      start_time: 10,
      end_time: 40,
    });
    databaseMocks.getAssetsByProject.mockResolvedValue([
      {
        id: 11,
        project_id: 1,
        file_type: "video",
        file_path: sourcePath,
      },
    ]);
    databaseMocks.getAssetsForChapter.mockResolvedValue([11]);
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

  it("returns ready for a generating row when the matching proxy file already exists", async () => {
    const proxyPath = path.join(tempDir, "stale-generating.mp4");
    fs.writeFileSync(proxyPath, "proxy-ready");
    const fileSize = fs.statSync(proxyPath).size;

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
        file_size: fileSize,
        duration: 30,
        error_message: null,
      });

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    const result = await getAgentGroundingStatus(1, 7, { ensureReady: false });

    expect(result).toEqual({
      status: "ready",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 1,
      assets: [{ assetId: 11, status: "ready" }],
      message: "Video grounding is ready.",
    });
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyMetadata).toHaveBeenCalledWith(12, expect.objectContaining({
      width: 640,
      height: 360,
      framerate: 5,
      file_size: fileSize,
      duration: 30,
    }));
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(12, "ready");
  });

  it("returns ready for a pending row when the matching proxy file already exists", async () => {
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

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    const result = await getAgentGroundingStatus(1, 7, { ensureReady: false });

    expect(result.status).toBe("ready");
    expect(result.readyVideoAssetCount).toBe(1);
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyMetadata).not.toHaveBeenCalled();
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(13, "ready");
  });

  it("returns ready from a reusable chapter proxy even when the source asset is missing", async () => {
    const proxyPath = path.join(tempDir, "ready-with-missing-source.mp4");
    fs.writeFileSync(proxyPath, "proxy-ready");
    fs.rmSync(sourcePath, { force: true });

    databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
      id: 16,
      chapter_id: 7,
      asset_id: 11,
      file_path: proxyPath,
      status: "ready",
      start_time: 10,
      end_time: 40,
      width: 640,
      height: 360,
      framerate: 5,
      file_size: fs.statSync(proxyPath).size,
      duration: 30,
      error_message: null,
    });

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    const result = await getAgentGroundingStatus(1, 7, { ensureReady: true });

    expect(result).toEqual({
      status: "ready",
      requiredVideoAssetCount: 1,
      readyVideoAssetCount: 1,
      assets: [{ assetId: 11, status: "ready" }],
      message: "Video grounding is ready.",
    });
    expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
  });

  it.each([
    {
      proxyStatus: "generating",
      expectedStatus: "generating",
      expectedError: undefined,
    },
    {
      proxyStatus: "error",
      expectedStatus: "error",
      expectedError: "Video proxy generation failed.",
    },
  ])(
    "preserves a $proxyStatus row when the proxy file is missing and ensureReady is false",
    async ({ proxyStatus, expectedStatus, expectedError }) => {
      const missingProxyPath = path.join(tempDir, `missing-${proxyStatus}.mp4`);
      databaseMocks.getChapterProxyByChapterAsset.mockResolvedValue({
        id: 14,
        chapter_id: 7,
        asset_id: 11,
        file_path: missingProxyPath,
        status: proxyStatus,
        start_time: 10,
        end_time: 40,
        width: null,
        height: null,
        framerate: null,
        file_size: null,
        duration: null,
        error_message: expectedError ?? null,
      });

      const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
      const result = await getAgentGroundingStatus(1, 7, { ensureReady: false });

      expect(result.status).toBe(expectedStatus);
      expect(result.readyVideoAssetCount).toBe(0);
      expect(result.assets).toEqual([
        expectedStatus === "error"
          ? { assetId: 11, status: "error", error: "Video proxy generation failed." }
          : { assetId: 11, status: "generating" },
      ]);
      expect(databaseMocks.updateChapterProxyStatus).not.toHaveBeenCalled();
      expect(databaseMocks.updateChapterProxyMetadata).not.toHaveBeenCalled();
      expect(ffmpegMocks.generateAIProxy).not.toHaveBeenCalled();
    }
  );

  it("regenerates a missing proxy when ensureReady is true and returns ready", async () => {
    const proxyPath = path.join(tempDir, "rebuild.mp4");

    databaseMocks.getChapterProxyByChapterAsset
      .mockResolvedValueOnce({
        id: 15,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
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
        id: 15,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
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
        id: 15,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
        start_time: 10,
        end_time: 40,
        width: 640,
        height: 360,
        framerate: 5,
        file_size: 5,
        duration: 30,
        error_message: null,
      });

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    const result = await getAgentGroundingStatus(1, 7, { ensureReady: true });

    expect(result.status).toBe("ready");
    expect(result.readyVideoAssetCount).toBe(1);
    expect(ffmpegMocks.generateAIProxy).toHaveBeenCalledTimes(1);
    expect(databaseMocks.updateChapterProxyDefinition).toHaveBeenCalledWith(15, expect.objectContaining({
      start_time: 10,
      end_time: 40,
      status: "pending",
    }));
    expect(databaseMocks.updateChapterProxyStatus).toHaveBeenCalledWith(15, "ready");
  });

  it("passes renderer-selected proxy options through grounding-driven proxy generation", async () => {
    const proxyPath = path.join(tempDir, "proxy-options.mp4");

    databaseMocks.getChapterProxyByChapterAsset
      .mockResolvedValueOnce({
        id: 17,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
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
        id: 17,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
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
        id: 17,
        chapter_id: 7,
        asset_id: 11,
        file_path: proxyPath,
        status: "ready",
        start_time: 10,
        end_time: 40,
        width: 640,
        height: 360,
        framerate: 5,
        file_size: 5,
        duration: 30,
        error_message: null,
      });

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    await getAgentGroundingStatus(1, 7, {
      ensureReady: true,
      proxyOptions: {
        encodingMode: "gpu",
        quality: "fast",
      },
    });

    expect(ffmpegMocks.generateAIProxy).toHaveBeenCalledWith(
      sourcePath,
      expect.stringContaining("chapter_7_asset_11_ai_proxy.partial.0.mp4"),
      undefined,
      30 * 60 * 1000,
      "gpu",
      "fast",
      {
        startTime: 10,
        endTime: 40,
      },
      expect.any(AbortSignal)
    );
  });

  it("returns missing_video_asset when the chapter has no linked video assets", async () => {
    databaseMocks.getAssetsByProject.mockResolvedValue([
      {
        id: 12,
        project_id: 1,
        file_type: "audio",
        file_path: path.join(tempDir, "audio.wav"),
      },
    ]);
    databaseMocks.getAssetsForChapter.mockResolvedValue([]);

    const { getAgentGroundingStatus } = await import("../../src/electron/ipc/handler-support.js");
    const result = await getAgentGroundingStatus(1, 7, { ensureReady: false });

    expect(result).toEqual({
      status: "missing_video_asset",
      requiredVideoAssetCount: 0,
      readyVideoAssetCount: 0,
      assets: [],
      message: "This chapter has no linked video asset. Agent chat requires video grounding and is locked.",
    });
    expect(databaseMocks.getChapterProxyByChapterAsset).not.toHaveBeenCalled();
  });
});
