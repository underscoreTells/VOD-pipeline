export const IPC_CHANNELS = {
  // Project channels
  PROJECT_CREATE: 'project:create',
  PROJECT_GET_ALL: 'project:get-all',
  PROJECT_GET: 'project:get',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',

  // Asset channels
  ASSET_ADD: 'asset:add',
  ASSET_GET: 'asset:get',
  ASSET_GET_BY_PROJECT: 'asset:get-by-project',
  ASSET_DELETE: 'asset:delete',

  // Chapter channels
  CHAPTER_CREATE: 'chapter:create',
  CHAPTER_GET: 'chapter:get',
  CHAPTER_GET_BY_PROJECT: 'chapter:get-by-project',
  CHAPTER_UPDATE: 'chapter:update',
  CHAPTER_DELETE: 'chapter:delete',

  // Chapter-Asset linking channels
  CHAPTER_ADD_ASSET: 'chapter:add-asset',
  CHAPTER_REMOVE_ASSET: 'chapter:remove-asset',
  CHAPTER_GET_ASSETS: 'chapter:get-assets',
  CHAPTER_REVERSE_PROXY_GET: 'chapter:reverse-proxy-get',
  CHAPTER_PROXY_CANCEL: 'chapter:proxy-cancel',

  // Proxy generation channels
  PROXY_PROGRESS: 'proxy:progress',
  GPU_STATUS: 'gpu:status',

  // Transcription channels
  TRANSCRIBE_CHAPTER: 'transcribe:chapter',
  TRANSCRIBE_CANCEL: 'transcribe:cancel',
  TRANSCRIBE_PROGRESS: 'transcribe:progress',
  TRANSCRIPTION_STATUS: 'transcription:status',

  // Agent channels
  AGENT_CHAT: 'agent:chat',
  AGENT_GROUNDING_STATUS: 'agent:grounding-status',
  AGENT_REROLL_MESSAGE: 'agent:reroll-message',
  AGENT_EDIT_MESSAGE: 'agent:edit-message',
  AGENT_BRANCH_MESSAGE: 'agent:branch-message',
  AGENT_STREAM: 'agent:stream',
  AGENT_ERROR: 'agent:error',
  AGENT_APPLY_ACTIONS: 'agent:apply-actions',
  AGENT_CONVERSATION_CREATE: 'agent:conversation-create',
  AGENT_CONVERSATION_LIST: 'agent:conversation-list',
  AGENT_CONVERSATION_MESSAGES: 'agent:conversation-messages',
  AGENT_CONVERSATION_DELETE: 'agent:conversation-delete',

  // Timeline / Clip channels
  CLIP_CREATE: 'clip:create',
  CLIP_GET: 'clip:get',
  CLIP_GET_BY_PROJECT: 'clip:get-by-project',
  CLIP_GET_BY_ASSET: 'clip:get-by-asset',
  CLIP_UPDATE: 'clip:update',
  CLIP_DELETE: 'clip:delete',
  CLIP_BATCH_UPDATE: 'clip:batch-update',
  CLIP_SUGGEST_NAME: 'clip:suggest-name',

  // Timeline state channels
  TIMELINE_STATE_SAVE: 'timeline:state-save',
  TIMELINE_STATE_LOAD: 'timeline:state-load',
  TIMELINE_STATE_UPDATE: 'timeline:state-update',

  // Waveform channels
  WAVEFORM_GENERATE: 'waveform:generate',
  WAVEFORM_GET: 'waveform:get',
  WAVEFORM_GENERATE_TIER: 'waveform:generate-tier',
  WAVEFORM_PROGRESS: 'waveform:progress',

  // Export channels
  EXPORT_GENERATE: 'export:generate',
  EXPORT_GET_FORMATS: 'export:get-formats',

  // Suggestion channels (Phase 4: Visual AI)
  SUGGESTION_CREATE: 'suggestion:create',
  SUGGESTION_GET_BY_CHAPTER: 'suggestion:get-by-chapter',
  SUGGESTION_PREVIEW: 'suggestion:preview',
  SUGGESTION_CANCEL_PREVIEW: 'suggestion:cancel-preview',
  SUGGESTION_APPLY: 'suggestion:apply',
  SUGGESTION_REJECT: 'suggestion:reject',
  SUGGESTION_APPLY_ALL: 'suggestion:apply-all',

  // Settings channels (API key encryption)
  SETTINGS_ENCRYPT: 'settings:encrypt',
  SETTINGS_DECRYPT: 'settings:decrypt',

  // Dialog channels
  DIALOG_SHOW_SAVE_DIALOG: 'dialog:showSaveDialog',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

// Error codes for IPC responses
export const IPC_ERROR_CODES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  INVALID_FORMAT: 'INVALID_FORMAT',
  DATABASE_ERROR: 'DATABASE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FFMPEG_NOT_FOUND: 'FFMPEG_NOT_FOUND',
  PYTHON_NOT_FOUND: 'PYTHON_NOT_FOUND',
  WHISPER_NOT_INSTALLED: 'WHISPER_NOT_INSTALLED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  STALE_DEV_RUNTIME: 'STALE_DEV_RUNTIME',
  TIMEOUT: 'TIMEOUT',
  WAVEFORM_GENERATION_FAILED: 'WAVEFORM_GENERATION_FAILED',
  EXPORT_GENERATION_FAILED: 'EXPORT_GENERATION_FAILED',
  AGENT_PROXY_NOT_READY: 'AGENT_PROXY_NOT_READY',
} as const;

export type IPCErrorCode = typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES];
