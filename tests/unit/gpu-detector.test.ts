import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

function createSpawnResult(code: number, stderr = "", stdout = "") {
  return {
    stdout: {
      on: (event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stdout) {
          setTimeout(() => callback(Buffer.from(stdout)), 0);
        }
      },
    },
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

  it("prefers system ffmpeg for GPU encoder probing, falling back to bundled", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      // -hwaccels probes always return empty (no hwaccel methods reported)
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "");
      }
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "/bundled/ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });

    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");
    const encoder = await detectGPUEncoders("/bundled/ffmpeg", true);

    // System ffmpeg is probed first; it lacks NVENC, so detection falls back
    // to the bundled binary which succeeds.
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

  it("selects a GPU encoder from system ffmpeg when bundled lacks one", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "");
      }
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

  it("probes and parses ffmpeg -hwaccels output", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "Hardware acceleration methods:\ncuda\nvaapi\n");
      }
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });

    const { detectGPUEncoders, getGPUStatus } = await import("../../src/electron/gpuDetector.js");
    await detectGPUEncoders("/bundled/ffmpeg", true);

    const status = getGPUStatus();
    expect(status.hwaccels).toEqual(["cuda", "vaapi"]);
    expect(status.detected).toBe(true);
    expect(status.backend).toBe("nvenc");
  });

  it("reports CPU fallback status with a reason when no encoder is found", async () => {
    spawnMock.mockImplementation((_executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "");
      }
      return createSpawnResult(1, "Unknown encoder");
    });

    const { detectGPUEncoders, getGPUStatus } = await import("../../src/electron/gpuDetector.js");
    await detectGPUEncoders("/bundled/ffmpeg", true);

    const status = getGPUStatus();
    expect(status.detected).toBe(false);
    expect(status.backend).toBe("cpu");
    expect(status.fallbackReason).toBeTruthy();
  });

  it("invalidates a matching cached encoder after a runtime failure", async () => {
    const {
      getGPUStatus,
      recordGPUEncoderRuntimeFailure,
      setGPUEncoderForTesting,
    } = await import("../../src/electron/gpuDetector.js");
    setGPUEncoderForTesting({
      backend: "nvenc",
      encoder: "h264_nvenc",
      name: "NVIDIA NVENC",
      priority: 2,
      source: "/usr/bin/ffmpeg",
    }, "/bundled/ffmpeg");

    recordGPUEncoderRuntimeFailure(
      { backend: "nvenc", source: "/usr/bin/ffmpeg" },
      "Proxy failed with code 1"
    );

    const status = getGPUStatus();
    expect(status.detected).toBe(false);
    expect(status.backend).toBe("cpu");
    expect(status.fallbackReason).toContain("nvenc");
    expect(status.fallbackReason).toContain("/usr/bin/ffmpeg");
    expect(status.fallbackReason).toContain("Proxy failed with code 1");
  });

  it.each([
    { backend: "qsv" as const, source: "/usr/bin/ffmpeg" },
    { backend: "nvenc" as const, source: "/other/ffmpeg" },
  ])("ignores a runtime failure for stale $backend/$source state", async ({ backend, source }) => {
    const {
      getGPUStatus,
      recordGPUEncoderRuntimeFailure,
      setGPUEncoderForTesting,
    } = await import("../../src/electron/gpuDetector.js");
    setGPUEncoderForTesting({
      backend: "nvenc",
      encoder: "h264_nvenc",
      name: "NVIDIA NVENC",
      priority: 2,
      source: "/usr/bin/ffmpeg",
    }, "/bundled/ffmpeg");

    recordGPUEncoderRuntimeFailure({ backend, source }, "stale failure");

    expect(getGPUStatus()).toMatchObject({
      detected: true,
      backend: "nvenc",
      source: "/usr/bin/ffmpeg",
      fallbackReason: null,
    });
  });

  it("caches a negative result for the same ffmpeg path", async () => {
    spawnMock.mockImplementation((_executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "");
      }
      return createSpawnResult(1, "Unknown encoder");
    });
    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");

    await detectGPUEncoders("/bundled/ffmpeg");
    const firstProbeCount = spawnMock.mock.calls.length;
    await detectGPUEncoders("/bundled/ffmpeg");

    expect(firstProbeCount).toBeGreaterThan(0);
    expect(spawnMock).toHaveBeenCalledTimes(firstProbeCount);
  });

  it("shares an in-flight detection for concurrent callers", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "Hardware acceleration methods:\ncuda\n");
      }
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });
    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");

    const results = await Promise.all([
      detectGPUEncoders("/bundled/ffmpeg"),
      detectGPUEncoders("/bundled/ffmpeg"),
      detectGPUEncoders("/bundled/ffmpeg"),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ backend: "nvenc", source: "ffmpeg" }),
      expect.objectContaining({ backend: "nvenc", source: "ffmpeg" }),
      expect.objectContaining({ backend: "nvenc", source: "ffmpeg" }),
    ]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("runs a fresh forced detection after an in-flight probe", async () => {
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", "Hardware acceleration methods:\ncuda\n");
      }
      const encoder = args[args.indexOf("-c:v") + 1];
      if (executablePath === "ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });
    const { detectGPUEncoders } = await import("../../src/electron/gpuDetector.js");

    const initial = detectGPUEncoders("/bundled/ffmpeg");
    const forced = detectGPUEncoders("/bundled/ffmpeg", true);
    await Promise.all([initial, forced]);

    expect(spawnMock).toHaveBeenCalledTimes(4);
  });

  it("force detection bypasses a negative cache and restores an encoder", async () => {
    let nvencAvailable = false;
    spawnMock.mockImplementation((executablePath: string, args: string[]) => {
      if (args[0] === "-hwaccels") {
        return createSpawnResult(0, "", nvencAvailable ? "Hardware acceleration methods:\ncuda\n" : "");
      }
      const encoder = args[args.indexOf("-c:v") + 1];
      if (nvencAvailable && executablePath === "ffmpeg" && encoder === "h264_nvenc") {
        return createSpawnResult(0);
      }
      return createSpawnResult(1, "Unknown encoder");
    });
    const { detectGPUEncoders, getGPUStatus } = await import("../../src/electron/gpuDetector.js");

    expect(await detectGPUEncoders("/bundled/ffmpeg")).toBeNull();
    nvencAvailable = true;
    expect(await detectGPUEncoders("/bundled/ffmpeg")).toBeNull();
    expect(await detectGPUEncoders("/bundled/ffmpeg", true)).toMatchObject({ backend: "nvenc" });
    expect(getGPUStatus()).toMatchObject({ detected: true, backend: "nvenc" });
  });

  it("clearing the cache restores the initial undetected status", async () => {
    const { clearGPUEncoderCache, getGPUStatus, setGPUEncoderForTesting } = await import(
      "../../src/electron/gpuDetector.js"
    );
    setGPUEncoderForTesting({
      backend: "nvenc",
      encoder: "h264_nvenc",
      name: "NVIDIA NVENC",
      priority: 2,
      source: "/usr/bin/ffmpeg",
    });

    clearGPUEncoderCache();

    expect(getGPUStatus()).toEqual({
      backend: "cpu",
      encoderName: null,
      encoder: null,
      source: null,
      fallbackReason: null,
      hwaccels: [],
      detected: false,
    });
  });

  it.each([
    { backend: "nvenc" as const, expected: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] },
    { backend: "qsv" as const, expected: ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"] },
    { backend: "amf" as const, expected: ["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"] },
    { backend: "videotoolbox" as const, expected: ["-hwaccel", "videotoolbox"] },
    { backend: "cpu" as const, expected: [] },
  ])("builds hwaccel decode args for $backend", async ({ backend, expected }) => {
    const { getHwaccelDecodeArgs } = await import("../../src/electron/gpuDetector.js");
    expect(getHwaccelDecodeArgs(backend)).toEqual(expected);
  });
});
