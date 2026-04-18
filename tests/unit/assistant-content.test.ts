import { describe, expect, it } from "vitest";
import {
  parseStructuredAssistantPreview,
  sanitizeAssistantContent,
  sanitizeThinkingMarkdown,
  stripLegacySuggestionBlocks,
} from "../../src/shared/utils/assistant-content.js";

describe("assistant content sanitization", () => {
  it("removes legacy SUGGESTION blocks while preserving prose", () => {
    const content = `Keep the intro.

SUGGESTION: {"in_point": 10, "out_point": 20, "description": "Hook"}

Then tighten the ending.`;

    expect(stripLegacySuggestionBlocks(content)).toBe("Keep the intro.\nThen tighten the ending.");
  });

  it("extracts assistant response markers and drops structured payloads", () => {
    const content = `ASSISTANT_RESPONSE:
Keep the payoff and trim the reset.

THINKING_MARKDOWN:
## Reasoning

The payoff lands cleanly, but the reset slows momentum.

SUGGESTIONS_JSON:
[{"in_point": 10, "out_point": 20}]`;

    expect(sanitizeAssistantContent(content)).toBe("Keep the payoff and trim the reset.");
  });

  it("extracts and sanitizes thinking markdown separately from payload sections", () => {
    const content = `THINKING_MARKDOWN:
## Reasoning

Keep the payoff, then cut the reset.

SUGGESTIONS_JSON:
[{"in_point": 10, "out_point": 20}]`;

    expect(sanitizeThinkingMarkdown(content)).toBe("## Reasoning\n\nKeep the payoff, then cut the reset.");
  });

  it("parses structured streaming preview into bubble content and thinking content", () => {
    const preview = parseStructuredAssistantPreview(`ASSISTANT_RESPONSE:
Keep the payoff and trim the reset.

THINKING_MARKDOWN:
## Reasoning

The payoff lands and the reset drags.

SUGGESTIONS_JSO`);

    expect(preview.assistantResponse).toBe("Keep the payoff and trim the reset.");
    expect(preview.thinkingMarkdown).toBe("## Reasoning\n\nThe payoff lands and the reset drags.");
  });

  it("hides partial marker fragments from the visible preview", () => {
    const preview = parseStructuredAssistantPreview(`ASSISTANT_RESPONSE:
Keep the intro.

THINKING_MARKD`);

    expect(preview.assistantResponse).toBe("Keep the intro.");
    expect(preview.thinkingMarkdown).toBeNull();
  });
});
