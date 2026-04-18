import type {
  TranscriptionBackendStatus,
  TranscriptionProgressEvent,
  TranscriptionResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  TranscriptionBackendStatus,
  TranscriptionProgressEvent,
  TranscriptionResult,
} from '../../../shared/contracts/electron-api.js';

export async function getTranscriptionStatus(autoSetup = false): Promise<{
  success: boolean;
  data?: TranscriptionBackendStatus;
  error?: string;
}> {
  return await getElectronApi().transcription.getStatus({ autoSetup });
}

export async function transcribeChapter(
  chapterId: number,
  options?: Record<string, unknown>
): Promise<TranscriptionResult> {
  return await getElectronApi().transcription.transcribe(chapterId, options);
}

export function onTranscriptionProgress(
  callback: (data: TranscriptionProgressEvent) => void
): () => void {
  return getElectronApi().transcription.onProgress(callback);
}
