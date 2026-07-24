import { describe, expect, it } from 'vitest';
import {
  buildAssetUrl,
  buildPlayableAssetUrl,
  looksLikeExternalStoragePath,
  setPitchPreservingPlaybackRate,
} from '../../src/renderer/lib/utils/media.js';

describe('media utils', () => {
  it('builds a vod asset URL for available assets', () => {
    expect(buildPlayableAssetUrl({ id: 42, availability: { exists: true } })).toBe(buildAssetUrl(42));
    expect(buildPlayableAssetUrl({ id: 42 })).toBe(buildAssetUrl(42));
  });

  it('returns an empty URL for unavailable assets', () => {
    expect(buildPlayableAssetUrl({ id: 42, availability: { exists: false } })).toBe('');
  });

  it('preserves pitch when changing media playback speed', () => {
    const media = {
      playbackRate: 1,
      preservesPitch: false,
      webkitPreservesPitch: false,
      mozPreservesPitch: false,
    } as unknown as HTMLMediaElement;

    setPitchPreservingPlaybackRate(media, 4);

    expect(media.playbackRate).toBe(4);
    expect(media.preservesPitch).toBe(true);
    expect((media as HTMLMediaElement & { webkitPreservesPitch: boolean }).webkitPreservesPitch).toBe(true);
    expect((media as HTMLMediaElement & { mozPreservesPitch: boolean }).mozPreservesPitch).toBe(true);
  });

  it('detects external-style mount paths', () => {
    expect(looksLikeExternalStoragePath('/mnt/nas')).toBe(true);
    expect(looksLikeExternalStoragePath('/media/drive')).toBe(true);
    expect(looksLikeExternalStoragePath('/Volumes/Raid')).toBe(true);
    expect(looksLikeExternalStoragePath('/home/alext/videos')).toBe(false);
  });
});
