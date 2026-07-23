import { describe, expect, it } from "vitest";
import { applyNearLimitTokenGuard } from "../../src/electron/ipc/support/token-guard.js";

const OPENAI_EFFECTIVE_LIMIT = 1_044_480; // max(8192, 1_048_576 - 4096)
const OPENAI_SOFT_THRESHOLD = Math.floor(OPENAI_EFFECTIVE_LIMIT * 0.92);

describe("applyNearLimitTokenGuard: below soft limit", () => {
  it("leaves messages unchanged and reports compressed=false", () => {
    // 12 messages (> MIN_RECENT+1) but tiny token footprint, so the SOFT
    // threshold guard is what short-circuits compression (not the length guard).
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `small message ${i + 1}`,
    }));

    const result = applyNearLimitTokenGuard(messages, null, "openai");

    expect(result.compressed).toBe(false);
    expect(result.messages).toEqual(messages);
    expect(result.effectiveContextLimit).toBe(OPENAI_EFFECTIVE_LIMIT);
    expect(result.estimatedTotalTokens).toBeGreaterThan(0);
    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(OPENAI_SOFT_THRESHOLD);
  });

  it("also short-circuits via the minimum-recent-messages length guard", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];

    const result = applyNearLimitTokenGuard(messages, null, "openai");

    expect(result.compressed).toBe(false);
    expect(result.messages).toEqual(messages);
  });

  it("filters out empty and whitespace-only content during normalization", () => {
    const messages = [
      { role: "user", content: "keep" },
      { role: "user", content: "" },
      { role: "assistant", content: "   " },
      { role: "user", content: "also keep" },
    ];

    const result = applyNearLimitTokenGuard(messages, null, "openai");

    expect(result.compressed).toBe(false);
    expect(result.messages).toEqual([
      { role: "user", content: "keep" },
      { role: "user", content: "also keep" },
    ]);
  });
});

describe("applyNearLimitTokenGuard: above soft limit (archive summary)", () => {
  it("collapses older messages into a system archive summary and preserves the most recent messages", () => {
    const recentMessages = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `recent message ${i + 1}`,
    }));
    // One very large archived message whose token footprint pushes the total
    // past the soft threshold. recentCount = max(8, min(24, 11)) = 11, so
    // splitIndex = 1: the huge message is archived, the 11 recent are kept.
    const archivedMessage = { role: "user", content: "x".repeat(4_000_000) };
    const messages = [archivedMessage, ...recentMessages];

    const result = applyNearLimitTokenGuard(messages, null, "openai");

    expect(result.compressed).toBe(true);
    expect(result.effectiveContextLimit).toBe(OPENAI_EFFECTIVE_LIMIT);

    // The first message is the archive summary injected as a system message.
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[0]?.content).toContain("Conversation archive summary");
    expect(result.messages[0]?.content).toContain("1 earlier messages");

    // The huge archived content is collapsed (not passed through verbatim).
    expect(result.messages.every((m) => m.content.length < 1000)).toBe(true);

    // The most recent 11 messages are preserved verbatim at the tail.
    expect(result.messages.slice(1)).toEqual(recentMessages);

    expect(result.estimatedTotalTokens).toBeGreaterThan(0);
    expect(result.estimatedTotalTokens).toBeLessThan(result.effectiveContextLimit);
  });
});

describe("applyNearLimitTokenGuard: per-provider limits come from the registry", () => {
  it("effectiveContextLimit derives from each provider's contextTokenLimit", () => {
    const small = [{ role: "user", content: "hi" }];
    expect(applyNearLimitTokenGuard(small, null, "openai").effectiveContextLimit).toBe(1_044_480);
    expect(applyNearLimitTokenGuard(small, null, "anthropic").effectiveContextLimit).toBe(195904);
    expect(applyNearLimitTokenGuard(small, null, "gemini").effectiveContextLimit).toBe(995904);
    expect(applyNearLimitTokenGuard(small, null, "kimi").effectiveContextLimit).toBe(1_044_480);
  });

  it("falls back to the gemini limit for an unknown provider", () => {
    const small = [{ role: "user", content: "hi" }];
    expect(applyNearLimitTokenGuard(small, null, "not-a-provider").effectiveContextLimit).toBe(995904);
    expect(applyNearLimitTokenGuard(small, null, undefined).effectiveContextLimit).toBe(995904);
    expect(applyNearLimitTokenGuard(small, null, null).effectiveContextLimit).toBe(995904);
  });
});

describe("applyNearLimitTokenGuard: contextPayload contributes to the estimate", () => {
  it("adds the serialized context payload to estimatedTotalTokens", () => {
    const messages = [{ role: "user", content: "hi" }];
    const withoutContext = applyNearLimitTokenGuard(messages, null, "openai");
    const withContext = applyNearLimitTokenGuard(messages, { notes: "abc" }, "openai");

    expect(withContext.estimatedTotalTokens).toBeGreaterThan(withoutContext.estimatedTotalTokens);
    expect(withContext.compressed).toBe(false);
  });

  it("budgets the generated system prompt before accepting an 8K turn", () => {
    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "x".repeat(8_000) }],
      null,
      "openaiCompatible",
      8192
    );

    expect(result.compressed).toBe(true);
    expect(result.estimatedTotalTokens).toBeGreaterThan(3_700);
    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
  });

  it("reserves response space and compacts transcript context for an 8K model", () => {
    const context = {
      transcript: "t".repeat(30_000),
      chapterClips: [{ id: 1, transcriptExcerpt: "c".repeat(1_200) }],
      detailedTranscripts: [],
      referencedEntities: [{ type: "clip", id: 1 }],
    };

    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "Tighten this clip." }],
      context,
      "openaiCompatible",
      8192
    );

    expect(result.compressed).toBe(true);
    expect(result.effectiveContextLimit).toBe(4096);
    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
    expect(result.contextPayload).toMatchObject({
      referencedEntities: context.referencedEntities,
      detailedTranscripts: [],
    });
    expect((result.contextPayload as typeof context).transcript.length).toBeLessThan(context.transcript.length);
  });

  it("fits escaped transcript text against the serialized context budget", () => {
    const context = {
      transcript: "\n\"\\".repeat(12_000),
      chapterClips: [{ id: 1, transcriptExcerpt: "\n\"\\".repeat(500) }],
      detailedTranscripts: [],
      referencedEntities: [{ type: "clip", id: 1 }],
    };

    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "Tighten this clip." }],
      context,
      "openaiCompatible",
      8192
    );

    expect(result.compressed).toBe(true);
    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
    expect(result.contextPayload).toMatchObject({ referencedEntities: context.referencedEntities });
  });

  it("preserves bounded chapter and clip grounding during hard context compaction", () => {
    const context = {
      chapter: { id: "2", title: "Structural edit", startTime: 10, endTime: 110 },
      chapterAssetIds: [11],
      chapterClips: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        assetId: 11,
        trackIndex: 0,
        inPoint: 10 + index,
        outPoint: 11 + index,
        role: null,
        description: "d".repeat(400),
        isEssential: true,
        transcriptExcerpt: "c".repeat(1_200),
      })),
      transcript: "t".repeat(30_000),
      detailedTranscripts: [],
      videoAnalysisAssets: [{ assetId: 11, proxyPath: "/tmp/chapter-proxy.mp4" }],
      referencedEntities: [{ type: "clip", id: 80 }],
    };

    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "Tighten @clip 80." }],
      context,
      "openaiCompatible",
      8192
    );
    const compacted = result.contextPayload as typeof context;

    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
    expect(compacted.chapter).toEqual(context.chapter);
    expect(compacted.chapterAssetIds).toEqual([11]);
    expect(compacted.chapterClips.length).toBeGreaterThan(0);
    expect(compacted.chapterClips.length).toBeLessThan(context.chapterClips.length);
    expect(compacted.chapterClips.some((clip) => clip.id === 80)).toBe(true);
    expect(compacted.chapterClips[0]?.id).toBe(80);
    expect(compacted.videoAnalysisAssets).toEqual(context.videoAnalysisAssets);
  });

  it("prioritizes target clips and details for mentioned suggestions during hard compaction", () => {
    const context = {
      chapter: { id: "2", title: "Structural edit", startTime: 10, endTime: 110 },
      chapterAssetIds: [11],
      chapterClips: Array.from({ length: 80 }, (_, index) => ({
        id: index + 1,
        assetId: 11,
        trackIndex: 0,
        inPoint: 10 + index,
        outPoint: 11 + index,
        description: "d".repeat(400),
        transcriptExcerpt: "c".repeat(1_200),
      })),
      transcript: "t".repeat(30_000),
      detailedTranscripts: [],
      videoAnalysisAssets: [{ assetId: 11, proxyPath: "/tmp/chapter-proxy.mp4" }],
      referencedEntities: [{ type: "suggestion", id: 42, label: "Trim payoff" }],
      selectedClipIds: [],
      suggestionSummary: [
        "- suggestion#1 action=create_clip keep window 1.00-2.00s status=pending desc=Opening",
        "- suggestion#42 action=update_clip update clip #80 79.00-80.00s status=pending desc=Trim payoff",
      ].join("\n"),
    };

    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "Revise @suggestion 42." }],
      context,
      "openaiCompatible",
      8192
    );
    const compacted = result.contextPayload as typeof context;

    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
    expect(compacted.chapterClips.some((clip) => clip.id === 80)).toBe(true);
    expect(compacted.chapterClips[0]?.id).toBe(80);
    expect(compacted.suggestionSummary).toContain("suggestion#42 action=update_clip update clip #80");
    expect(compacted.suggestionSummary).not.toContain("suggestion#1 ");
  });

  it("preserves every mentioned suggestion before truncating the summary", () => {
    const referencedSuggestionIds = Array.from({ length: 8 }, (_, index) => index + 41);
    const referencedSuggestionLines = referencedSuggestionIds.map((id) => (
      `- suggestion#${id} action=update_clip update clip #1 10.00-11.00s status=pending `
      + `desc=${`required-${id}-`.repeat(8)}`
    ));
    const context = {
      chapter: { id: "2", title: "Structural edit", startTime: 10, endTime: 110 },
      chapterAssetIds: [11],
      chapterClips: Array.from({ length: 14 }, (_, index) => ({
        id: index + 1,
        assetId: 11,
        trackIndex: 0,
        inPoint: 10 + index,
        outPoint: 11 + index,
        description: "d".repeat(80),
        transcriptExcerpt: "c".repeat(1_200),
      })),
      transcript: "t".repeat(30_000),
      detailedTranscripts: [],
      referencedEntities: referencedSuggestionIds.map((id) => ({
        type: "suggestion",
        id,
        label: `Suggestion ${id}`,
      })),
      selectedClipIds: [],
      suggestionSummary: [
        ...referencedSuggestionLines,
        ...Array.from({ length: 20 }, (_, index) => (
          `- suggestion#${index + 1} action=create_clip keep window 1.00-2.00s `
          + `status=pending desc=${"optional".repeat(100)}`
        )),
      ].join("\n"),
    };

    const result = applyNearLimitTokenGuard(
      [{ role: "user", content: "Revise all mentioned suggestions." }],
      context,
      "openaiCompatible",
      8192
    );
    const compacted = result.contextPayload as typeof context;

    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
    expect(compacted.suggestionSummary).toBe(referencedSuggestionLines.join("\n"));
  });

  it("drops additional older messages when the retained recent set is still too large", () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: String(index).repeat(7_000),
    }));

    const result = applyNearLimitTokenGuard(messages, null, "openaiCompatible", 8192);

    expect(result.compressed).toBe(true);
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(result.estimatedTotalTokens).toBeLessThanOrEqual(Math.floor(4096 * 0.97));
  });

  it("rejects a latest message that cannot fit by itself", () => {
    expect(() => applyNearLimitTokenGuard(
      [{ role: "user", content: "x".repeat(20_000) }],
      null,
      "openaiCompatible",
      8192
    )).toThrow("latest message exceeds this model's input limit");
  });
});
