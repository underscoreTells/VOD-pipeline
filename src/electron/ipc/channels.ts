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
  ASSET_GET_METADATA: 'asset:get-metadata',

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

  // Transcription channels
  TRANSCRIBE_CHAPTER: 'transcribe:chapter',
  TRANSCRIBE_PROGRESS: 'transcribe:progress',

  // Agent channels
  AGENT_CHAT: 'agent:chat',
  AGENT_STREAM: 'agent:stream',
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
} as const;

export type IPCErrorCode = typeof IPC_ERROR_CODES[keyof typeof IPC_ERROR_CODES];

// IPC Response types
export interface IPCSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface IPCErrorResponse {
  success: false;
  error: string;
  code: IPCErrorCode;
  details?: unknown;
}

export type IPCResponse<T = unknown> = IPCSuccessResponse<T> | IPCErrorResponse;
