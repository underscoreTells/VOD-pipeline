import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  getAudiowaveformDetectionCandidates,
  getAudiowaveformVersion,
} from "../../src/electron/audiowaveformDetector.js";
import {
  getFFmpegDetectionCandidates,
  getFFmpegVersion,
  getFFprobeVersion,
} from "../../src/electron/ffmpegDetector.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("native binary detectors", () => {
  it("prefers architecture-specific paths while retaining legacy paths", () => {
    const options = {
      platform: "linux" as const,
      arch: "arm64",
      resourcesPath: "/resources",
      cwd: "/workspace",
      userDataPath: "/user-data",
    };

    expect(getAudiowaveformDetectionCandidates(options).map((candidate) => candidate.path)).toEqual([
      "/resources/binaries/linux/arm64/audiowaveform",
      "/resources/binaries/linux/audiowaveform",
      "/workspace/binaries/linux/arm64/audiowaveform",
      "/workspace/binaries/linux/audiowaveform",
      "/user-data/binaries/linux/arm64/audiowaveform",
      "/user-data/binaries/audiowaveform",
      "audiowaveform",
    ]);

    expect(getFFmpegDetectionCandidates(options).map((candidate) => candidate.path)).toEqual([
      "/resources/binaries/linux/arm64/ffmpeg",
      "/resources/binaries/linux/ffmpeg",
      "/workspace/binaries/linux/arm64/ffmpeg",
      "/workspace/binaries/linux/ffmpeg",
      "/user-data/binaries/linux/arm64/ffmpeg",
      "/user-data/binaries/ffmpeg",
      "ffmpeg",
    ]);
  });

  it.skipIf(process.platform === "win32")("reads version output written to stderr", async () => {
    const directory = mkdtempSync(join(tmpdir(), "vod-native-detector-"));
    temporaryDirectories.push(directory);

    const audiowaveformPath = join(directory, "audiowaveform");
    const ffmpegPath = join(directory, "ffmpeg");
    const ffprobePath = join(directory, "ffprobe");
    writeFileSync(audiowaveformPath, "#!/bin/sh\necho 'audiowaveform 1.10.2' >&2\n");
    writeFileSync(ffmpegPath, "#!/bin/sh\necho 'ffmpeg version 7.1 Copyright' >&2\n");
    writeFileSync(ffprobePath, "#!/bin/sh\necho 'ffprobe version 7.1 Copyright' >&2\n");
    chmodSync(audiowaveformPath, 0o755);
    chmodSync(ffmpegPath, 0o755);
    chmodSync(ffprobePath, 0o755);

    await expect(getAudiowaveformVersion(audiowaveformPath)).resolves.toBe("1.10.2");
    await expect(getFFmpegVersion(ffmpegPath)).resolves.toBe("7.1");
    await expect(getFFprobeVersion(ffprobePath)).resolves.toBe("7.1");
  });
});
