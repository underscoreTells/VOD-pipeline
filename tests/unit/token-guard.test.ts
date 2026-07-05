import { describe, expect, it } from "vitest";
import { applyNearLimitTokenGuard } from "../../src/electron/ipc/support/token-guard.js";

const OPENAI_EFFECTIVE_LIMIT = 123904; // max(8192, 128_000 - 4096)
const OPENAI_SOFT_THRESHOLD = Math.floor(OPENAI_EFFECTIVE_LIMIT * 0.92); // 113991

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
    const archivedMessage = { role: "user", content: "x".repeat(500_000) };
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
    expect(applyNearLimitTokenGuard(small, null, "openai").effectiveContextLimit).toBe(123904);
    expect(applyNearLimitTokenGuard(small, null, "anthropic").effectiveContextLimit).toBe(195904);
    expect(applyNearLimitTokenGuard(small, null, "gemini").effectiveContextLimit).toBe(995904);
    expect(applyNearLimitTokenGuard(small, null, "kimi").effectiveContextLimit).toBe(123904);
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
});
