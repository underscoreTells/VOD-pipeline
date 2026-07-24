import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestProgressiveWaveformBlocks } from '../../../src/pipeline/progressive-waveform.js';
import { combinePrerequisites, requireBinary, requireSupportedNode } from '../../helpers/prerequisites.js';

const binaryDirectory = path.resolve('binaries', process.platform, process.arch);
const ffmpegPath = fs.existsSync(path.join(binaryDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))
  ? path.join(binaryDirectory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : 'ffmpeg';
const ffprobePath = fs.existsSync(path.join(binaryDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'))
  ? path.join(binaryDirectory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  : 'ffprobe';
const prerequisite = combinePrerequisites(
  requireSupportedNode(),
  requireBinary(ffmpegPath, ['-version']),
  requireBinary(ffprobePath, ['-version'])
);
const describeProgressiveWaveform = prerequisite.ok ? describe : describe.skip;

describeProgressiveWaveform('progressive waveform generation', () => {
  let tempDir: string;
  let sourcePath: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progressive-waveform-integration-'));
    sourcePath = path.join(tempDir, 'source.m4a');
    await new Promise<void>((resolve, reject) => {
      const process = spawn(ffmpegPath, [
        '-v', 'error',
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1',
        '-c:a', 'aac',
        '-y',
        sourcePath,
      ], { stdio: 'ignore' });
      process.once('error', reject);
      process.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Fixture FFmpeg exited with ${code}`));
      });
    });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('streams a visible block through the TypeScript reducer and reuses its binary cache', async () => {
    const statuses: string[] = [];
    const request = {
      sourcePath,
      sourceDuration: 1,
      cacheRoot: path.join(tempDir, 'cache'),
      trackIndex: -1,
      startTime: 0,
      endTime: 1,
      pixelsPerSecond: 100,
      ffmpegPath,
      ffprobePath,
      audiowaveform: null,
      onProgress: (progress: { status: string }) => statuses.push(progress.status),
    };

    const generated = await requestProgressiveWaveformBlocks(request);
    expect(generated.blocks).toHaveLength(1);
    expect(generated.blocks[0].peakCount).toBeGreaterThan(0);
    expect(generated.blocks[0].encoding).toBe('int8-min-max');
    expect(statuses).toContain('generating');
    expect(statuses).toContain('ready');

    statuses.length = 0;
    const cached = await requestProgressiveWaveformBlocks(request);
    expect(Array.from(cached.blocks[0].peaks)).toEqual(Array.from(generated.blocks[0].peaks));
    expect(statuses).toEqual(['cached']);

    const files = fs.readdirSync(tempDir, { recursive: true, encoding: 'utf8' });
    expect(files.some((file) => file.endsWith('.wav'))).toBe(false);
    expect(files.some((file) => file.endsWith('.vwf'))).toBe(true);
  });
});
