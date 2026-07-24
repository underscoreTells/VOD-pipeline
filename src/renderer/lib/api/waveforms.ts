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
  request: WaveformBlocksRequest,
  signal?: AbortSignal
): Promise<WaveformBlocksResult> {
  if (signal?.aborted) throw new DOMException('Waveform block request aborted', 'AbortError');
  const requestId = crypto.randomUUID();
  const api = getElectronApi().waveforms;
  const cancel = () => void api.cancelBlockRequest(requestId).catch(() => undefined);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await api.requestBlocks({ ...request, requestId });
    if (signal?.aborted) throw new DOMException('Waveform block request aborted', 'AbortError');
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export function onWaveformBlockProgress(
  callback: (data: WaveformBlockProgressEvent) => void
): () => void {
  return getElectronApi().waveforms.onBlockProgress(callback);
}
