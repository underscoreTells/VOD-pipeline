export declare const IPC_CHANNELS: {
    readonly PROJECT_CREATE: "project:create";
    readonly PROJECT_GET_ALL: "project:get-all";
    readonly PROJECT_GET: "project:get";
    readonly ASSET_ADD: "asset:add";
    readonly CHAPTER_CREATE: "chapter:create";
    readonly AGENT_CHAT: "agent:chat";
    readonly AGENT_STREAM: "agent:stream";
};
export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
