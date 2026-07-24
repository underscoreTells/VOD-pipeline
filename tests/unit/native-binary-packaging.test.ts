import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  getAudiowaveformTarget,
  verifyChecksum,
  verifyInstalledBinary,
} from "../../scripts/install-audiowaveform.js";
import { verifyNativeBinaries } from "../../scripts/prepare-native-binaries.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("native binary target manifest", () => {
  it("pins supported audiowaveform downloads with SHA-256 checksums", () => {
    const manifest = JSON.parse(
      readFileSync(`${repoRoot}/scripts/native-binaries.json`, "utf8"),
    ) as {
      audiowaveform: {
        version: string;
        targets: Record<string, { source: string; url?: string; sha256?: string; binarySha256?: string }>;
      };
    };

    expect(manifest.audiowaveform.version).toBe("1.10.2");
    for (const target of Object.values(manifest.audiowaveform.targets)) {
      if (target.source !== "download") continue;
      expect(target.url).toContain("/download/1.10.2/");
      expect(target.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(target.binarySha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("uses the packaged FFmpeg fallback where no static audiowaveform artifact exists", () => {
    expect(getAudiowaveformTarget("darwin", "arm64")).toMatchObject({
      source: "ffmpeg-fallback",
      binaryName: "audiowaveform",
    });
    expect(getAudiowaveformTarget("darwin", "arm64")).not.toHaveProperty("url");
    expect(getAudiowaveformTarget("win32", "arm64")).toMatchObject({
      source: "ffmpeg-fallback",
      binaryName: "audiowaveform.exe",
    });
  });

  it("rejects unsupported platform and architecture combinations", () => {
    expect(() => getAudiowaveformTarget("linux", "ia32")).toThrow(
      "Unsupported audiowaveform target: linux-ia32",
    );
  });

  it("rejects downloaded content that does not match its pinned checksum", () => {
    const directory = mkdtempSync(join(tmpdir(), "vod-native-binary-"));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, "archive.zip");
    writeFileSync(archivePath, "known content");

    const checksum = createHash("sha256").update("known content").digest("hex");
    expect(() => verifyChecksum(archivePath, checksum)).not.toThrow();
    expect(() => verifyChecksum(archivePath, "0".repeat(64))).toThrow("Checksum mismatch");
  });

  it("rejects a cached audiowaveform executable that does not match the pinned binary", () => {
    const directory = mkdtempSync(join(tmpdir(), "vod-native-binary-"));
    temporaryDirectories.push(directory);
    const binaryPath = join(directory, "audiowaveform.exe");
    writeFileSync(binaryPath, "stale executable");

    expect(() => verifyInstalledBinary(binaryPath, "win32", "x64", "0".repeat(64))).toThrow(
      "Checksum mismatch",
    );
  });

  it.skipIf(process.platform === "win32")("verifies non-empty executable target files", () => {
    const directory = mkdtempSync(join(tmpdir(), "vod-native-binary-"));
    temporaryDirectories.push(directory);
    const targetDirectory = join(directory, "linux", "x64");
    mkdirSync(targetDirectory, { recursive: true });

    for (const name of ["ffmpeg", "ffprobe"]) {
      const binaryPath = join(targetDirectory, name);
      const binary = Buffer.alloc(64);
      binary[0] = 0x7f;
      binary.write("ELF", 1, "ascii");
      binary[5] = 1;
      binary.writeUInt16LE(62, 18);
      writeFileSync(binaryPath, binary);
      chmodSync(binaryPath, 0o755);
    }

    expect(() => verifyNativeBinaries("linux", "x64", directory, { verifyChecksums: false })).not.toThrow();
    writeFileSync(join(targetDirectory, "ffprobe"), "");
    expect(() => verifyNativeBinaries("linux", "x64", directory, { verifyChecksums: false })).toThrow(
      "Missing native binaries for linux-x64: ffprobe",
    );
  });

  it.skipIf(process.platform === "win32")("rejects a binary for the wrong target architecture", () => {
    const directory = mkdtempSync(join(tmpdir(), "vod-native-binary-"));
    temporaryDirectories.push(directory);
    const targetDirectory = join(directory, "linux", "arm64");
    mkdirSync(targetDirectory, { recursive: true });

    for (const name of ["ffmpeg", "ffprobe"]) {
      const binary = Buffer.alloc(64);
      binary[0] = 0x7f;
      binary.write("ELF", 1, "ascii");
      binary[5] = 1;
      binary.writeUInt16LE(62, 18);
      const binaryPath = join(targetDirectory, name);
      writeFileSync(binaryPath, binary);
      chmodSync(binaryPath, 0o755);
    }

    expect(() => verifyNativeBinaries("linux", "arm64", directory, { verifyChecksums: false })).toThrow(
      "expected elf-arm64",
    );
  });
});
