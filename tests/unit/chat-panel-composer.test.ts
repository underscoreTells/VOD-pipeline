import { describe, expect, it } from "vitest";
import {
  canSubmitComposerMessage,
  shouldInterceptComposerEnter,
} from "../../src/renderer/lib/components/chat-panel-composer.js";

describe("chat panel composer helpers", () => {
  it("allows submit only when the composer is actionable", () => {
    expect(canSubmitComposerMessage({
      isEditing: false,
      isGroundingActionBlocked: false,
      isStreaming: false,
      message: "Ship it",
    })).toBe(true);

    expect(canSubmitComposerMessage({
      isEditing: false,
      isGroundingActionBlocked: false,
      isStreaming: false,
      message: "   ",
    })).toBe(false);

    expect(canSubmitComposerMessage({
      isEditing: false,
      isGroundingActionBlocked: true,
      isStreaming: false,
      message: "Ship it",
    })).toBe(false);

    expect(canSubmitComposerMessage({
      isEditing: true,
      isGroundingActionBlocked: false,
      isStreaming: false,
      message: "Ship it",
    })).toBe(false);

    expect(canSubmitComposerMessage({
      isEditing: false,
      isGroundingActionBlocked: false,
      isStreaming: true,
      message: "Ship it",
    })).toBe(false);
  });

  it("intercepts bare Enter only when submit is allowed", () => {
    expect(shouldInterceptComposerEnter({
      canSubmit: true,
      key: "Enter",
      shiftKey: false,
    })).toBe(true);

    expect(shouldInterceptComposerEnter({
      canSubmit: false,
      key: "Enter",
      shiftKey: false,
    })).toBe(false);
  });

  it("never intercepts Shift+Enter", () => {
    expect(shouldInterceptComposerEnter({
      canSubmit: true,
      key: "Enter",
      shiftKey: true,
    })).toBe(false);
  });
});
