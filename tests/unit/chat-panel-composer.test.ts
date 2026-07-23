import { describe, expect, it } from "vitest";
import {
  canSubmitComposerMessage,
  filterComposerMentionCandidates,
  getComposerMentionQuery,
  insertComposerMention,
  materializeComposerMentions,
  removeComposerMention,
  removeComposerMentionQuery,
  shouldInterceptComposerEnter,
  updateComposerMentionRanges,
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

  it('inserts a positioned mention and shifts it when text is added before it', () => {
    const query = getComposerMentionQuery('Trim @pay please', 9)!;
    const inserted = insertComposerMention('Trim @pay please', query, {
      type: 'clip',
      id: 7,
      label: 'Payoff',
    });

    expect(inserted.message).toBe('Trim @Payoff please');
    expect(inserted.mention).toMatchObject({ start: 5, end: 12, id: 7 });
    expect(updateComposerMentionRanges(inserted.message, `Now ${inserted.message}`, [inserted.mention]))
      .toEqual([expect.objectContaining({ start: 9, end: 16 })]);
  });

  it('closes an inserted mention query at the end of the message', () => {
    const query = getComposerMentionQuery('Trim @pay', 9)!;
    const inserted = insertComposerMention('Trim @pay', query, {
      type: 'clip',
      id: 7,
      label: 'Payoff',
    });

    expect(inserted.message).toBe('Trim @Payoff ');
    expect(inserted.cursor).toBe(inserted.message.length);
    expect(getComposerMentionQuery(inserted.message, inserted.cursor)).toBeNull();
  });

  it('shifts later mention ranges when inserting a mention before them', () => {
    const message = 'Use @pay before @Setup';
    const query = getComposerMentionQuery(message, 8)!;
    const inserted = insertComposerMention(message, query, {
      type: 'suggestion',
      id: 7,
      label: 'Payoff',
    });
    const mentions = updateComposerMentionRanges(message, inserted.message, [{
      type: 'clip', id: 2, label: 'Setup', occurrenceId: 'setup', start: 16, end: 22,
    }]);

    expect(inserted.message).toBe('Use @Payoff before @Setup');
    expect(mentions).toEqual([
      expect.objectContaining({ occurrenceId: 'setup', start: 19, end: 25 }),
    ]);
  });

  it('drops structured identity when the mention token itself is edited', () => {
    expect(updateComposerMentionRanges('Use @Setup here', 'Use @Set here', [{
      type: 'clip', id: 2, label: 'Setup', occurrenceId: 'one', start: 4, end: 10,
    }])).toEqual([]);
  });

  it('materializes legacy mentions at matching inline tokens', () => {
    const result = materializeComposerMentions('Compare @Setup with @Setup', [
      { type: 'clip', id: 2, label: 'Setup' },
      { type: 'clip', id: 2, label: 'Setup' },
    ]);

    expect(result.message).toBe('Compare @Setup with @Setup');
    expect(result.mentions).toEqual([
      expect.objectContaining({ id: 2, start: 8, end: 14, occurrenceId: expect.any(String) }),
      expect.objectContaining({ id: 2, start: 20, end: 26, occurrenceId: expect.any(String) }),
    ]);
  });

  it('prepends legacy cards that have no token and shifts positioned ranges', () => {
    const result = materializeComposerMentions('Keep @Payoff', [
      { type: 'clip', id: 1, label: 'Setup' },
      { type: 'clip', id: 2, label: 'Payoff', occurrenceId: 'payoff', start: 5, end: 12 },
    ]);

    expect(result.message).toBe('@Setup Keep @Payoff');
    expect(result.mentions).toEqual([
      expect.objectContaining({ id: 1, start: 0, end: 6 }),
      expect.objectContaining({ id: 2, occurrenceId: 'payoff', start: 12, end: 19 }),
    ]);
  });

  it('removes one mention occurrence and shifts later ranges', () => {
    const result = removeComposerMention('Use @Setup then @Payoff', [
      { type: 'clip', id: 1, label: 'Setup', occurrenceId: 'setup', start: 4, end: 10 },
      { type: 'clip', id: 2, label: 'Payoff', occurrenceId: 'payoff', start: 16, end: 23 },
    ], 'setup');

    expect(result.message).toBe('Use then @Payoff');
    expect(result.mentions).toEqual([
      expect.objectContaining({ occurrenceId: 'payoff', start: 9, end: 16 }),
    ]);
  });
});
