import { Annotation } from "@langchain/langgraph";
import type { LLMProviderType } from "../providers/index.js";

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
});

export const ChapterState = Annotation.Root({
  chapterId: Annotation<string>,
  transcript: Annotation<string>,
  instructions: Annotation<string>,
  summary: Annotation<string | undefined>,
  beats: Annotation<any[] | undefined>,
});
