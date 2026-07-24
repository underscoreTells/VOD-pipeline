import type {
  WaveformGenerateOptions,
  WaveformGenerationResult,
  WaveformBlockProgressEvent,
  WaveformBlocksRequest,
  WaveformBlocksResult,
  WaveformProgressEvent,
  WaveformResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  WaveformGenerateOptions,
  WaveformGenerationResult,
  WaveformBlockProgressEvent,
  WaveformBlocksRequest,
  WaveformBlocksResult,
  WaveformProgressEvent,
  WaveformResult,
} from '../../../shared/contracts/electron-api.js';

export async function getWaveform(
  assetId: number,
  trackIndex: number,
  tierLevel: number
): Promise<WaveformResult> {
  return await getElectronApi().waveforms.get(assetId, trackIndex, tierLevel);
}

export async function generateWaveform(
  assetId: number,
  trackIndex: number,
  options?: WaveformGenerateOptions
): Promise<WaveformGenerationResult> {
  return await getElectronApi().waveforms.generate(assetId, trackIndex, options);
}

export function onWaveformProgress(
  callback: (data: WaveformProgressEvent) => void
): () => void {
  return getElectronApi().waveforms.onProgress(callback);
}

export async function requestWaveformBlocks(
  request: WaveformBlocksRequest
): Promise<WaveformBlocksResult> {
  return await getElectronApi().waveforms.requestBlocks(request);
}

export function onWaveformBlockProgress(
  callback: (data: WaveformBlockProgressEvent) => void
): () => void {
  return getElectronApi().waveforms.onBlockProgress(callback);
}
