import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface AudiowaveformPathResult {
  path: string;
  source: 'bundled' | 'development' | 'userData' | 'system';
  version: string;
}

interface DetectionCandidate {
  path: string;
  source: AudiowaveformPathResult['source'];
}

let cachedResult: AudiowaveformPathResult | null = null;

/**
 * Detect audiowaveform installation using fallback cascade
 * 1. Bundled binary (production)
 * 2. Development directory
 * 3. User data directory
 * 4. System PATH (includes Arch AUR installs)
 */
export async function detectAudiowaveform(): Promise<AudiowaveformPathResult | null> {
  if (cachedResult) {
    return cachedResult;
  }

  try {
    const platform = process.platform;
    const userDataPath = await getElectronUserDataPath();
    const detectionOrder = getAudiowaveformDetectionCandidates({
      platform,
      arch: process.arch,
      resourcesPath: process.resourcesPath || process.cwd(),
      cwd: process.cwd(),
      userDataPath,
    });

    for (const { path: testPath, source } of detectionOrder) {
      if (await isExecutable(testPath)) {
        const version = await getAudiowaveformVersion(testPath);
        if (version) {
          cachedResult = { path: testPath, source, version };
          console.log(`[Audiowaveform] Found at: ${testPath} (source: ${source}, version: ${version})`);
          return cachedResult;
        }
      }
    }

    console.warn('[Audiowaveform] No audiowaveform installation found');
    console.warn('[Audiowaveform] The FFmpeg streaming waveform backend will be used');
    return null;
  } catch (error) {
    console.error('[Audiowaveform] Detection failed:', error);
    return null;
  }
}

/**
 * Get cached audiowaveform detection result
 */
export function getAudiowaveformPath(): AudiowaveformPathResult | null {
  return cachedResult;
}

/**
 * Clear cached detection result (for testing)
 */
export function clearAudiowaveformCache(): void {
  cachedResult = null;
}

/**
 * Check if a path is executable
 */
async function isExecutable(filePath: string): Promise<boolean> {
  // For system PATH commands, just check if we can run it
  if (path.basename(filePath) === filePath) {
    return new Promise((resolve) => {
      const proc = spawn(filePath, ['--version'], { stdio: 'ignore' });
      proc.on('error', () => resolve(false));
      proc.on('exit', (code) => resolve(code === 0));
    });
  }

  // For absolute paths, check if file exists and is executable
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return false;

    // On Windows, just check if file exists
    if (process.platform === 'win32') return true;

    // On Unix, check executable bit
    const mode = stats.mode;
    return (mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Extract version string from audiowaveform
 */
export async function getAudiowaveformVersion(executablePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(executablePath, ['--version']);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('error', () => resolve(null));

    proc.on('exit', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      // Parse version from output: "AudioWaveform v1.10.3" or "audiowaveform version 1.10.2"
      const match = output.match(/audiowaveform\s+v?(\S+)/i);
      resolve(match ? match[1] : null);
    });
  });
}

export function getAudiowaveformDetectionCandidates(options: {
  platform: NodeJS.Platform;
  arch: string;
  resourcesPath: string;
  cwd: string;
  userDataPath: string | null;
}): DetectionCandidate[] {
  const { platform, arch, resourcesPath, cwd, userDataPath } = options;
  const binaryName = platform === 'win32' ? 'audiowaveform.exe' : 'audiowaveform';
  const candidates: DetectionCandidate[] = [
    { path: path.join(resourcesPath, 'binaries', platform, arch, binaryName), source: 'bundled' },
    { path: path.join(resourcesPath, 'binaries', platform, binaryName), source: 'bundled' },
    { path: path.join(cwd, 'binaries', platform, arch, binaryName), source: 'development' },
    { path: path.join(cwd, 'binaries', platform, binaryName), source: 'development' },
  ];

  if (userDataPath) {
    candidates.push(
      { path: path.join(userDataPath, 'binaries', platform, arch, binaryName), source: 'userData' },
      { path: path.join(userDataPath, 'binaries', binaryName), source: 'userData' },
    );
  }

  candidates.push({ path: binaryName, source: 'system' });
  return candidates;
}

/**
 * Check if audiowaveform is available
 * Returns true if detection was successful
 */
export function isAudiowaveformAvailable(): boolean {
  return cachedResult !== null;
}

async function getElectronUserDataPath(): Promise<string | null> {
  try {
    const electron = await import('electron');
    return electron.app?.getPath('userData') ?? null;
  } catch {
    return null;
  }
}
