import { describe, expect, it } from "vitest";
import {
  appendExecutionTraceEntry,
  countExecutionTraceSteps,
  getExecutionTraceStepIndex,
  parseExecutionTraceJson,
} from "../../src/shared/utils/execution-trace.js";
import type { ExecutionTraceEntry } from "../../src/shared/types/database.js";

describe("execution trace utilities", () => {
  it("counts unique stepIndex values across many trace entries", () => {
    const entries: ExecutionTraceEntry[] = [
      {
        id: "1",
        status: "processing_chat",
        label: "Working on turn step 1...",
        stepIndex: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        status: "tool_completed",
        label: "draftRoughCutProposals completed",
        nodeName: "draftRoughCutProposals",
        stepIndex: 1,
        createdAt: "2026-01-01T00:00:01.000Z",
      },
      {
        id: "3",
        status: "processing_chat",
        label: "Working on turn step 2...",
        stepIndex: 2,
        createdAt: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "4",
        status: "tool_completed",
        label: "finalizeConversationTurn completed",
        nodeName: "finalizeConversationTurn",
        stepIndex: 2,
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];

    expect(countExecutionTraceSteps(entries)).toBe(2);
  });

  it("falls back to legacy step labels when stepIndex is missing", () => {
    const entries: ExecutionTraceEntry[] = [
      {
        id: "legacy-1",
        status: "processing_chat",
        label: "Working on turn step 1...",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "legacy-2",
        status: "processing_chat",
        label: "Working on turn step 2...",
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ];

    expect(getExecutionTraceStepIndex(entries[0]!)).toBe(1);
    expect(countExecutionTraceSteps(entries)).toBe(2);
  });

  it("treats legacy traces without explicit step markers as one step", () => {
    const entries: ExecutionTraceEntry[] = [
      {
        id: "legacy-tool",
        status: "tool_completed",
        label: "draftRoughCutProposals completed",
        nodeName: "draftRoughCutProposals",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    expect(countExecutionTraceSteps(entries)).toBe(1);
  });

  it("does not deduplicate matching labels across different steps", () => {
    const first = appendExecutionTraceEntry([], {
      status: "tool_completed",
      message: "analyzeChapterVideo completed",
      nodeName: "analyzeChapterVideo",
      stepIndex: 1,
    });
    const second = appendExecutionTraceEntry(first, {
      status: "tool_completed",
      message: "analyzeChapterVideo completed",
      nodeName: "analyzeChapterVideo",
      stepIndex: 2,
    });

    expect(second).toHaveLength(2);
  });

  it("parses stepIndex from persisted trace JSON when present", () => {
    const parsed = parseExecutionTraceJson(
      JSON.stringify([
        {
          id: "persisted-1",
          status: "processing_chat",
          label: "Working on turn step 3...",
          stepIndex: 3,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ])
    );

    expect(parsed[0]?.stepIndex).toBe(3);
  });
});
