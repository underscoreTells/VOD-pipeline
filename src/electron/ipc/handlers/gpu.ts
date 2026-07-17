import { ipcMain } from 'electron';
import { IPC_CHANNELS, IPC_ERROR_CODES } from '../channels.js';
import { createErrorResponse, createSuccessResponse } from '../shared.js';
import { getGPUStatus, detectGPUEncoders } from '../../gpuDetector.js';
import { getFFmpegPath } from '../../ffmpegDetector.js';
import { gpuStatusSchema } from '../schemas.js';

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
  ipcMain.handle(IPC_CHANNELS.GPU_STATUS, async (_, payload) => {
    const parsed = gpuStatusSchema.safeParse(payload);
    if (!parsed.success) {
      return createErrorResponse('Invalid GPU status payload', IPC_ERROR_CODES.VALIDATION_ERROR);
    }

    const force = parsed.data?.force === true;
    const cached = getGPUStatus();
    if (!force && (cached.detected || cached.fallbackReason)) {
      return createSuccessResponse(cached);
    }

    // No detection has run yet. Trigger one against the resolved ffmpeg path
    // so the Settings UI gets real data instead of an empty placeholder.
    const ffmpegPath = getFFmpegPath();
    if (ffmpegPath) {
      await detectGPUEncoders(ffmpegPath.path, force);
    }
    return createSuccessResponse(getGPUStatus());
  });
}
