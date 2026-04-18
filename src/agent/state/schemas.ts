import { Annotation } from "@langchain/langgraph";
import type { LLMProviderType } from "../providers/index.js";
import type {
  DetailedTranscriptWindow,
  TimelineAction,
  TranscriptDetailRequest,
} from "../../shared/types/agent-ipc.js";

const messagesReducer = (left: any[], right: any[]) => left.concat(right);

export const MainState = Annotation.Root({
  messages: Annotation({
    reducer: messagesReducer,
    default: () => [],
  }),
  projectId: Annotation<string>,
  chapters: Annotation<Array<{ id: string; transcript?: string }>>,
  chapterSummaries: Annotation<Record<string, string>>,
  chapterBeats: Annotation<Record<string, any[]>>,
  exports: Annotation<
    | {
        cuts?: any[];
      }
    | undefined
  >,
  // Visual AI fields (Phase 4)
  selectedProvider: Annotation<LLMProviderType | undefined>,
  currentChapterId: Annotation<string | undefined>,
  proxyPath: Annotation<string | undefined>,
  transcript: Annotation<string | undefined>,
  suggestions: Annotation<any[] | undefined>,
  chapterContext: Annotation<
    | {
        id: string;
        title?: string;
        startTime: number;
        endTime: number;
      }
    | undefined
  >,
  chapterAssetIds: Annotation<number[]>,
  chapterClips: Annotation<
    Array<{
      id: number;
      assetId: number;
      trackIndex: number;
      startTime: number;
      inPoint: number;
      outPoint: number;
      role: string | null;
      description: string | null;
      isEssential: boolean;
    }>
  >,
  selectedClipIds: Annotation<number[]>,
  playheadTime: Annotation<number | undefined>,
  detailedTranscripts: Annotation<DetailedTranscriptWindow[]>,
  timelineActions: Annotation<TimelineAction[] | undefined>,
  transcriptDetailRequests: Annotation<TranscriptDetailRequest[] | undefined>,
  assistantResponse: Annotation<string | undefined>,
  thinkingMarkdown: Annotation<string | undefined>,
  routingProposalContext: Annotation<boolean | undefined>,
  lastProposalContext: Annotation<boolean | undefined>,
  // Track last analyzed message to prevent repeated analysis loops
  lastAnalyzedMessageIndex: Annotation<number | undefined>,
});

export const ChapterState = Annotation.Root({
  chapterId: Annotation<string>,
  transcript: Annotation<string>,
  instructions: Annotation<string>,
  summary: Annotation<string | undefined>,
  beats: Annotation<any[] | undefined>,
});
