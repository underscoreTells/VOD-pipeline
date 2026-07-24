#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  downloadFile,
  installAudiowaveform,
  nativeBinaryManifest,
  verifyChecksum,
} from './install-audiowaveform.js';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const electronBuilderArchitectures = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

function parseArguments(args) {
  const values = { platform: os.platform(), arch: os.arch(), verifyOnly: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--verify-only') {
      values.verifyOnly = true;
    } else if (argument === '--platform' || argument === '--arch') {
      const value = args[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      values[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return values;
}

function targetKey(platform, arch) {
  return `${platform}-${arch}`;
}

function expectedFFmpegNames(platform, arch) {
  return getFFmpegTarget(platform, arch).map((binary) => binary.name);
}

function getFFmpegTarget(platform, arch) {
  const binaries = nativeBinaryManifest.ffmpeg.targets[targetKey(platform, arch)];
  if (!binaries) throw new Error(`Unsupported native binary target: ${targetKey(platform, arch)}`);
  return binaries;
}

const ARCHITECTURE_IDS = {
  elf: { 3: 'ia32', 40: 'arm', 62: 'x64', 183: 'arm64' },
  pe: { 0x014c: 'ia32', 0x8664: 'x64', 0xaa64: 'arm64' },
  macho: { 0x01000007: 'x64', 0x0100000c: 'arm64' },
};

export function readBinaryArchitecture(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 20 && buffer[0] === 0x7f && buffer.subarray(1, 4).toString('ascii') === 'ELF') {
    const littleEndian = buffer[5] === 1;
    const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18);
    return { format: 'elf', arch: ARCHITECTURE_IDS.elf[machine] ?? null };
  }
  if (buffer.length >= 64 && buffer.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (peOffset + 6 <= buffer.length && buffer.subarray(peOffset, peOffset + 4).toString('ascii') === 'PE\0\0') {
      return { format: 'pe', arch: ARCHITECTURE_IDS.pe[buffer.readUInt16LE(peOffset + 4)] ?? null };
    }
  }
  if (buffer.length >= 8) {
    const magic = buffer.readUInt32LE(0);
    if (magic === 0xfeedface || magic === 0xfeedfacf) {
      return { format: 'macho', arch: ARCHITECTURE_IDS.macho[buffer.readUInt32LE(4)] ?? null };
    }
  }
  return { format: null, arch: null };
}

function verifyBinaryArchitecture(filePath, platform, arch) {
  const expectedFormat = platform === 'win32' ? 'pe' : platform === 'darwin' ? 'macho' : 'elf';
  const detected = readBinaryArchitecture(filePath);
  if (detected.format !== expectedFormat || detected.arch !== arch) {
    throw new Error(
      `${path.basename(filePath)} is ${detected.format ?? 'unknown'}-${detected.arch ?? 'unknown'}, ` +
      `expected ${expectedFormat}-${arch}`,
    );
  }
}

async function installFFmpegTarget(platform, arch, outputDir) {
  const binaries = getFFmpegTarget(platform, arch);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const binary of binaries) {
    const destination = path.join(outputDir, binary.name);
    let prepared = false;
    if (fs.existsSync(destination)) {
      try {
        verifyChecksum(destination, binary.sha256);
        verifyBinaryArchitecture(destination, platform, arch);
        prepared = true;
      } catch {
        fs.rmSync(destination, { force: true });
      }
    }
    if (prepared) continue;

    const temporaryPath = `${destination}.download`;
    try {
      console.log(`Downloading FFmpeg ${nativeBinaryManifest.ffmpeg.version} ${binary.name} for ${targetKey(platform, arch)}`);
      await downloadFile(binary.url, temporaryPath);
      verifyChecksum(temporaryPath, binary.sha256);
      verifyBinaryArchitecture(temporaryPath, platform, arch);
      fs.renameSync(temporaryPath, destination);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
    if (platform !== 'win32') fs.chmodSync(destination, 0o755);
  }
}

export function verifyNativeBinaries(
  platform,
  arch,
  baseDir = path.join(repoRoot, 'binaries'),
  options = { verifyChecksums: true },
) {
  const outputDir = path.join(baseDir, platform, arch);
  const audiowaveform = nativeBinaryManifest.audiowaveform.targets[targetKey(platform, arch)];
  if (!audiowaveform) throw new Error(`Unsupported native binary target: ${targetKey(platform, arch)}`);

  const expectedNames = [
    ...(audiowaveform.source === 'download' ? [audiowaveform.binaryName] : []),
    ...expectedFFmpegNames(platform, arch),
  ];
  const missing = expectedNames.filter((name) => {
    const binaryPath = path.join(outputDir, name);
    if (!fs.existsSync(binaryPath)) return true;
    const stats = fs.statSync(binaryPath);
    return !stats.isFile()
      || stats.size === 0
      || (platform !== 'win32' && (stats.mode & 0o111) === 0);
  });

  if (missing.length > 0) {
    throw new Error(`Missing native binaries for ${targetKey(platform, arch)}: ${missing.join(', ')}`);
  }

  for (const name of expectedNames) {
    verifyBinaryArchitecture(path.join(outputDir, name), platform, arch);
  }
  if (options.verifyChecksums) {
    for (const binary of getFFmpegTarget(platform, arch)) {
      verifyChecksum(path.join(outputDir, binary.name), binary.sha256);
    }
  }

  console.log(`Verified native binaries for ${targetKey(platform, arch)}: ${expectedNames.join(', ')}`);
}

export async function prepareNativeBinaries({ platform, arch, verifyOnly = false }) {
  const outputDir = path.join(repoRoot, 'binaries', platform, arch);

  if (!verifyOnly) {
    await installAudiowaveform({ platform, arch, outputDir });
    await installFFmpegTarget(platform, arch, outputDir);
  }

  verifyNativeBinaries(platform, arch);
}

function architectureName(arch) {
  if (typeof arch === 'string') return arch;
  const name = electronBuilderArchitectures[arch];
  if (!name) throw new Error(`Unknown electron-builder architecture: ${arch}`);
  return name;
}

export default async function prepareNativeBinariesForElectronBuilder(context) {
  await prepareNativeBinaries({
    platform: context.electronPlatformName,
    arch: architectureName(context.arch),
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === scriptPath;
if (isMainModule) {
  prepareNativeBinaries(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(`Native binary preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
