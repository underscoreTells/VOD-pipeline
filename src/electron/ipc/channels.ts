export const IPC_CHANNELS = {
  PROJECT_CREATE: 'project:create',
  PROJECT_GET_ALL: 'project:get-all',
  PROJECT_GET: 'project:get',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  ASSET_ADD: 'asset:add',
  CHAPTER_CREATE: 'chapter:create',
  AGENT_CHAT: 'agent:chat',
  AGENT_STREAM: 'agent:stream', // Reserved for Phase 3 - agent streaming
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
