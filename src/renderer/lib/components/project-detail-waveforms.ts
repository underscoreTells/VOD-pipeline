import type { Asset } from '$shared/types/database';

export function getAssetAudioTrackCount(asset: Asset | null): number {
  const trackCount = asset?.metadata?.audioTracks?.length;
  if (typeof trackCount === 'number' && Number.isInteger(trackCount) && trackCount > 0) {
    return trackCount;
  }

  return 1;
}

export function isMkvAsset(asset: Asset | null): boolean {
  return Boolean(asset?.file_path?.toLowerCase().endsWith('.mkv'));
}

export function getWaveformTrackIndices(
  asset: Asset | null,
  includeSourceTracks: boolean,
  mixWaveformTrackIndex: number
): number[] {
  const count = getAssetAudioTrackCount(asset);
  if (!includeSourceTracks || count <= 1) {
    return [mixWaveformTrackIndex];
  }

  const sourceTracks = Array.from({ length: count }, (_, index) => index);
  return [mixWaveformTrackIndex, ...sourceTracks];
}

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
    options: { includeSourceTracks?: boolean; playbackActive?: boolean }
  ) => Promise<unknown>;
  isPlaybackActive: () => boolean;
}

export function createChapterWaveformScheduler(deps: WaveformSchedulerDeps) {
  let waveformCheckToken = 0;
  const waveformInFlight = new Set<string>();

  return {
    async ensureChapterWaveforms(
      assetIds: number[],
      includeSourceTracks: boolean,
      mixWaveformTrackIndex: number
    ): Promise<void> {
      const token = ++waveformCheckToken;

      for (const assetId of assetIds) {
        if (token !== waveformCheckToken) return;

        const asset = deps.resolveAsset(assetId);
        if (asset?.availability?.exists === false) {
          continue;
        }

        const sourceTrackCount = getAssetAudioTrackCount(asset);
        const trackIndices = getWaveformTrackIndices(asset, includeSourceTracks, mixWaveformTrackIndex);

        const shouldBatchGenerateMkvTracks =
          includeSourceTracks &&
          sourceTrackCount > 1 &&
          isMkvAsset(asset);

        if (shouldBatchGenerateMkvTracks) {
          const batchKey = `${assetId}:${mixWaveformTrackIndex}:batch`;
          if (waveformInFlight.has(batchKey)) {
            continue;
          }

          let hasMissingTrack = false;
          for (const trackIndex of trackIndices) {
            const cached = await deps.getAssetWaveform(assetId, trackIndex, 1);
            if (token !== waveformCheckToken) return;
            if (!cached) {
              hasMissingTrack = true;
              break;
            }
          }

          if (!hasMissingTrack) {
            continue;
          }

          waveformInFlight.add(batchKey);
          try {
            await deps.generateAssetWaveform(assetId, mixWaveformTrackIndex, {
              includeSourceTracks: true,
              playbackActive: deps.isPlaybackActive(),
            });
          } finally {
            waveformInFlight.delete(batchKey);
          }

          continue;
        }

        for (const trackIndex of trackIndices) {
          if (token !== waveformCheckToken) return;

          const key = `${assetId}:${trackIndex}`;
          if (waveformInFlight.has(key)) {
            continue;
          }

          const cached = await deps.getAssetWaveform(assetId, trackIndex, 1);
          if (token !== waveformCheckToken) return;
          if (cached) {
            continue;
          }

          waveformInFlight.add(key);
          try {
            await deps.generateAssetWaveform(assetId, trackIndex, {
              includeSourceTracks: false,
              playbackActive: deps.isPlaybackActive(),
            });
          } finally {
            waveformInFlight.delete(key);
          }
        }
      }
    },
  };
}
