import { describe, expect, it } from "vitest";
import {
  canSubmitComposerMessage,
  filterComposerMentionCandidates,
  getComposerMentionQuery,
  removeComposerMentionQuery,
  shouldInterceptComposerEnter,
} from "../../src/renderer/lib/components/chat-panel-composer.js";

describe("chat panel composer helpers", () => {
  it("allows submit only when the composer is actionable", () => {
    expect(canSubmitComposerMessage({
      isEditing: false,
      isStreaming: false,
      message: "Ship it",
    })).toBe(true);

    expect(canSubmitComposerMessage({
      isEditing: false,
      isStreaming: false,
      message: "   ",
    })).toBe(false);

    expect(canSubmitComposerMessage({
      isEditing: true,
      isStreaming: false,
      message: "Ship it",
    })).toBe(false);

    expect(canSubmitComposerMessage({
      isEditing: false,
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

  it('finds, filters, and removes the active mention query', () => {
    const mentionQuery = getComposerMentionQuery('Trim @pay', 9);
    expect(mentionQuery).toEqual({ start: 5, end: 9, query: 'pay' });
    expect(filterComposerMentionCandidates([
      { type: 'clip', id: 1, label: 'Setup', detail: '0-4s' },
      { type: 'suggestion', id: 2, label: 'Payoff', detail: 'pending update' },
    ], mentionQuery!.query)).toEqual([
      { type: 'suggestion', id: 2, label: 'Payoff', detail: 'pending update' },
    ]);
    expect(removeComposerMentionQuery('Trim @pay please', mentionQuery!)).toEqual({
      message: 'Trim  please',
      cursor: 5,
    });
  });
});
