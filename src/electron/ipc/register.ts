import { ipcMain } from 'electron';
import { registerLegacyIpcHandlers } from './handlers.js';
import { registerAssetHandlers, ASSET_HANDLER_CHANNELS } from './handlers/assets.js';
import { registerClipHandlers, CLIP_HANDLER_CHANNELS } from './handlers/clips.js';
import { registerExportHandlers, EXPORT_HANDLER_CHANNELS } from './handlers/exports.js';
import { registerProjectHandlers, PROJECT_HANDLER_CHANNELS } from './handlers/projects.js';
import { registerSettingsHandlers, SETTINGS_HANDLER_CHANNELS } from './handlers/settings.js';
import { registerTimelineHandlers, TIMELINE_HANDLER_CHANNELS } from './handlers/timeline.js';

function replaceHandlers(channels: string[]): void {
  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }
}

export function registerIpcHandlers(): void {
  registerLegacyIpcHandlers();

  replaceHandlers([
    ...PROJECT_HANDLER_CHANNELS,
    ...ASSET_HANDLER_CHANNELS,
    ...CLIP_HANDLER_CHANNELS,
    ...TIMELINE_HANDLER_CHANNELS,
    ...EXPORT_HANDLER_CHANNELS,
    ...SETTINGS_HANDLER_CHANNELS,
  ]);

  registerProjectHandlers();
  registerAssetHandlers();
  registerClipHandlers();
  registerTimelineHandlers();
  registerExportHandlers();
  registerSettingsHandlers();
}
