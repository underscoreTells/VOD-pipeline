import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import type {
  Asset,
  Chapter,
  ChatConversation,
  ChatConversationMessage,
  Clip,
  Project,
  Suggestion,
  TimelineState,
} from '../types/database.js';
import type { AgentChatData, AgentStreamEvent, TimelineAction } from '../types/agent-ipc.js';
import type { NamingModelId } from '../llm/naming-models.js';
import type { LLMProviderType } from '../llm/provider-registry.js';
import type { ProjectAsset } from './ipc.js';

export type ProxyEncodingMode = 'cpu' | 'gpu' | 'auto';
export type ProxyQuality = 'high' | 'balanced' | 'fast';
export type ProviderConfigProvider = LLMProviderType;

export interface ProviderConfigPayload {
  defaultProvider?: ProviderConfigProvider;
  providers?: Partial<Record<ProviderConfigProvider, string>>;
}

export interface ProxyOptions {
  encodingMode?: ProxyEncodingMode;
  quality?: ProxyQuality;
}

export interface WaveformGenerateOptions {
  playbackActive?: boolean;
}

export interface CreateProjectResult {
  success: boolean;
  data?: Project;
  error?: string;
}

export interface GetProjectsResult {
  success: boolean;
  data?: Project[];
  error?: string;
}

export interface GetProjectResult {
  success: boolean;
  data?: Project;
  error?: string;
}

export interface DeleteProjectResult {
  success: boolean;
  error?: string;
}

export interface AgentChatParams {
  clientRequestId: string;
  projectId: string;
  conversationId: number;
  message: string;
  provider?: string;
  proxyOptions?: ProxyOptions;
  selectedClipIds?: number[];
  playheadTime?: number;
  threadNamingModel?: NamingModelId;
  agentConfig?: ProviderConfigPayload;
}

export type AgentGroundingStatus =
  | 'idle'
  | 'missing_video_asset'
  | 'generating'
  | 'ready'
  | 'error';

export interface AgentGroundingAssetStatus {
  assetId: number;
  status: Exclude<AgentGroundingStatus, 'idle' | 'missing_video_asset'>;
  error?: string;
}

export interface AgentGroundingStatusData {
  status: AgentGroundingStatus;
  requiredVideoAssetCount: number;
  readyVideoAssetCount: number;
  assets: AgentGroundingAssetStatus[];
  message: string;
}

export interface AgentGroundingStatusParams {
  projectId: string;
  chapterId: string;
  ensureReady?: boolean;
  proxyOptions?: ProxyOptions;
}

export interface AgentGroundingStatusResult {
  success: boolean;
  data?: AgentGroundingStatusData;
  error?: string;
  code?: string;
}

export interface AgentRerollMessageParams {
  clientRequestId: string;
  projectId: string;
  conversationId: number;
  messageId: number;
  provider?: string;
  proxyOptions?: ProxyOptions;
  selectedClipIds?: number[];
  playheadTime?: number;
  agentConfig?: ProviderConfigPayload;
}

export interface AgentEditMessageParams {
  clientRequestId: string;
  projectId: string;
  conversationId: number;
  messageId: number;
  message: string;
  provider?: string;
  proxyOptions?: ProxyOptions;
  selectedClipIds?: number[];
  playheadTime?: number;
  threadNamingModel?: NamingModelId;
  agentConfig?: ProviderConfigPayload;
}

export interface AgentBranchMessageParams {
  projectId: string;
  conversationId: number;
  messageId: number;
}

export interface AgentChatResult {
  success: boolean;
  data?: AgentChatData;
  error?: string;
  code?: string;
}

export interface AgentConversationListResult {
  success: boolean;
  data?: ChatConversation[];
  error?: string;
}

export interface AgentConversationCreateParams {
  projectId: string;
  chapterId: string;
  provider?: string;
  title?: string;
}

export interface AgentConversationCreateResult {
  success: boolean;
  data?: ChatConversation;
  error?: string;
}

export interface AgentConversationListParams {
  projectId: string;
  chapterId: string;
}

export interface AgentConversationMessagesResult {
  success: boolean;
  data?: ChatConversationMessage[];
  error?: string;
}

export interface AgentApplyActionsParams {
  projectId: string;
  chapterId?: string;
  actions: TimelineAction[];
}

export interface AgentApplyActionsResult {
  success: boolean;
  data?: {
    results: Array<{
      index: number;
      action: TimelineAction;
      success: boolean;
      clip?: Clip;
      error?: string;
    }>;
  };
  error?: string;
}

export interface SuggestionListParams {
  chapterId: string;
  conversationId: number;
}

export interface SuggestionListResult {
  success: boolean;
  data?: Suggestion[];
  error?: string;
}

export interface SuggestionMutationResult {
  success: boolean;
  data?: {
    applied?: boolean;
    previewed?: boolean;
    cancelled?: boolean;
    rejected?: boolean;
    removedClipId?: number;
    clip?: Clip;
  };
  error?: string;
}

export interface ApplyAllSuggestionsResult {
  success: boolean;
  data?: {
    appliedCount: number;
    total: number;
    clips: Clip[];
    results: Array<{
      suggestionId: number;
      success: boolean;
      clip?: Clip;
      error?: string;
    }>;
  };
  error?: string;
}

export interface GetAssetsResult {
  success: boolean;
  data?: ProjectAsset[];
  error?: string;
}

export interface GetAssetResult {
  success: boolean;
  data?: ProjectAsset;
  error?: string;
}

export interface ProjectProxyPrewarmResult {
  success: boolean;
  data?: {
    accepted: number;
    skipped: number;
  };
  error?: string;
}

export interface AddAssetResult {
  success: boolean;
  data?: Asset;
  error?: string;
}

export interface GetClipsResult {
  success: boolean;
  data?: Clip[];
  error?: string;
}

export interface CreateClipInput {
  id?: number;
  createdAt?: string;
  projectId: number;
  assetId: number;
  trackIndex: number;
  inPoint: number;
  outPoint: number;
  role?: Clip['role'];
  description?: string;
  isEssential?: boolean;
}

export interface CreateClipResult {
  success: boolean;
  data?: Clip;
  error?: string;
}

export interface UpdateClipResult {
  success: boolean;
  error?: string;
}

export interface DeleteClipResult {
  success: boolean;
  error?: string;
  code?: string;
}

export interface BatchUpdateClipsResult {
  success: boolean;
  data?: {
    updatedCount: number;
  };
  error?: string;
}

export interface SuggestClipNameParams {
  chapterId: number;
  inPoint: number;
  outPoint: number;
  model: NamingModelId;
  providerConfig?: ProviderConfigPayload;
  chapterTitle?: string;
}

export interface SuggestClipNameResult {
  success: boolean;
  data?: {
    name: string | null;
  };
  error?: string;
}

export interface CreateChapterInput {
  projectId: number;
  title: string;
  startTime: number;
  endTime: number;
}

export interface CreateChapterResult {
  success: boolean;
  data?: Chapter;
  error?: string;
}

export interface GetChaptersResult {
  success: boolean;
  data?: Chapter[];
  error?: string;
}

export interface UpdateChapterInput {
  title?: string;
  startTime?: number;
  endTime?: number;
  display_order?: number;
}

export interface UpdateChapterResult {
  success: boolean;
  error?: string;
}

export interface DeleteChapterResult {
  success: boolean;
  error?: string;
}

export interface LinkAssetToChapterOptions {
  prewarmProxy?: boolean;
  proxyOptions?: ProxyOptions;
}

export interface AddAssetToChapterResult {
  success: boolean;
  error?: string;
}

export interface GetChapterAssetsResult {
  success: boolean;
  data?: number[];
  error?: string;
}

export interface GetChapterReverseProxyResult {
  success: boolean;
  data?: {
    status: 'missing' | 'generating' | 'ready' | 'error';
    url?: string;
    quality?: 'quick' | 'full';
    isFinal?: boolean;
    error?: string;
  };
  error?: string;
}

export interface GetChapterReverseProxyOptions {
  ensureReady?: boolean;
  proxyOptions?: ProxyOptions;
  requestMode?: 'background' | 'interactive';
}

export interface TimelineStateResult {
  success: boolean;
  data?: TimelineState | null;
  error?: string;
}

export interface SaveTimelineStateResult {
  success: boolean;
  error?: string;
}

export interface WaveformData {
  peaks: Array<{ min: number; max: number }>;
  sampleRate: number;
  duration: number;
  generatedAt: string;
}

export interface WaveformResult {
  success: boolean;
  data?: WaveformData | null;
  error?: string;
}

export interface WaveformGenerationResult {
  success: boolean;
  data?: {
    assetId: number;
    trackIndex: number;
    tiers: Array<{
      level: 1 | 2 | 3;
      peaks: Array<{ min: number; max: number }>;
      sampleRate: number;
      duration: number;
    }>;
  };
  error?: string;
}

export interface WaveformProgressEvent {
  assetId: number;
  trackIndex?: number;
  progress: { tier: number; percent: number; status: string; trackIndex?: number };
}

export interface ExportResult {
  success: boolean;
  data?: {
    filePath: string;
    format: string;
    clipCount: number;
  };
  error?: string;
}

export interface TranscriptionProgress {
  percent: number;
  status: string;
}

export interface TranscriptionResult {
  success: boolean;
  data?: {
    chapterId: number;
    language: string;
    duration: number;
    segmentCount: number;
    skipped?: boolean;
  };
  error?: string;
}

export interface TranscriptionBackendStatus {
  available: boolean;
  pythonPath?: string;
  pythonSource?: 'managed' | 'bundled' | 'system';
  pythonVersion?: string;
  hasPip: boolean;
  hasFasterWhisper: boolean;
  managedEnvPath?: string;
  error?: string;
}

export interface TranscriptionProgressEvent {
  chapterId: number;
  progress: TranscriptionProgress;
}

export interface ProxyProgressEvent {
  chapterId: number;
  assetId: number;
  percent: number;
}

export interface GPUStatusResult {
  success: boolean;
  data?: GPUStatusPayload;
  error?: string;
}

export interface GPUStatusPayload {
  backend: 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'cpu';
  encoderName: string | null;
  encoder: string | null;
  source: string | null;
  fallbackReason: string | null;
  hwaccels: string[];
  detected: boolean;
}

export interface CancelJobResult {
  success: boolean;
  data?: {
    cancelled: boolean;
  };
  error?: string;
}

export interface SettingsEncryptResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface SettingsDecryptResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface ElectronAPI {
  projects: {
    create: (name: string) => Promise<CreateProjectResult>;
    getAll: () => Promise<GetProjectsResult>;
    get: (id: number) => Promise<GetProjectResult>;
    delete: (id: number) => Promise<DeleteProjectResult>;
    prewarmProxies: (id: number, proxyOptions?: ProxyOptions) => Promise<ProjectProxyPrewarmResult>;
  };
  agent: {
    chat: (params: AgentChatParams) => Promise<AgentChatResult>;
    getGroundingStatus: (params: AgentGroundingStatusParams) => Promise<AgentGroundingStatusResult>;
    rerollMessage: (params: AgentRerollMessageParams) => Promise<AgentChatResult>;
    editMessage: (params: AgentEditMessageParams) => Promise<AgentChatResult>;
    branchMessage: (params: AgentBranchMessageParams) => Promise<AgentConversationCreateResult>;
    createConversation: (params: AgentConversationCreateParams) => Promise<AgentConversationCreateResult>;
    listConversations: (params: AgentConversationListParams) => Promise<AgentConversationListResult>;
    getConversationMessages: (conversationId: number) => Promise<AgentConversationMessagesResult>;
    deleteConversation: (conversationId: number) => Promise<{ success: boolean; error?: string }>;
    applyActions: (params: AgentApplyActionsParams) => Promise<AgentApplyActionsResult>;
    onStream: (callback: (data: AgentStreamEvent) => void) => () => void;
    onError: (callback: (data: { error: string }) => void) => () => void;
    getSuggestions: (params: SuggestionListParams) => Promise<SuggestionListResult>;
    previewSuggestion: (suggestionId: number) => Promise<SuggestionMutationResult>;
    cancelSuggestionPreview: (suggestionId: number) => Promise<SuggestionMutationResult>;
    applySuggestion: (suggestionId: number) => Promise<SuggestionMutationResult>;
    rejectSuggestion: (suggestionId: number) => Promise<SuggestionMutationResult>;
    applyAllSuggestions: (params: SuggestionListParams) => Promise<ApplyAllSuggestionsResult>;
  };
  settings: {
    encrypt: (text: string) => Promise<SettingsEncryptResult>;
    decrypt: (encrypted: string) => Promise<SettingsDecryptResult>;
  };
  assets: {
    get: (id: number) => Promise<GetAssetResult>;
    getByProject: (projectId: number) => Promise<GetAssetsResult>;
    add: (projectId: number, filePath: string, proxyOptions?: ProxyOptions) => Promise<AddAssetResult>;
  };
  chapters: {
    create: (input: CreateChapterInput) => Promise<CreateChapterResult>;
    getByProject: (projectId: number) => Promise<GetChaptersResult>;
    update: (id: number, updates: UpdateChapterInput) => Promise<UpdateChapterResult>;
    delete: (id: number) => Promise<DeleteChapterResult>;
    addAsset: (
      chapterId: number,
      assetId: number,
      options?: LinkAssetToChapterOptions
    ) => Promise<AddAssetToChapterResult>;
    getAssets: (chapterId: number) => Promise<GetChapterAssetsResult>;
    getReverseProxy: (
      chapterId: number,
      assetId: number,
      options?: GetChapterReverseProxyOptions
    ) => Promise<GetChapterReverseProxyResult>;
    cancelProxy: (chapterId: number, assetId: number) => Promise<CancelJobResult>;
  };
  clips: {
    getByProject: (projectId: number) => Promise<GetClipsResult>;
    create: (input: CreateClipInput) => Promise<CreateClipResult>;
    update: (id: number, updates: Partial<Clip>) => Promise<UpdateClipResult>;
    delete: (id: number) => Promise<DeleteClipResult>;
    batchUpdate: (updates: Array<{ id: number } & Partial<Clip>>) => Promise<BatchUpdateClipsResult>;
    suggestName: (input: SuggestClipNameParams) => Promise<SuggestClipNameResult>;
  };
  timeline: {
    loadState: (projectId: number) => Promise<TimelineStateResult>;
    saveState: (state: TimelineState) => Promise<SaveTimelineStateResult>;
  };
  waveforms: {
    get: (assetId: number, trackIndex: number, tierLevel: number) => Promise<WaveformResult>;
    generate: (
      assetId: number,
      trackIndex: number,
      options?: WaveformGenerateOptions
    ) => Promise<WaveformGenerationResult>;
    onProgress: (callback: (data: WaveformProgressEvent) => void) => () => void;
  };
  transcription: {
    getStatus: (options?: { autoSetup?: boolean }) => Promise<{
      success: boolean;
      data?: TranscriptionBackendStatus;
      error?: string;
    }>;
    transcribe: (
      chapterId: number,
      options?: Record<string, unknown>
    ) => Promise<TranscriptionResult>;
    cancel: (chapterId: number) => Promise<CancelJobResult>;
    onProgress: (callback: (data: TranscriptionProgressEvent) => void) => () => void;
  };
  exports: {
    generate: (projectId: number, format: string, filePath: string) => Promise<ExportResult>;
  };
  proxies: {
    onProgress: (callback: (data: ProxyProgressEvent) => void) => () => void;
  };
  gpu: {
    getStatus: () => Promise<GPUStatusResult>;
  };
  dialog: {
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  };
  webUtils: {
    getPathForFile: (file: File) => string;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
