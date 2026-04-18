import { describe, expect, it } from "vitest";
import {
  buildConversationContextKey,
  isConversationContextRequestCurrent,
} from "../../src/renderer/lib/state/agent-session-helpers.js";

describe("agent session context helpers", () => {
  it("builds a stable context key from project and chapter IDs", () => {
    expect(buildConversationContextKey("9", "23")).toBe("9:23");
    expect(buildConversationContextKey("9", null)).toBe("9:none");
    expect(buildConversationContextKey(null, null)).toBe("none:none");
  });

  it("only treats the latest matching request as current", () => {
    const request = {
      token: 3,
      contextKey: buildConversationContextKey("9", "22"),
    };

    expect(
      isConversationContextRequestCurrent(request, {
        token: 3,
        contextKey: buildConversationContextKey("9", "22"),
      })
    ).toBe(true);

    expect(
      isConversationContextRequestCurrent(request, {
        token: 4,
        contextKey: buildConversationContextKey("9", "22"),
      })
    ).toBe(false);

    expect(
      isConversationContextRequestCurrent(request, {
        token: 3,
        contextKey: buildConversationContextKey("9", "23"),
      })
    ).toBe(false);
  });
});
