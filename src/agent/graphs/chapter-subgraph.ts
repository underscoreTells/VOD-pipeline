import { StateGraph, END, START } from "@langchain/langgraph";
import { createLLM, type LLMConfig } from "../providers/index.js";
import { loadConfig, getProviderLLMConfig } from "../config.js";
import { ChapterState } from "../state/schemas.js";
import { narrativeAnalysisPrompt } from "../prompts/narrative-analysis.js";
import { beatExtractionPrompt } from "../prompts/beat-extraction.js";

async function narrativeAnalyzeNode(
  state: typeof ChapterState.State,
  config: any
) {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig);

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "analyzing_narrative",
    nodeName: "narrative_analyze",
    progress: 0,
  });

  const prompt = await narrativeAnalysisPrompt.format({
    transcript: state.transcript,
  });

  const response = await llm.invoke(prompt);

  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "analyzing_narrative_complete",
    nodeName: "narrative_analyze",
    progress: 100,
  });

  let result: any = {};
  try {
    const content =
      typeof response.content === "string" ? response.content : "";
    result = JSON.parse(content);
  } catch (error) {
    console.error(
      `[NarrativeAnalyze] Chapter ${state.chapterId}: Failed to parse response`,
      error
    );
    result = {
      chapter_title: `Chapter ${state.chapterId}`,
      logline: "Analysis failed",
      beats: [],
      optional_cuts: [],
      cold_open_candidate: false,
    };
  }

  return {
    summary: result.logline || "",
    beats: result.beats || [],
  };
}

async function beatExtractNode(
  state: typeof ChapterState.State,
  config: any
) {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig);

  const llm = createLLM(llmConfig);

  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "extracting_beats",
    nodeName: "beat_extract",
    progress: 0,
  });

  const prompt = await beatExtractionPrompt.format({
    summary: state.summary,
    transcript: state.transcript,
  });

  const response = await llm.invoke(prompt);

  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "extracting_beats_complete",
    nodeName: "beat_extract",
    progress: 100,
  });

  let result: any = {};
  try {
    const content =
      typeof response.content === "string" ? response.content : "";
    result = JSON.parse(content);
  } catch (error) {
    console.error(
      `[BeatExtract] Chapter ${state.chapterId}: Failed to parse response`,
      error
    );
    result = {
      beats: state.beats || [],
    };
  }

  return {
    beats: result.beats || state.beats,
  };
}

async function visualVerifyNode(
  state: typeof ChapterState.State,
  config: any
) {
  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "verifying_visuals",
    nodeName: "visual_verify",
    progress: 0,
  });

  config.writer?.({
    type: "progress",
    chapterId: state.chapterId,
    status: "verifying_visuals_complete",
    nodeName: "visual_verify",
    progress: 100,
  });

  return state;
}

export async function createChapterSubgraph() {
  const workflow = new StateGraph(ChapterState)
    .addNode("narrative_analyze", narrativeAnalyzeNode as any)
    .addNode("beat_extract", beatExtractNode as any)
    .addNode("visual_verify", visualVerifyNode as any)
    .addEdge(START, "narrative_analyze")
    .addEdge("narrative_analyze", "beat_extract")
    .addEdge("beat_extract", "visual_verify")
    .addEdge("visual_verify", END);

  return workflow.compile();
}
