import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

function createSpawnResult(code: number, stderr = "") {
  return {
    stderr: {
      on: (event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stderr) {
          setTimeout(() => callback(Buffer.from(stderr)), 0);
        }
      },
    },
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (event === "close") {
        setTimeout(() => callback(code), 0);
      }
    },
    kill: vi.fn(),
  };
}

describe("gpu detector", () => {
  beforeEach(async () => {
    vi.resetModules();
    spawnMock.mockReset();
  });

  afterEach(async () => {
    const { clearGPUEncoderCache, setGPUEncoderForTesting } = await import("../../src/electron/gpuDetector.js");
    clearGPUEncoderCache();
    setGPUEncoderForTesting(null);
  });

  it("prioritizes VideoToolbox first on macOS and omits it elsewhere", async () => {
    const { getPreferredGPUEncoders } = await import("../../src/electron/gpuDetector.js");

    expect(getPreferredGPUEncoders("darwin").map((candidate) => candidate.backend)).toEqual([
      "videotoolbox",
      "nvenc",
      "qsv",
      "amf",
    ]);
    expect(getPreferredGPUEncoders("win32").map((candidate) => candidate.backend)).toEqual([
      "nvenc",
      "qsv",
      "amf",
    ]);
  });

  it("uses the bundled ffmpeg path before falling back to system ffmpeg", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "/bundled/ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });

    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");
    const encoder = await detectGPUEncoders("/bundled/ffmpeg", true);

    expect(encoder).toMatchObject({
      backend: "nvenc",
      encoder: "h264_nvenc",
      source: "/bundled/ffmpeg",
    });
    expect(spawnMock).toHaveBeenCalledWith(
      "/bundled/ffmpeg",
      expect.any(Array),
      expect.objectContaining({ stdio: ["ignore", "ignore", "pipe"] })
    );
  });

  it("falls back to system ffmpeg when the bundled binary lacks a supported encoder", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "ffmpeg" && encoder === "h264_qsv") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });

    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");
    const encoder = await detectGPUEncoders("/bundled/ffmpeg", true);

    expect(encoder).toMatchObject({
      backend: "qsv",
      encoder: "h264_qsv",
      source: "ffmpeg",
    });
  });

  it.each([
    {
      label: "cpu fallback",
      encoder: null,
      quality: "fast" as const,
      expected: {
        backend: "cpu",
        videoCodec: "libx264",
      },
      requiredArgs: ["-preset", "ultrafast", "-crf", "32"],
    },
    {
      label: "VideoToolbox",
      encoder: {
        backend: "videotoolbox" as const,
        encoder: "h264_videotoolbox",
        name: "Apple VideoToolbox",
        priority: 1,
        source: "/bundled/ffmpeg",
      },
      quality: "balanced" as const,
      expected: {
        backend: "videotoolbox",
        videoCodec: "h264_videotoolbox",
      },
      requiredArgs: ["-allow_sw", "0", "-b:v", "1500k"],
    },
    {
      label: "NVENC",
      encoder: {
        backend: "nvenc" as const,
        encoder: "h264_nvenc",
        name: "NVIDIA NVENC",
        priority: 2,
        source: "/bundled/ffmpeg",
      },
      quality: "balanced" as const,
      expected: {
        backend: "nvenc",
        videoCodec: "h264_nvenc",
      },
      requiredArgs: ["-preset", "p4", "-cq", "28"],
    },
    {
      label: "QSV",
      encoder: {
        backend: "qsv" as const,
        encoder: "h264_qsv",
        name: "Intel Quick Sync",
        priority: 3,
        source: "ffmpeg",
      },
      quality: "high" as const,
      expected: {
        backend: "qsv",
        videoCodec: "h264_qsv",
      },
      requiredArgs: ["-preset", "veryslow", "-global_quality", "23"],
    },
    {
      label: "AMF",
      encoder: {
        backend: "amf" as const,
        encoder: "h264_amf",
        name: "AMD AMF",
        priority: 4,
        source: "ffmpeg",
      },
      quality: "fast" as const,
      expected: {
        backend: "amf",
        videoCodec: "h264_amf",
      },
      requiredArgs: ["-quality", "speed", "-qp_p", "35"],
    },
  ])("builds the expected proxy encoder arguments for $label", async ({ encoder, quality, expected, requiredArgs }) => {
    const { getProxyEncoderArgs, setGPUEncoderForTesting } = await import("../../src/electron/gpuDetector.js");
    setGPUEncoderForTesting(encoder);

    const args = getProxyEncoderArgs(Boolean(encoder), quality);

    expect(args).toMatchObject(expected);
    expect(args.videoArgs).toEqual(expect.arrayContaining(requiredArgs));
  });
});
