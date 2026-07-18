import { describe, expect, it } from 'vitest';
import { shouldRequestChapterWaveform } from '../../src/renderer/lib/components/chapter-cut/chapter-cut-waveform.js';

describe('chapter cut waveform loading', () => {
  it('does not retry an unavailable waveform for the same asset', () => {
    expect(shouldRequestChapterWaveform({
      assetId: 7,
      waveformAssetId: 7,
      waveformStatus: 'unavailable',
      isInFlight: false,
    })).toBe(false);
  });

  it('does not issue duplicate requests while an asset is loading', () => {
    expect(shouldRequestChapterWaveform({
      assetId: 7,
      waveformAssetId: 7,
      waveformStatus: 'loading',
      isInFlight: true,
    })).toBe(false);
  });

  it('loads a different asset after the current waveform is unavailable', () => {
    expect(shouldRequestChapterWaveform({
      assetId: 8,
      waveformAssetId: 7,
      waveformStatus: 'unavailable',
      isInFlight: false,
    })).toBe(true);
  });
});
