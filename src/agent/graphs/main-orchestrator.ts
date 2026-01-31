import { StateGraph, END, START, Send } from "@langchain/langgraph";
import { BaseMessage, AIMessage } from "@langchain/core/messages";
import { createLLM, type LLMConfig, VIDEO_CAPABLE_PROVIDERS } from "../providers/index.js";
import { loadConfig, type AgentConfig, getProviderLLMConfig } from "../config.js";
import { MainState, ChapterState } from "../state/schemas.js";
import { createChapterSubgraph } from "./chapter-subgraph.js";
import { narrativeAnalysisPrompt } from "../prompts/narrative-analysis.js";
import { storyCohesionPrompt } from "../prompts/story-cohesion.js";
import { exportGenerationPrompt } from "../prompts/export-generation.js";
import { createVideoMessage, type VideoProvider } from "../utils/video-messages.js";
import type { LLMProviderType } from "../providers/index.js";

interface CreateMainGraphOptions {
  checkpointer: any;
}

async function chatNode(state: typeof MainState.State, config: any) {
  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, state.selectedProvider);

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

async function visualAnalysisNode(state: typeof MainState.State, config: any) {
  config.writer?.({
    type: "progress",
    status: "analyzing_video",
    nodeName: "visual_analysis",
    progress: 0,
    message: "Preparing video analysis...",
  });

  const agentConfig = await loadConfig();
  const llmConfig = getProviderLLMConfig(agentConfig, state.selectedProvider);
  const llm = createLLM(llmConfig);

  // Get the last user message
  const lastMessage = state.messages[state.messages.length - 1];
  const userQuery = typeof lastMessage.content === "string" 
    ? lastMessage.content 
    : "Analyze this video chapter";

  // Build the analysis prompt
  const analysisPrompt = buildVisualAnalysisPrompt(userQuery, state.transcript);

  config.writer?.({
    type: "progress",
    status: "analyzing_video",
    nodeName: "visual_analysis",
    progress: 50,
    message: "Sending video to AI...",
  });

  // Create multimodal message with video
  const provider = state.selectedProvider as VideoProvider;
  const videoMessage = await createVideoMessage({
    provider,
    videoPath: state.proxyPath!,
    textPrompt: analysisPrompt,
  });

  // Send to LLM
  const response = await llm.invoke([videoMessage]);
  const content = typeof response.content === "string" ? response.content : "";

  config.writer?.({
    type: "progress",
    status: "analyzing_video",
    nodeName: "visual_analysis",
    progress: 100,
    message: "Analysis complete",
  });

  // Parse suggestions from response
  const suggestions = extractSuggestionsFromResponse(content);

  return {
    messages: [new AIMessage(content)],
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

function buildVisualAnalysisPrompt(userQuery: string, transcript?: string): string {
  let prompt = `You are a professional video editor analyzing a video chapter.

User question: ${userQuery}

Watch the video and analyze both visual content and dialogue. Identify:
1. Sections to KEEP (essential content, key moments, visual interest, dialogue)
2. Sections to CUT (dead air, repetitive content, off-topic, boring visuals)

For each suggestion, provide:
- Time range (start → end in seconds)
- Brief description of what's happening
- Reasoning (why keep or cut this section)

Format suggestions as JSON:
SUGGESTION: {"in_point": 120.5, "out_point": 180.0, "description": "Setup scene", "reasoning": "Establishes challenge and builds tension"}

Be concise and actionable. Focus on the most important cuts.`;

  if (transcript) {
    prompt += `\n\nTranscript:\n${transcript}\n\nUse the transcript to understand dialogue timing, but also pay attention to visual content (action, gameplay, reactions, etc.).`;
  }

  return prompt;
}

function extractSuggestionsFromResponse(content: string): any[] {
  const suggestions: any[] = [];
  
  // Look for SUGGESTION: followed by JSON object
  // Use a more robust approach: find "SUGGESTION:" and then parse the JSON that follows
  const suggestionMarker = "SUGGESTION:";
  let index = content.indexOf(suggestionMarker);
  
  while (index !== -1) {
    // Move past the marker
    const jsonStart = index + suggestionMarker.length;
    
    // Find the JSON object by tracking braces
    let braceCount = 0;
    let jsonEnd = jsonStart;
    let inString = false;
    let escaped = false;
    
    for (let i = jsonStart; i < content.length; i++) {
      const char = content[i];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === "\\") {
        escaped = true;
        continue;
      }
      
      if (char === '"' && !escaped) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === "{") {
          braceCount++;
          if (braceCount === 1) {
            jsonEnd = i;
          }
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }
    
    // Extract and parse the JSON
    if (jsonEnd > jsonStart) {
      const jsonStr = content.slice(jsonStart, jsonEnd).trim();
      try {
        const suggestion = JSON.parse(jsonStr);
        if (suggestion.in_point !== undefined && suggestion.out_point !== undefined) {
          suggestions.push(suggestion);
        }
      } catch (e) {
        // Ignore malformed JSON - continue searching
      }
    }
    
    // Look for next suggestion
    index = content.indexOf(suggestionMarker, jsonEnd > jsonStart ? jsonEnd : index + 1);
  }
  
  return suggestions;
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

  // Check if we should do visual analysis
  // Requires: active chapter, video-capable provider, video intent
  if (state.selectedProvider && 
      VIDEO_CAPABLE_PROVIDERS.includes(state.selectedProvider) &&
      state.currentChapterId &&
      state.proxyPath) {
    const videoIntentKeywords = [
      "watch", "video", "visual", "see", "look", "analyze video",
      "what's in the video", "what happens", "show me", "review video"
    ];
    
    if (videoIntentKeywords.some(kw => content.includes(kw))) {
      return "visual_analysis";
    }
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
  const llmConfig = getProviderLLMConfig(agentConfig);

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
    .addNode("visual_analysis", visualAnalysisNode as any)
    .addNode("dispatch_chapters", dispatchChaptersNode as any)
    .addNode("chapter_agent", await createChapterSubgraph())
    .addNode("story_cohesion", storyCohesionNode as any)
    .addNode("generate_exports", generateExportsNode as any)
    .addEdge(START, "chat_node")
    .addConditionalEdges("chat_node", shouldContinueChat, {
      chat_node: "chat_node",
      dispatch_chapters: "dispatch_chapters",
      visual_analysis: "visual_analysis",
    } as any)
    .addEdge("visual_analysis", "chat_node")
    .addEdge("chapter_agent", "story_cohesion")
    .addEdge("story_cohesion", "generate_exports")
    .addEdge("generate_exports", END);

  const compiledGraph = workflow.compile({
    checkpointer,
  });

  return compiledGraph;
}
