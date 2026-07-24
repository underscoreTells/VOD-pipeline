#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(scriptDir, 'native-binaries.json');

export const nativeBinaryManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

export function getAudiowaveformTarget(platform, arch) {
  const targetKey = `${platform}-${arch}`;
  const target = nativeBinaryManifest.audiowaveform.targets[targetKey];

  if (!target) {
    throw new Error(`Unsupported audiowaveform target: ${targetKey}`);
  }

  return { key: targetKey, version: nativeBinaryManifest.audiowaveform.version, ...target };
}

function parseArguments(args) {
  const values = { platform: os.platform(), arch: os.arch(), outputDir: null };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--platform' || argument === '--arch' || argument === '--output-dir') {
      const value = args[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      if (argument === '--platform') values.platform = value;
      if (argument === '--arch') values.arch = value;
      if (argument === '--output-dir') values.outputDir = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return values;
}

export function downloadFile(url, destination, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        if (!response.headers.location || redirectsRemaining === 0) {
          reject(new Error(`Unable to follow download redirect for ${url}`));
          return;
        }
        resolve(downloadFile(new URL(response.headers.location, url).href, destination, redirectsRemaining - 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}: ${url}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (error) => {
        file.close();
        fs.rmSync(destination, { force: true });
        reject(error);
      });
    });

    request.on('error', (error) => {
      fs.rmSync(destination, { force: true });
      reject(error);
    });
  });
}

export function verifyChecksum(filePath, expectedSha256) {
  const actualSha256 = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${path.basename(filePath)}: expected ${expectedSha256}, got ${actualSha256}`);
  }
}

async function extractArchive(archivePath, archiveType, destination) {
  if (archiveType === 'zip') {
    const AdmZip = (await import('adm-zip')).default;
    new AdmZip(archivePath).extractAllTo(destination, true);
    return;
  }

  if (archiveType === 'deb') {
    try {
      execFileSync('dpkg-deb', ['-x', archivePath, destination], { stdio: 'ignore' });
    } catch {
      execFileSync('ar', ['x', archivePath], { cwd: destination, stdio: 'ignore' });
      const dataArchive = fs.readdirSync(destination).find((name) => name.startsWith('data.tar'));
      if (!dataArchive) throw new Error('Debian package did not contain a data archive');
      execFileSync('tar', ['-xf', dataArchive, '-C', destination], { stdio: 'ignore' });
    }
    return;
  }

  throw new Error(`Unsupported audiowaveform archive type: ${archiveType}`);
}

function verifyInstalledBinary(binaryPath, targetPlatform, targetArch) {
  if (!fs.existsSync(binaryPath) || !fs.statSync(binaryPath).isFile()) {
    throw new Error(`audiowaveform was not installed for ${targetPlatform}-${targetArch}: ${binaryPath}`);
  }

  if (targetPlatform !== 'win32') fs.chmodSync(binaryPath, 0o755);
}

export async function installAudiowaveform(options = {}) {
  const platform = options.platform || os.platform();
  const arch = options.arch || os.arch();
  const target = getAudiowaveformTarget(platform, arch);
  const outputDir = options.outputDir || path.join(process.cwd(), 'binaries', platform, arch);
  const binaryPath = path.join(outputDir, target.binaryName);

  fs.mkdirSync(outputDir, { recursive: true });

  if (target.source === 'ffmpeg-fallback') {
    fs.rmSync(binaryPath, { force: true });
    console.log(`Using the FFmpeg waveform backend for ${target.key}`);
    return null;
  }

  if (fs.existsSync(binaryPath)) {
    verifyInstalledBinary(binaryPath, platform, arch);
    console.log(`audiowaveform already prepared for ${target.key}: ${binaryPath}`);
    return binaryPath;
  }

  if (target.source === 'download') {
    const archivePath = path.join(outputDir, path.basename(new URL(target.url).pathname));
    const extractionDir = path.join(outputDir, '.audiowaveform-extract');

    try {
      console.log(`Downloading audiowaveform ${target.version} for ${target.key}`);
      await downloadFile(target.url, archivePath);
      verifyChecksum(archivePath, target.sha256);
      fs.rmSync(extractionDir, { recursive: true, force: true });
      fs.mkdirSync(extractionDir, { recursive: true });
      await extractArchive(archivePath, target.archiveType, extractionDir);

      const extractedBinary = path.join(extractionDir, target.archiveBinaryPath);
      if (!fs.existsSync(extractedBinary)) {
        throw new Error(`Archive did not contain ${target.archiveBinaryPath}`);
      }
      fs.copyFileSync(extractedBinary, binaryPath);
    } finally {
      fs.rmSync(archivePath, { force: true });
      fs.rmSync(extractionDir, { recursive: true, force: true });
    }
  } else throw new Error(`Unsupported audiowaveform source: ${target.source}`);

  verifyInstalledBinary(binaryPath, platform, arch);
  console.log(`Prepared audiowaveform for ${target.key}: ${binaryPath}`);
  return binaryPath;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  installAudiowaveform(parseArguments(process.argv.slice(2))).catch((error) => {
    console.error(`audiowaveform installation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
