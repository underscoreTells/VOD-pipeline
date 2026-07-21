import { describe, expect, it } from 'vitest';
import {
  shouldReloadWaveformOnProgress,
  shouldRequestChapterWaveform,
} from '../../src/renderer/lib/components/chapter-cut/chapter-cut-waveform.js';

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

  it('does not reload on generation progress while a load is in flight', () => {
    expect(shouldReloadWaveformOnProgress({
      eventAssetId: 7,
      activeAssetId: 7,
      percent: 100,
      isInFlight: true,
    })).toBe(false);
  });

  it('reloads on completed generation when no load is in flight', () => {
    expect(shouldReloadWaveformOnProgress({
      eventAssetId: 7,
      activeAssetId: 7,
      percent: 100,
      isInFlight: false,
    })).toBe(true);
  });

  it('ignores progress for other assets or incomplete generation', () => {
    expect(shouldReloadWaveformOnProgress({
      eventAssetId: 8,
      activeAssetId: 7,
      percent: 100,
      isInFlight: false,
    })).toBe(false);
    expect(shouldReloadWaveformOnProgress({
      eventAssetId: 7,
      activeAssetId: 7,
      percent: 62,
      isInFlight: false,
    })).toBe(false);
  });
});
