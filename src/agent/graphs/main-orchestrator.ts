import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { createLLM, type LLMConfig } from "../providers/index.js";
import { loadConfig, type AgentConfig } from "../config.js";
import { MainState, ChapterState } from "../state/schemas.js";
import { createChapterSubgraph } from "./chapter-subgraph.js";
import { narrativeAnalysisPrompt } from "../prompts/narrative-analysis.js";
import { storyCohesionPrompt } from "../prompts/story-cohesion.js";
import { exportGenerationPrompt } from "../prompts/export-generation.js";

interface CreateMainGraphOptions {
  checkpointer: any;
}

async function chatNode(state: typeof MainState.State, config: any) {
  const agentConfig = await loadConfig();
  const llmConfig = {
    ...agentConfig,
    provider: agentConfig.defaultProvider,
    apiKey: agentConfig.providers[agentConfig.defaultProvider],
  } as LLMConfig;

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    status: "processing_chat",
    nodeName: "chat_node",
    progress: 0,
  });

  const response = await llm.invoke(state.messages);

  config.writer?.({
    type: "progress",
    status: "processing_chat_complete",
    nodeName: "chat_node",
    progress: 100,
  });

  return {
    messages: [response],
  };
}

function shouldContinueChat(state: typeof MainState.State): string {
  const lastMessage = state.messages[state.messages.length - 1];
  const content = typeof lastMessage.content === "string"
    ? lastMessage.content.toLowerCase()
    : "";

  if (
    content.includes("analyze chapters") ||
    content.includes("start analysis") ||
    content.includes("process chapters")
  ) {
    return "dispatch_chapters";
  }

  return "chat_node";
}

async function dispatchChaptersNode(
  state: typeof MainState.State,
  config: any
): Promise<Array<Send>> {
  config.writer?.({
    type: "progress",
    status: "dispatching_chapters",
    nodeName: "dispatch_chapters",
    progress: 0,
  });

  const dispatches: Array<Send> = [];

  for (const chapter of state.chapters) {
    dispatches.push(
      new Send("chapter_agent", {
        chapterId: chapter.id,
        transcript: chapter.transcript || "",
        instructions: `Analyze chapter ${chapter.id} for narrative structure and beats.`,
      })
    );
  }

  config.writer?.({
    type: "progress",
    status: "dispatching_chapters_complete",
    nodeName: "dispatch_chapters",
    progress: 100,
  });

  return dispatches;
}

async function chapterAgentNode(
  state: typeof MainState.State,
  config: any
) {
  config.writer?.({
    type: "progress",
    status: "running_chapter_agents",
    nodeName: "chapter_agent",
    progress: 0,
  });

  config.writer?.({
    type: "progress",
    status: "chapter_agents_complete",
    nodeName: "chapter_agent",
    progress: 100,
  });

  return state;
}

async function storyCohesionNode(
  state: typeof MainState.State,
  config: any
) {
  const agentConfig = await loadConfig();
  const llmConfig = {
    ...agentConfig,
    provider: agentConfig.defaultProvider,
    apiKey: agentConfig.providers[agentConfig.defaultProvider],
  } as LLMConfig;

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    status: "analyzing_story_cohesion",
    nodeName: "story_cohesion",
    progress: 0,
  });

  const chaptersData = Object.entries(state.chapterSummaries).map(
    ([chapterId, summary]) => ({
      chapterId,
      summary,
      beats: state.chapterBeats[chapterId] || [],
    })
  );

  const prompt = await storyCohesionPrompt.format({
    chapters_data: JSON.stringify(chaptersData, null, 2),
  });

  const response = await llm.invoke(prompt);

  config.writer?.({
    type: "progress",
    status: "analyzing_story_cohesion_complete",
    nodeName: "story_cohesion",
    progress: 100,
  });

  let result: any = {};
  try {
    const content =
      typeof response.content === "string" ? response.content : "";
    result = JSON.parse(content);
  } catch (error) {
    console.error("[StoryCohesion] Failed to parse response:", error);
  }

  return {
    exports: {
      cuts: state.chapterBeats,
      storyAnalysis: result,
    },
  };
}

async function generateExportsNode(
  state: typeof MainState.State,
  config: any
) {
  config.writer?.({
    type: "progress",
    status: "generating_exports",
    nodeName: "generate_exports",
    progress: 0,
  });

    const cutList: any = {
      projectId: state.projectId,
      projectName: "VOD Pipeline Project",
      format: "vod-pipeline-cutlist-v1",
      created: new Date().toISOString(),
      cuts: [],
    };

  for (const [chapterId, beats] of Object.entries(state.chapterBeats)) {
    const chapter = state.chapters.find((c) => c.id === chapterId);
    if (!chapter || !beats || beats.length === 0) continue;

    const essentialBeats = beats.filter((b: any) => b.essential !== false);

    if (essentialBeats.length === 0) continue;

    const firstBeat = essentialBeats[0] as any;
    const lastBeat = essentialBeats[essentialBeats.length - 1] as any;

    cutList.cuts.push({
      chapterId,
      chapterTitle: `Chapter ${chapterId}`,
      assetPath: "",
      inTime: firstBeat.start_time,
      outTime: lastBeat.end_time,
      duration: lastBeat.end_time - firstBeat.start_time,
      label: firstBeat.type,
      notes: firstBeat.why_essential,
      beats: essentialBeats,
      optionalSegments: [],
    });
  }

  config.writer?.({
    type: "progress",
    status: "generating_exports_complete",
    nodeName: "generate_exports",
    progress: 100,
  });

  return {
    exports: state.exports
      ? {
          ...state.exports,
          cuts: cutList.cuts,
        }
      : {
          cuts: cutList.cuts,
        },
  };
}

export async function createMainGraph({ checkpointer }: CreateMainGraphOptions) {
  const workflow = new StateGraph(MainState)
    .addNode("chat_node", chatNode as any)
    .addNode("dispatch_chapters", dispatchChaptersNode as any)
    .addNode("chapter_agent", await createChapterSubgraph())
    .addNode("story_cohesion", storyCohesionNode as any)
    .addNode("generate_exports", generateExportsNode as any)
    .addEdge(START, "chat_node")
    .addConditionalEdges("chat_node", shouldContinueChat, {
      chat_node: "chat_node",
      dispatch_chapters: "dispatch_chapters",
    } as any)
    .addEdge("chapter_agent", "story_cohesion")
    .addEdge("story_cohesion", "generate_exports")
    .addEdge("generate_exports", END);

  const compiledGraph = workflow.compile({
    checkpointer,
  });

  return compiledGraph;
}
