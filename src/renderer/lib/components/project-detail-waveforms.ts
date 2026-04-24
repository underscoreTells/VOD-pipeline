import type { Asset } from '$shared/types/database';
import type { GenerateAssetWaveformUiOptions } from '../state/project-waveforms.svelte.js';

interface WaveformSchedulerDeps {
  resolveAsset: (assetId: number) => Asset | null;
  getAssetWaveform: (
    assetId: number,
    trackIndex: number,
    tierLevel: 1 | 2 | 3
  ) => Promise<unknown>;
  generateAssetWaveform: (
    assetId: number,
    trackIndex: number,
    options: { playbackActive?: boolean },
    uiOptions?: GenerateAssetWaveformUiOptions
  ) => Promise<unknown>;
  isPlaybackActive: () => boolean;
}

export function createChapterWaveformScheduler(deps: WaveformSchedulerDeps) {
  let waveformCheckToken = 0;
  const waveformInFlight = new Set<string>();

  return {
    async ensureChapterWaveforms(
      assetIds: number[],
      mixWaveformTrackIndex: number
    ): Promise<void> {
      const token = ++waveformCheckToken;

      for (const assetId of assetIds) {
        if (token !== waveformCheckToken) return;

        const asset = deps.resolveAsset(assetId);
        if (asset?.availability?.exists === false) {
          continue;
        }

        const key = `${assetId}:${mixWaveformTrackIndex}`;
        if (waveformInFlight.has(key)) {
          continue;
        }

        const cached = await deps.getAssetWaveform(assetId, mixWaveformTrackIndex, 1);
        if (token !== waveformCheckToken) return;
        if (cached) {
          continue;
        }

        waveformInFlight.add(key);
        try {
          await deps.generateAssetWaveform(assetId, mixWaveformTrackIndex, {
            playbackActive: deps.isPlaybackActive(),
          }, {
            uiMode: 'background',
          });
        } finally {
          waveformInFlight.delete(key);
        }
      }
    },
  };
}
