import { describe, expect, it } from "vitest";
import {
  buildAmbiguousClarificationMessage,
  routeTurnIntent,
} from "../../src/agent/conversation/intent-router.js";

describe("conversation intent router", () => {
  it("routes analysis requests to discussion mode", () => {
    const result = routeTurnIntent({
      latestUserMessage: "What is the story arc of this chapter?",
      selectedClipIds: [],
    });

    expect(result.intent).toBe("discussion");
  });

  it("routes explicit trim requests to proposal mode", () => {
    const result = routeTurnIntent({
      latestUserMessage: "What should I trim here?",
      selectedClipIds: [],
    });

    expect(result.intent).toBe("proposal");
  });

  it("treats vague improvement requests as ambiguous without edit context", () => {
    const result = routeTurnIntent({
      latestUserMessage: "Make it tighter.",
      selectedClipIds: [],
    });

    expect(result.intent).toBe("ambiguous");
  });

  it("keeps generic make-it-better requests ambiguous even with a playhead anchor", () => {
    const result = routeTurnIntent({
      latestUserMessage: "Make it tighter.",
      selectedClipIds: [],
      playheadTime: 42,
    });

    expect(result.intent).toBe("ambiguous");
  });

  it("treats context-anchored pronoun edits as proposal requests", () => {
    const result = routeTurnIntent({
      latestUserMessage: "Tighten this.",
      selectedClipIds: [5],
      playheadTime: 42,
    });

    expect(result.intent).toBe("proposal");
  });

  it("returns a user-facing clarification message for ambiguous requests", () => {
    expect(buildAmbiguousClarificationMessage()).toContain("trim ranges");
  });
});
