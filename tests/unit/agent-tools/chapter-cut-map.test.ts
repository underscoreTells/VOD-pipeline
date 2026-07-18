import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { createConversationTools } from "../../../src/agent/conversation/tools/index.js";
import {
  createLoadChapterCutMapTool,
  summarizeChapterCutMap,
  type ChapterCutMapResult,
} from "../../../src/agent/conversation/tools/chapter-cut-map.js";
import type {
  ConversationChapterContext,
  ConversationClipContext,
  ConversationTurnInput,
  ConversationWriter,
} from "../../../src/agent/conversation/types.js";
import { bindAgentToolsForProvider } from "../../../src/agent/tools/binding.js";
import {
  DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE,
  MAX_CHAPTER_CUT_MAP_PAGE_SIZE,
} from "../../../src/agent/conversation/tools/constants.js";

interface WriterEvent {
  type: "status" | "toolState";
  payload: Record<string, unknown>;
}

class RecordingWriter implements ConversationWriter {
  events: WriterEvent[] = [];

  writeStatus(event: {
    status: string;
    message?: string;
    progress?: number;
    nodeName?: string;
    stepIndex?: number;
  }): void {
    this.events.push({ type: "status", payload: event as Record<string, unknown> });
  }

  writeAssistantTextDelta(): void {
    // Not used by this tool.
  }

  writeToolState(event: {
    toolCallId: string;
    toolName: string;
    state: "pending" | "running" | "completed" | "error";
    stepIndex?: number;
    message?: string;
    input?: Record<string, unknown>;
    output?: string;
    error?: string;
  }): void {
    this.events.push({ type: "toolState", payload: event as Record<string, unknown> });
  }
}

const CHAPTER: ConversationChapterContext = {
  id: "12",
  title: "Boss fight",
  startTime: 100,
  endTime: 400,
};

function buildClip(overrides: Partial<ConversationClipContext> & { id: number }): ConversationClipContext {
  return {
    assetId: 2,
    trackIndex: 0,
    inPoint: 100,
    outPoint: 150,
    role: "setup",
    description: null,
    isEssential: false,
    ...overrides,
  };
}

function buildInput(clips: ConversationClipContext[]): ConversationTurnInput {
  return {
    messages: [new HumanMessage("Audit the whole cut.")],
    selectedProvider: "openai",
    selectedClipIds: [],
    playheadTime: 150,
    context: {
      chapter: CHAPTER,
      chapterAssetIds: [2, 5, 7],
      chapterClips: clips,
      transcript: "",
      detailedTranscripts: [],
      videoAnalysisAssets: [],
      suggestionSummary: "- none",
    },
  };
}

const FIXTURE_CLIPS: ConversationClipContext[] = [
  buildClip({ id: 1, assetId: 2, inPoint: 100, outPoint: 150, isEssential: true, role: "setup", description: "Opening setup" }),
  buildClip({ id: 2, assetId: 2, inPoint: 160, outPoint: 200, isEssential: false, role: "escalation", description: "First escalation" }),
  buildClip({ id: 3, assetId: 5, inPoint: 210, outPoint: 260, isEssential: true, role: "twist", description: "Twist moment" }),
  buildClip({ id: 4, assetId: 5, inPoint: 270, outPoint: 320, isEssential: false, role: "payoff", description: "First payoff" }),
  buildClip({ id: 5, assetId: 7, inPoint: 330, outPoint: 400, isEssential: true, role: "payoff", description: "Final payoff" }),
  buildClip({ id: 6, assetId: 2, inPoint: 80, outPoint: 110, isEssential: false, role: "transition", description: "Pre-chapter tail" }),
];

async function runTool(
  input: ConversationTurnInput,
  args: Record<string, unknown>,
  writer?: ConversationWriter
): Promise<ChapterCutMapResult> {
  const tool = createLoadChapterCutMapTool(input, writer);
  const output = await tool.execute(args as never);
  return JSON.parse(output) as ChapterCutMapResult;
}

describe("summarizeChapterCutMap", () => {
  it("computes total, essential, retained duration, and per-asset counts", () => {
    const summary = summarizeChapterCutMap(FIXTURE_CLIPS, CHAPTER);

    expect(summary.totalClips).toBe(6);
    expect(summary.essentialClips).toBe(3);
    // clip 1: 100-150 -> local 0-50 -> 50s
    // clip 2: 160-200 -> local 60-100 -> 40s
    // clip 3: 210-260 -> local 110-160 -> 50s
    // clip 4: 270-320 -> local 170-220 -> 50s
    // clip 5: 330-400 -> local 230-300 -> 70s
    // clip 6: 80-110 -> visible 100-110 -> local 0-10 -> 10s
    const expectedRetained = 50 + 40 + 50 + 50 + 70 + 10;
    expect(summary.retainedDuration).toBeCloseTo(expectedRetained, 5);
    expect(summary.perAsset).toEqual([
      { assetId: 2, clipCount: 3, retainedDuration: 50 + 40 + 10 },
      { assetId: 5, clipCount: 2, retainedDuration: 50 + 50 },
      { assetId: 7, clipCount: 1, retainedDuration: 70 },
    ]);
  });

  it("returns zeroed counts for an empty cut map", () => {
    const summary = summarizeChapterCutMap([], CHAPTER);

    expect(summary).toEqual({
      totalClips: 0,
      essentialClips: 0,
      retainedDuration: 0,
      perAsset: [],
    });
  });

  it("falls back to raw in/out points when no chapter is provided", () => {
    const summary = summarizeChapterCutMap(
      [buildClip({ id: 1, assetId: 2, inPoint: 10, outPoint: 40 })],
      undefined
    );

    expect(summary.totalClips).toBe(1);
    expect(summary.retainedDuration).toBe(30);
    expect(summary.perAsset).toEqual([{ assetId: 2, clipCount: 1, retainedDuration: 30 }]);
  });
});

describe("loadChapterCutMap tool", () => {
  it("returns all clips with default pagination and a filtered summary", async () => {
    const result = await runTool(buildInput(FIXTURE_CLIPS), {});

    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.limit).toBe(DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE);
    expect(result.pagination.totalFiltered).toBe(FIXTURE_CLIPS.length);
    expect(result.pagination.totalAll).toBe(FIXTURE_CLIPS.length);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.page).toHaveLength(FIXTURE_CLIPS.length);
    expect(result.summary.totalClips).toBe(FIXTURE_CLIPS.length);
  });

  it("reports chapter-local visible ranges and durations per clip", async () => {
    const result = await runTool(buildInput(FIXTURE_CLIPS), {});

    const firstClip = result.page[0];
    expect(firstClip).toMatchObject({
      id: 1,
      assetId: 2,
      trackIndex: 0,
      inPoint: 100,
      outPoint: 150,
      visibleStartLocal: 0,
      visibleEndLocal: 50,
      visibleDuration: 50,
      role: "setup",
      description: "Opening setup",
      isEssential: true,
    });

    const preChapterClip = result.page.find((clip) => clip.id === 6);
    expect(preChapterClip).toMatchObject({
      id: 6,
      visibleStartLocal: 0,
      visibleEndLocal: 10,
      visibleDuration: 10,
    });
  });

  it("paginates with offset and limit and sets hasNext correctly", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { offset: 2, limit: 2 }
    );

    expect(result.pagination.offset).toBe(2);
    expect(result.pagination.limit).toBe(2);
    expect(result.pagination.totalFiltered).toBe(FIXTURE_CLIPS.length);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.page.map((clip) => clip.id)).toEqual([3, 4]);
  });

  it("paginates the final page without hasNext", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { offset: 4, limit: 2 }
    );

    expect(result.page.map((clip) => clip.id)).toEqual([5, 6]);
    expect(result.pagination.hasNext).toBe(false);
  });

  it("clamps limit to the configured maximum", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { limit: MAX_CHAPTER_CUT_MAP_PAGE_SIZE + 50 }
    );

    expect(result.pagination.limit).toBe(MAX_CHAPTER_CUT_MAP_PAGE_SIZE);
  });

  it("falls back to the default limit when limit is omitted", async () => {
    const result = await runTool(buildInput(FIXTURE_CLIPS), { offset: 0 });

    expect(result.pagination.limit).toBe(DEFAULT_CHAPTER_CUT_MAP_PAGE_SIZE);
  });

  it("filters by clipIds and returns a filtered summary", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { clipIds: [2, 4, 6] }
    );

    expect(result.page.map((clip) => clip.id)).toEqual([2, 4, 6]);
    expect(result.pagination.totalFiltered).toBe(3);
    expect(result.pagination.totalAll).toBe(FIXTURE_CLIPS.length);
    expect(result.summary.totalClips).toBe(3);
    expect(result.summary.essentialClips).toBe(0);
    const retainedDuration = 40 + 50 + 10;
    expect(result.summary.retainedDuration).toBeCloseTo(retainedDuration, 5);
  });

  it("filters by startLocalTime using visible-range overlap", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { startLocalTime: 100 }
    );

    // Clips with visibleEndLocal >= 100: clip 2 (60-100), clip 3 (110-160), clip 4 (170-220), clip 5 (230-300)
    expect(result.page.map((clip) => clip.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it("filters by endLocalTime using visible-range overlap", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { endLocalTime: 60 }
    );

    // Clips with visibleStartLocal <= 60: clip 1 (0-50), clip 2 (60-100), clip 6 (0-10)
    expect(result.page.map((clip) => clip.id).sort((a, b) => a - b)).toEqual([1, 2, 6]);
  });

  it("filters by a startLocalTime/endLocalTime window", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { startLocalTime: 50, endLocalTime: 170 }
    );

    // Clips overlapping [50, 170] (inclusive bounds): clip 1 (0-50, touches at 50),
    // clip 2 (60-100), clip 3 (110-160), clip 4 (170-220, touches at 170)
    expect(result.page.map((clip) => clip.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("combines clipIds and time filters", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { clipIds: [1, 2, 3, 4], startLocalTime: 100 }
    );

    // clipIds [1,2,3,4] intersect time filter (visibleEnd >= 100): clip 2, 3, 4
    expect(result.page.map((clip) => clip.id).sort((a, b) => a - b)).toEqual([2, 3, 4]);
  });

  it("writes a loading status event through the writer", async () => {
    const writer = new RecordingWriter();
    await runTool(buildInput(FIXTURE_CLIPS), {}, writer);

    const statusEvents = writer.events.filter((event) => event.type === "status");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].payload).toMatchObject({
      status: "loading_chapter_cut_map",
      message: "Loading the current chapter cut map...",
      progress: 50,
      nodeName: "conversation_runner",
    });
  });

  it("returns an empty page when no clips match the filter", async () => {
    const result = await runTool(
      buildInput(FIXTURE_CLIPS),
      { clipIds: [999] }
    );

    expect(result.page).toEqual([]);
    expect(result.pagination.totalFiltered).toBe(0);
    expect(result.pagination.totalAll).toBe(FIXTURE_CLIPS.length);
    expect(result.summary.totalClips).toBe(0);
  });
});

describe("loadChapterCutMap schema validation", () => {
  function getExecutable() {
    const input = buildInput(FIXTURE_CLIPS);
    const tool = createLoadChapterCutMapTool(input, undefined);
    const bound = bindAgentToolsForProvider("openai", [tool]);
    return bound.executableToolMap.get("loadChapterCutMap")!;
  }

  it("rejects a negative offset", async () => {
    await expect(getExecutable().execute({ offset: -1 })).rejects.toThrow();
  });

  it("rejects a zero limit", async () => {
    await expect(getExecutable().execute({ limit: 0 })).rejects.toThrow();
  });

  it("rejects a limit above the maximum", async () => {
    await expect(
      getExecutable().execute({ limit: MAX_CHAPTER_CUT_MAP_PAGE_SIZE + 1 })
    ).rejects.toThrow();
  });

  it("rejects an empty clipIds array", async () => {
    await expect(getExecutable().execute({ clipIds: [] })).rejects.toThrow();
  });

  it("rejects a negative startLocalTime", async () => {
    await expect(getExecutable().execute({ startLocalTime: -0.1 })).rejects.toThrow();
  });

  it("accepts a valid bounded request and returns parsed output", async () => {
    const output = await getExecutable().execute({
      offset: 0,
      limit: 3,
      clipIds: [1, 2, 3],
    });
    const parsed = JSON.parse(output) as ChapterCutMapResult;
    expect(parsed.page).toHaveLength(3);
    expect(parsed.pagination.limit).toBe(3);
  });
});

describe("loadChapterCutMap registration", () => {
  function createAccumulator() {
    return {
      suggestionDrafts: [],
      timelineActions: [],
      transcriptDetailRequests: [],
      loadedDetailedTranscripts: [],
      hasSuccessfulVideoEvidence: false,
      videoEvidenceAssetIds: new Set<number>(),
    };
  }

  it("is registered by createConversationTools", () => {
    const tools = createConversationTools(
      buildInput(FIXTURE_CLIPS),
      undefined,
      createAccumulator() as never,
      {}
    );

    expect(tools.map((tool) => tool.name)).toContain("loadChapterCutMap");
  });

  it.each(["openai", "anthropic", "gemini", "openrouter", "kimi"] as const)(
    "compiles a provider-native tool payload for %s",
    (provider) => {
      const tools = createConversationTools(
        { ...buildInput(FIXTURE_CLIPS), selectedProvider: provider },
        undefined,
        createAccumulator() as never,
        {}
      );
      const bound = bindAgentToolsForProvider(provider, tools);

      expect(bound.executableToolMap.has("loadChapterCutMap")).toBe(true);
      const serialized = JSON.stringify(bound.bindPayload);
      expect(serialized).toContain("loadChapterCutMap");
    }
  );
});
