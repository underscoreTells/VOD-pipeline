import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn() },
}));
const databaseMocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  getWaveform: vi.fn(),
  saveWaveform: vi.fn(),
}));
const detectorMocks = vi.hoisted(() => ({
  getAudiowaveformPath: vi.fn(),
  getFFmpegPath: vi.fn(),
  getFFprobePath: vi.fn(),
}));
const progressiveMocks = vi.hoisted(() => ({
  requestProgressiveWaveformBlocks: vi.fn(),
}));
const schedulerMocks = vi.hoisted(() => ({
  enqueueHeavyMediaJob: vi.fn(),
}));

vi.mock('electron', () => electronMocks);
vi.mock('../../src/electron/database/index.js', () => databaseMocks);
vi.mock('../../src/electron/audiowaveformDetector.js', () => ({
  getAudiowaveformPath: detectorMocks.getAudiowaveformPath,
}));
vi.mock('../../src/electron/ffmpegDetector.js', () => ({
  getFFmpegPath: detectorMocks.getFFmpegPath,
  getFFprobePath: detectorMocks.getFFprobePath,
}));
vi.mock('../../src/electron/paths.js', () => ({
  getWaveformCacheDirectoryPath: () => '/user-data/waveforms',
}));
vi.mock('../../src/pipeline/progressive-waveform.js', () => progressiveMocks);
vi.mock('../../src/pipeline/waveform.js', () => ({
  generateWaveformTiers: vi.fn(),
  WaveformError: class WaveformError extends Error {},
}));
vi.mock('../../src/electron/ipc/support/heavy-media-queue.js', () => schedulerMocks);

describe('waveform block IPC handler', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.ipcMain.handle.mockReset();
    Object.values(databaseMocks).forEach((mock) => mock.mockReset());
    Object.values(detectorMocks).forEach((mock) => mock.mockReset());
    progressiveMocks.requestProgressiveWaveformBlocks.mockReset();
    schedulerMocks.enqueueHeavyMediaJob.mockReset();

    databaseMocks.getAsset.mockResolvedValue({
      id: 7,
      file_path: import.meta.filename,
      duration: 600,
    });
    detectorMocks.getFFmpegPath.mockReturnValue({ path: '/bin/ffmpeg', source: 'system', version: '7' });
    detectorMocks.getFFprobePath.mockReturnValue('/bin/ffprobe');
    detectorMocks.getAudiowaveformPath.mockReturnValue(null);
    progressiveMocks.requestProgressiveWaveformBlocks.mockResolvedValue({
      sourceFingerprint: 'fingerprint',
      cacheVersion: 1,
      blockDuration: 30,
      pixelsPerSecond: 100,
      blocks: [],
    });
  });

  it('registers and serves visible block requests with progress forwarding', async () => {
    const { registerWaveformHandlers, WAVEFORM_HANDLER_CHANNELS } = await import(
      '../../src/electron/ipc/handlers/waveforms.js'
    );
    registerWaveformHandlers();
    expect(WAVEFORM_HANDLER_CHANNELS).toContain('waveform:blocks-request');
    const registration = electronMocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'waveform:blocks-request'
    );
    expect(registration).toBeDefined();
    const send = vi.fn();
    const handler = registration![1];

    const response = await handler({ sender: { send } }, {
      assetId: 7,
      trackIndex: -1,
      startTime: 90,
      endTime: 120,
      pixelsPerSecond: 100,
      requestMode: 'interactive',
    });

    expect(response.success).toBe(true);
    expect(response.data.status).toBe('ready');
    const request = progressiveMocks.requestProgressiveWaveformBlocks.mock.calls[0][0];
    expect(request).toMatchObject({
      sourcePath: import.meta.filename,
      sourceDuration: 600,
      cacheRoot: '/user-data/waveforms',
      trackIndex: -1,
      startTime: 90,
      endTime: 120,
      pixelsPerSecond: 100,
    });

    request.onProgress({
      blockIndex: 3,
      completedBlocks: 0,
      totalBlocks: 1,
      percent: 0,
      status: 'queued',
    });
    expect(send).toHaveBeenCalledWith('waveform:block-progress', expect.objectContaining({
      assetId: 7,
      trackIndex: -1,
      blockIndex: 3,
      status: 'queued',
    }));

    const run = vi.fn();
    request.scheduleBlock('waveform:key', run);
    expect(schedulerMocks.enqueueHeavyMediaJob).toHaveBeenCalledWith(
      'waveform:key',
      'waveformBlock',
      'interactive',
      run,
      { resourceClass: 'cpu' }
    );
  });
});
