import { describe, expect, it, vi } from 'vitest';

const waveformMocks = vi.hoisted(() => ({
  requestBlocks: vi.fn(),
  cancelBlockRequest: vi.fn(),
}));

vi.mock('../../src/renderer/lib/api/client.js', () => ({
  getElectronApi: () => ({ waveforms: waveformMocks }),
}));

describe('waveform renderer API', () => {
  it('forwards aborts to the matching main-process request', async () => {
    let resolveRequest!: (value: { success: boolean }) => void;
    waveformMocks.requestBlocks.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    waveformMocks.cancelBlockRequest.mockResolvedValue({ success: true, data: { cancelled: true } });
    const { requestWaveformBlocks } = await import('../../src/renderer/lib/api/waveforms.js');
    const controller = new AbortController();
    const result = requestWaveformBlocks({
      assetId: 7,
      trackIndex: -1,
      startTime: 0,
      endTime: 300,
      requestMode: 'interactive',
    }, controller.signal);
    const requestId = waveformMocks.requestBlocks.mock.calls[0][0].requestId;

    controller.abort();
    resolveRequest({ success: false });

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(waveformMocks.cancelBlockRequest).toHaveBeenCalledWith(requestId);
  });
});
