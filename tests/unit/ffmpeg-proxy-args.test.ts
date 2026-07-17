import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[] }>,
}));

const ffmpegDetectorMocks = vi.hoisted(() => ({
  getFFmpegPath: vi.fn(() => ({ path: "/mock/ffmpeg" })),
  getFFprobePath: vi.fn(() => "/mock/ffprobe"),
}));

const gpuDetectorMocks = vi.hoisted(() => ({
  detectGPUEncoders: vi.fn(),
  getGPUFFmpegPath: vi.fn(() => "/mock/ffmpeg"),
  getProxyEncoderArgs: vi.fn(),
  getHwaccelDecodeArgs: vi.fn((backend: string): string[] => {
    switch (backend) {
      case "nvenc":
        return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
      case "qsv":
        return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"];
      case "amf":
        return ["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"];
      case "videotoolbox":
        return ["-hwaccel", "videotoolbox"];
      default:
        return [];
    }
  }),
}));

const spawnMock = vi.hoisted(() => vi.fn((command: string, args: string[]) => {
  spawnState.calls.push({ command, args: [...args] });

  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  process.nextTick(() => {
    if (command === "/mock/ffprobe") {
      proc.stdout.emit("data", JSON.stringify({
        streams: [
          {
            codec_type: "video",
            width: 1920,
            height: 1080,
            r_frame_rate: "30/1",
            avg_frame_rate: "30/1",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            sample_rate: "48000",
            channels: 2,
          },
        ],
        format: {
          duration: "60",
        },
      }));
      proc.emit("close", 0);
      proc.emit("exit", 0);
      return;
    }

    const outputPath = args[args.length - 1];
    if (typeof outputPath === "string" && outputPath !== "-") {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "generated");
    }

    proc.stderr.emit("data", Buffer.from("frame=1 time=00:00:01.00 bitrate=1000kbits/s"));
    proc.emit("close", 0);
    proc.emit("exit", 0);
  });

  return proc as never;
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../../src/electron/ffmpegDetector.js", () => ffmpegDetectorMocks);
vi.mock("../../src/electron/gpuDetector.js", () => gpuDetectorMocks);

describe("ffmpeg proxy argument generation", () => {
  let tempDir: string;
  let inputPath: string;
  let outputPath: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-proxy-args-"));
    inputPath = path.join(tempDir, "input.mp4");
    outputPath = path.join(tempDir, "output.mp4");
    fs.writeFileSync(inputPath, "input");

    spawnState.calls.length = 0;
    spawnMock.mockClear();
    ffmpegDetectorMocks.getFFmpegPath.mockClear();
    ffmpegDetectorMocks.getFFprobePath.mockClear();
    gpuDetectorMocks.detectGPUEncoders.mockReset();
    gpuDetectorMocks.getGPUFFmpegPath.mockReset();
    gpuDetectorMocks.getGPUFFmpegPath.mockReturnValue("/mock/ffmpeg");
    gpuDetectorMocks.getProxyEncoderArgs.mockReset();
    gpuDetectorMocks.getHwaccelDecodeArgs.mockClear();
    gpuDetectorMocks.getProxyEncoderArgs.mockImplementation((useGPU: boolean) => {
      if (useGPU) {
        return {
          backend: "nvenc",
          videoCodec: "h264_nvenc",
          videoArgs: ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "28"],
        };
      }

      return {
        backend: "cpu",
        videoCodec: "libx264",
        videoArgs: ["-c:v", "libx264", "-preset", "fast", "-crf", "28"],
      };
    });
    gpuDetectorMocks.detectGPUEncoders.mockResolvedValue(null);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses input-side seek and duration trimming for CPU chapter proxies", async () => {
    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "cpu",
      "balanced",
      { startTime: 12, endTime: 42.5 }
    );

    const ffmpegArgs = spawnState.calls.find((call) => call.command === "/mock/ffmpeg")?.args;
    expect(ffmpegArgs).toBeDefined();

    const inputIndex = ffmpegArgs!.indexOf("-i");
    const seekIndex = ffmpegArgs!.indexOf("-ss");
    const durationIndex = ffmpegArgs!.indexOf("-t");

    expect(seekIndex).toBeGreaterThanOrEqual(0);
    expect(durationIndex).toBeGreaterThanOrEqual(0);
    expect(seekIndex).toBeLessThan(inputIndex);
    expect(durationIndex).toBeLessThan(inputIndex);
    expect(ffmpegArgs![seekIndex + 1]).toBe("12");
    expect(ffmpegArgs![durationIndex + 1]).toBe("30.5");
    expect(ffmpegArgs).not.toContain("-to");
  });

  it("keeps input-side trimming ahead of NVENC decode setup for GPU chapter proxies", async () => {
    gpuDetectorMocks.detectGPUEncoders.mockResolvedValue({
      backend: "nvenc",
      encoder: "h264_nvenc",
      name: "NVIDIA NVENC",
      priority: 1,
      source: "/mock/ffmpeg",
    });

    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "gpu",
      "balanced",
      { startTime: 5, endTime: 17 }
    );

    const ffmpegArgs = spawnState.calls.find((call) => call.command === "/mock/ffmpeg")?.args;
    expect(ffmpegArgs).toBeDefined();

    expect(ffmpegArgs!.slice(0, 4)).toEqual(["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"]);
    expect(ffmpegArgs).toContain("-ss");
    expect(ffmpegArgs).toContain("-t");
    expect(ffmpegArgs!.indexOf("-ss")).toBeLessThan(ffmpegArgs!.indexOf("-i"));
    expect(ffmpegArgs![ffmpegArgs!.indexOf("-t") + 1]).toBe("12");
  });

  it("emits QSV decode hwaccel flags and scale_qsv filter for GPU chapter proxies", async () => {
    gpuDetectorMocks.detectGPUEncoders.mockResolvedValue({
      backend: "qsv",
      encoder: "h264_qsv",
      name: "Intel Quick Sync",
      priority: 1,
      source: "/mock/ffmpeg",
    });
    gpuDetectorMocks.getProxyEncoderArgs.mockImplementation(() => ({
      backend: "qsv",
      videoCodec: "h264_qsv",
      videoArgs: ["-c:v", "h264_qsv", "-preset", "fast", "-global_quality", "28"],
    }));

    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "gpu",
      "balanced",
      { startTime: 5, endTime: 17 }
    );

    const ffmpegArgs = spawnState.calls.find((call) => call.command === "/mock/ffmpeg")?.args;
    expect(ffmpegArgs).toBeDefined();

    expect(ffmpegArgs!.slice(0, 4)).toEqual(["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"]);
    expect(ffmpegArgs).toContain("scale_qsv=640:-2");
    expect(ffmpegArgs).toContain("-r");
    expect(ffmpegArgs![ffmpegArgs!.indexOf("-r") + 1]).toBe("5");
  });

  it("emits AMF decode hwaccel flags and scale_amf filter for GPU chapter proxies", async () => {
    gpuDetectorMocks.detectGPUEncoders.mockResolvedValue({
      backend: "amf",
      encoder: "h264_amf",
      name: "AMD AMF",
      priority: 1,
      source: "/mock/ffmpeg",
    });
    gpuDetectorMocks.getProxyEncoderArgs.mockImplementation(() => ({
      backend: "amf",
      videoCodec: "h264_amf",
      videoArgs: ["-c:v", "h264_amf", "-quality", "balanced", "-qp_p", "28", "-qp_i", "28"],
    }));

    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "gpu",
      "balanced",
      { startTime: 0, endTime: 10 }
    );

    const ffmpegArgs = spawnState.calls.find((call) => call.command === "/mock/ffmpeg")?.args;
    expect(ffmpegArgs).toBeDefined();

    expect(ffmpegArgs!.slice(0, 4)).toEqual(["-hwaccel", "d3d11va", "-hwaccel_output_format", "d3d11"]);
    expect(ffmpegArgs).toContain("scale_amf=640:-2");
  });

  it("writes reverse chunks without faststart and concatenates to explicit mp4 output", async () => {
    const { generateChapterReverseProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateChapterReverseProxy(inputPath, outputPath, {
      startTime: 0,
      endTime: 5,
      fps: 10,
      encodingMode: "cpu",
      quality: "balanced",
      executionMode: "background",
    });

    const ffmpegCalls = spawnState.calls.filter((call) => call.command === "/mock/ffmpeg");
    expect(ffmpegCalls).toHaveLength(2);

    const [chunkArgs, concatArgs] = ffmpegCalls.map((call) => call.args);

    expect(chunkArgs).not.toContain("+faststart");
    expect(concatArgs).toEqual(expect.arrayContaining([
      "-f", "concat",
      "-c:v", "copy",
      "-c:a", "copy",
      "-f", "mp4",
      "-movflags", "+faststart",
    ]));
  });

  function ffprobeTargets(): string[] {
    return spawnState.calls
      .filter((call) => call.command === "/mock/ffprobe")
      .map((call) => call.args[call.args.length - 1]);
  }

  it("skips the source ffprobe for trimmed chapter proxies but still probes the output", async () => {
    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "cpu",
      "balanced",
      { startTime: 12, endTime: 42.5 }
    );

    const probes = ffprobeTargets();
    // Trimmed proxies know their duration from the chapter bounds, so the
    // source is never probed; only the finished output is.
    expect(probes).not.toContain(inputPath);
    expect(probes).toContain(outputPath);
    expect(probes).toHaveLength(1);
  });

  it("still probes the source when no trim range is supplied", async () => {
    const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

    await generateAIProxy(
      inputPath,
      outputPath,
      undefined,
      undefined,
      "cpu",
      "balanced"
    );

    const probes = ffprobeTargets();
    // No-trim path keeps the source probe to learn the container duration,
    // then probes the generated output.
    expect(probes).toContain(inputPath);
    expect(probes).toContain(outputPath);
    expect(probes).toHaveLength(2);
  });

  it("logs encode timing with backend, duration, wall, and speed for a successful proxy encode", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { generateAIProxy } = await import("../../src/pipeline/ffmpeg.js");

      await generateAIProxy(
        inputPath,
        outputPath,
        undefined,
        undefined,
        "cpu",
        "balanced",
        { startTime: 12, endTime: 42.5 }
      );

      const timingLine = logSpy.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes("[Proxy] encode timing"));

      expect(timingLine).toBeDefined();
      expect(timingLine).toContain("backend=cpu");
      expect(timingLine).toContain("duration=30.50s");
      expect(timingLine).toMatch(/wall=\d+\.\d+s/);
      expect(timingLine).toMatch(/speed=\d+\.\d+x/);
      expect(timingLine).not.toContain("status=failed");
    } finally {
      logSpy.mockRestore();
    }
  });
});
