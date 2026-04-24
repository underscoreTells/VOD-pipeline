import {
  generateWaveform as ipcGenerateWaveform,
  getWaveform as ipcGetWaveform,
  onWaveformProgress,
  type WaveformGenerateOptions,
  type WaveformGenerationResult,
  type WaveformResult,
} from '../api/waveforms.js';
import { projectDetail } from './project-media.svelte.js';
import { setError } from './timeline.svelte';

const MIX_WAVEFORM_TRACK_INDEX = -1;

export type WaveformUiMode = 'modal' | 'background';

export interface GenerateAssetWaveformUiOptions {
  uiMode?: WaveformUiMode;
}

let waveformUnavailableForSession = false;
let waveformUnavailableMessage: string | null = null;

function isWaveformDependencyUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('audiowaveform not found')
    || normalized.includes('install audiowaveform');
}

export function resetWaveformDependencyCacheForTests(): void {
  waveformUnavailableForSession = false;
  waveformUnavailableMessage = null;
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export async function generateAssetWaveform(
  assetId: number,
  trackIndex: number = 0,
  options: WaveformGenerateOptions = {},
  uiOptions: GenerateAssetWaveformUiOptions = {}
) {
  const uiMode = uiOptions.uiMode ?? 'modal';
  const showModalProgress = uiMode === 'modal';

  if (waveformUnavailableForSession) {
    if (showModalProgress && waveformUnavailableMessage) {
      setError(waveformUnavailableMessage);
    }
    return;
  }

  const asset = projectDetail.assets.find((item) => item.id === assetId) ?? null;
  if (asset?.availability.exists === false) {
    return;
  }

  const audioTrackCount = (() => {
    const count = asset?.metadata?.audioTracks?.length;
    if (typeof count === 'number' && Number.isInteger(count) && count > 0) {
      return count;
    }
    return 1;
  })();

  const isMkvMultiTrackMixRequest =
    trackIndex === MIX_WAVEFORM_TRACK_INDEX &&
    audioTrackCount > 1 &&
    Boolean(options.includeSourceTracks) &&
    Boolean(asset?.file_path?.toLowerCase().endsWith('.mkv'));

  const expectedTrackIndices = isMkvMultiTrackMixRequest
    ? [MIX_WAVEFORM_TRACK_INDEX, ...Array.from({ length: audioTrackCount }, (_, index) => index)]
    : [trackIndex];

  const perTrackTier1Progress = new Map<number, number>();
  let displayedPercent = 0;

  const updateProgress = (nextPercent: number, tier: number, status: string) => {
    if (!showModalProgress) {
      return;
    }

    const clampedPercent = clampPercent(nextPercent);
    const percent = Math.max(displayedPercent, clampedPercent);
    displayedPercent = percent;

    projectDetail.waveformProgress = {
      assetId,
      tier,
      percent,
      status,
    };
  };

  if (showModalProgress) {
    projectDetail.isGeneratingWaveform = true;
    projectDetail.waveformProgress = { assetId, tier: 0, percent: 0, status: 'Starting...' };
  }

  const unsubscribe = onWaveformProgress((event) => {
    if (event.assetId !== assetId) return;
    const eventTrackIndex = event.trackIndex ?? event.progress.trackIndex ?? trackIndex;

    if (isMkvMultiTrackMixRequest) {
      if (event.progress.tier !== 1) {
        return;
      }

      if (event.progress.percent <= 10) {
        updateProgress(event.progress.percent, event.progress.tier, event.progress.status);
        return;
      }

      if (!expectedTrackIndices.includes(eventTrackIndex)) {
        return;
      }

      const previousTrackPercent = perTrackTier1Progress.get(eventTrackIndex) ?? 20;
      const nextTrackPercent = Math.max(previousTrackPercent, clampPercent(event.progress.percent));
      perTrackTier1Progress.set(eventTrackIndex, nextTrackPercent);

      const normalizedAverage = expectedTrackIndices.reduce((sum, currentTrackIndex) => {
        const trackPercent = perTrackTier1Progress.get(currentTrackIndex) ?? 20;
        const normalized = Math.max(0, Math.min(1, (trackPercent - 20) / 80));
        return sum + normalized;
      }, 0) / expectedTrackIndices.length;

      const aggregatedPercent = 10 + (normalizedAverage * 90);
      updateProgress(aggregatedPercent, event.progress.tier, event.progress.status);
      return;
    }

    if (eventTrackIndex !== trackIndex) return;

    updateProgress(event.progress.percent, event.progress.tier, event.progress.status);
  });

  try {
    const result: WaveformGenerationResult = await ipcGenerateWaveform(assetId, trackIndex, options);

    if (result.success) {
      if (showModalProgress) {
        projectDetail.waveformProgress = { assetId, tier: 0, percent: 100, status: 'Complete' };
      }
    } else {
      throw new Error(result.error || 'Failed to generate waveform');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isWaveformDependencyUnavailableError(message)) {
      waveformUnavailableForSession = true;
      waveformUnavailableMessage = message;
    }
    setError(message);
  } finally {
    unsubscribe();
    if (showModalProgress) {
      projectDetail.isGeneratingWaveform = false;
    }
  }
}

export async function getAssetWaveform(assetId: number, trackIndex: number, tierLevel: number) {
  try {
    const result: WaveformResult = await ipcGetWaveform(assetId, trackIndex, tierLevel);
    if (result.success && result.data) {
      return result.data;
    }
    return null;
  } catch (error) {
    console.error('Failed to get waveform:', error);
    return null;
  }
}
