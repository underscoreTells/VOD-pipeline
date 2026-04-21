import { describe, expect, it } from "vitest";
import {
  parseGroundedChatResponse,
  parseTimelineEditResponse,
  parseVisualAnalysisResponse,
} from "../../src/agent/output-parsing.js";

describe("visual analysis output parsing", () => {
  it("extracts assistant response, thinking markdown, and suggestions from marker-based output", () => {
    const parsed = parseVisualAnalysisResponse(`ASSISTANT_RESPONSE:
Keep the challenge setup and trim the repeated dead air.

THINKING_MARKDOWN:
## Reasoning

The intro establishes the goal, while the dead air doesn't move the story.

SUGGESTIONS_JSON:
[
  {"in_point": 12.5, "out_point": 34.2, "description": "Challenge setup", "reasoning": "Introduces the arc"},
  {"in_point": 48, "out_point": 60, "description": "Dead air", "reasoning": "No new story movement"}
]`);

    expect(parsed.assistantResponse).toBe("Keep the challenge setup and trim the repeated dead air.");
    expect(parsed.thinkingMarkdown).toBe("## Reasoning\n\nThe intro establishes the goal, while the dead air doesn't move the story.");
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.suggestions[0]).toMatchObject({
      in_point: 12.5,
      out_point: 34.2,
      description: "Challenge setup",
    });
  });

  it("falls back to sanitized legacy content when markers are missing", () => {
    const parsed = parseVisualAnalysisResponse(`Keep the intro.

SUGGESTION: {"in_point": 10, "out_point": 20, "description": "Hook"}`);

    expect(parsed.assistantResponse).toBe("Keep the intro.");
    expect(parsed.thinkingMarkdown).toBe("");
    expect(parsed.suggestions).toEqual([]);
  });

  it("extracts timeline edit response with thinking and JSON arrays", () => {
    const parsed = parseTimelineEditResponse(`ASSISTANT_RESPONSE:
I prepared two timeline proposals.

THINKING_MARKDOWN:
## Reasoning

The first cut improves the hook. The second trims repetition.

TIMELINE_ACTIONS_JSON:
[
  {"type": "create_clip", "inPoint": 12, "outPoint": 24}
]

TRANSCRIPT_DETAIL_REQUESTS_JSON:
[]`);

    expect(parsed.assistantResponse).toBe("I prepared two timeline proposals.");
    expect(parsed.thinkingMarkdown).toBe("## Reasoning\n\nThe first cut improves the hook. The second trims repetition.");
    expect(parsed.timelineActions).toEqual([
      { type: "create_clip", inPoint: 12, outPoint: 24 },
    ]);
    expect(parsed.transcriptDetailRequests).toEqual([]);
  });

  it("extracts grounded chat answer and thinking sections", () => {
    const parsed = parseGroundedChatResponse(`ASSISTANT_RESPONSE:
Tighten the middle and keep the payoff.

THINKING_MARKDOWN:
## Reasoning

The middle sequence repeats the same point twice, but the payoff lands well.`);

    expect(parsed.assistantResponse).toBe("Tighten the middle and keep the payoff.");
    expect(parsed.thinkingMarkdown).toBe("## Reasoning\n\nThe middle sequence repeats the same point twice, but the payoff lands well.");
  });
});
