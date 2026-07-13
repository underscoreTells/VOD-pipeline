import { registerAssetHandlers, ASSET_HANDLER_CHANNELS } from './handlers/assets.js';
import { registerAgentHandlers, AGENT_HANDLER_CHANNELS } from './handlers/agent.js';
import { registerChapterHandlers, CHAPTER_HANDLER_CHANNELS } from './handlers/chapters.js';
import { registerClipHandlers, CLIP_HANDLER_CHANNELS } from './handlers/clips.js';
import { registerDialogHandlers, DIALOG_HANDLER_CHANNELS } from './handlers/dialog.js';
import { registerExportHandlers, EXPORT_HANDLER_CHANNELS } from './handlers/exports.js';
import { registerGpuHandlers, GPU_HANDLER_CHANNELS } from './handlers/gpu.js';
import { registerProjectHandlers, PROJECT_HANDLER_CHANNELS } from './handlers/projects.js';
import { registerSettingsHandlers, SETTINGS_HANDLER_CHANNELS } from './handlers/settings.js';
import { registerSuggestionHandlers, SUGGESTION_HANDLER_CHANNELS } from './handlers/suggestions.js';
import { registerTimelineHandlers, TIMELINE_HANDLER_CHANNELS } from './handlers/timeline.js';
import { registerTranscriptionHandlers, TRANSCRIPTION_HANDLER_CHANNELS } from './handlers/transcription.js';
import { registerWaveformHandlers, WAVEFORM_HANDLER_CHANNELS } from './handlers/waveforms.js';

export function registerIpcHandlers(): void {
  registerProjectHandlers();
  registerAssetHandlers();
  registerChapterHandlers();
  registerTranscriptionHandlers();
  registerAgentHandlers();
  registerClipHandlers();
  registerTimelineHandlers();
  registerWaveformHandlers();
  registerExportHandlers();
  registerDialogHandlers();
  registerSuggestionHandlers();
  registerSettingsHandlers();
  registerGpuHandlers();
}

export const REGISTERED_IPC_CHANNELS = [
  ...PROJECT_HANDLER_CHANNELS,
  ...ASSET_HANDLER_CHANNELS,
  ...CHAPTER_HANDLER_CHANNELS,
  ...TRANSCRIPTION_HANDLER_CHANNELS,
  ...AGENT_HANDLER_CHANNELS,
  ...CLIP_HANDLER_CHANNELS,
  ...TIMELINE_HANDLER_CHANNELS,
  ...WAVEFORM_HANDLER_CHANNELS,
  ...EXPORT_HANDLER_CHANNELS,
  ...DIALOG_HANDLER_CHANNELS,
  ...SUGGESTION_HANDLER_CHANNELS,
  ...SETTINGS_HANDLER_CHANNELS,
  ...GPU_HANDLER_CHANNELS,
];
