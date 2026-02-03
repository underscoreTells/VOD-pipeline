import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
let cachedResult = null;
/**
 * Detect FFmpeg installation using fallback cascade
 * 1. Bundled binary (production)
 * 2. Development directory
 * 3. User data directory
 * 4. System PATH
 */
export async function detectFFmpeg() {
    if (cachedResult) {
        return cachedResult;
    }
    try {
        const platform = process.platform;
        const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const resourcesPath = process.resourcesPath || process.cwd();
        const detectionOrder = [
            {
                path: path.join(resourcesPath, 'binaries', platform, binaryName),
                source: 'bundled',
            },
            {
                path: path.join(process.cwd(), 'binaries', platform, binaryName),
                source: 'development',
            },
            {
                path: path.join(app.getPath('userData'), 'binaries', binaryName),
                source: 'userData',
            },
            {
                path: binaryName,
                source: 'system',
            },
        ];
        for (const { path: testPath, source } of detectionOrder) {
            if (await isExecutable(testPath)) {
                const version = await getFFmpegVersion(testPath);
                if (version) {
                    cachedResult = { path: testPath, source, version };
                    console.log(`[FFmpeg] Found at: ${testPath} (source: ${source}, version: ${version})`);
                    return cachedResult;
                }
            }
        }
        console.warn('[FFmpeg] No FFmpeg installation found');
        return null;
    }
    catch (error) {
        console.error('[FFmpeg] Detection failed:', error);
        return null;
    }
}
/**
 * Get cached FFmpeg detection result
 */
export function getFFmpegPath() {
    return cachedResult;
}
/**
 * Clear cached detection result (for testing)
 */
export function clearFFmpegCache() {
    cachedResult = null;
}
/**
 * Check if a path is executable
 */
async function isExecutable(filePath) {
    // For system PATH commands, just check if we can run it
    if (path.basename(filePath) === filePath) {
        return new Promise((resolve) => {
            const proc = spawn(filePath, ['-version'], { stdio: 'ignore' });
            proc.on('error', () => resolve(false));
            proc.on('exit', (code) => resolve(code === 0));
        });
    }
    // For absolute paths, check if file exists and is executable
    try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile())
            return false;
        // On Windows, just check if file exists
        if (process.platform === 'win32')
            return true;
        // On Unix, check executable bit
        const mode = stats.mode;
        return (mode & 0o111) !== 0;
    }
    catch {
        return false;
    }
}
/**
 * Extract version string from FFmpeg
 */
export async function getFFmpegVersion(executablePath) {
    return new Promise((resolve) => {
        const proc = spawn(executablePath, ['-version']);
        let output = '';
        proc.stdout.on('data', (data) => {
            output += data.toString();
        });
        proc.on('error', () => resolve(null));
        proc.on('exit', (code) => {
            if (code !== 0) {
                resolve(null);
                return;
            }
            // Parse version from first line: "ffmpeg version 6.0 Copyright..."
            const match = output.match(/ffmpeg version\s+(\S+)/i);
            resolve(match ? match[1] : null);
        });
    });
}
/**
 * Get ffprobe path from FFmpeg path
 */
export function getFFprobePath(ffmpegPath) {
    const dir = path.dirname(ffmpegPath);
    const ext = path.extname(ffmpegPath);
    const baseName = 'ffprobe';
    return path.join(dir, baseName + ext);
}
