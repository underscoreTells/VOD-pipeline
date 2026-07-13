import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../channels.js';
import { createSuccessResponse } from '../shared.js';
import { getGPUStatus, detectGPUEncoders } from '../../gpuDetector.js';
import { getFFmpegPath } from '../../ffmpegDetector.js';

export const GPU_HANDLER_CHANNELS = [IPC_CHANNELS.GPU_STATUS];

/**
 * Register GPU status IPC handlers.
 *
 * `gpu:status` returns the cached detection state so the Settings UI can show
 * which encoder backend won, which ffmpeg binary was selected, and why a CPU
 * fallback is in effect. If no detection has run yet (e.g. the user opened
 * Settings before any proxy job), the handler triggers a detection probe
 * against the resolved ffmpeg path so the UI has real data to display.
 */
export function registerGpuHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GPU_STATUS, async () => {
    const cached = getGPUStatus();
    if (cached.detected || cached.fallbackReason) {
      return createSuccessResponse(cached);
    }

    // No detection has run yet. Trigger one against the resolved ffmpeg path
    // so the Settings UI gets real data instead of an empty placeholder.
    const ffmpegPath = getFFmpegPath();
    if (ffmpegPath) {
      await detectGPUEncoders(ffmpegPath.path);
    }
    return createSuccessResponse(getGPUStatus());
  });
}
