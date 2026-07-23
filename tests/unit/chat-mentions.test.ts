import { describe, expect, it } from 'vitest';
import { formatMessageWithInlineMentions, parseChatMentions, serializeChatMentions } from '../../src/shared/utils/chat-mentions.js';

describe('chat mentions', () => {
  it('parses valid mentions, removes duplicates, and bounds labels', () => {
    expect(parseChatMentions(JSON.stringify([
      { type: 'clip', id: 4, label: 'Payoff' },
      { type: 'clip', id: 4, label: 'Duplicate' },
      { type: 'suggestion', id: 9, label: 'Trim setup' },
      { type: 'clip', id: -1, label: 'Invalid' },
    ]))).toEqual([
      { type: 'clip', id: 4, label: 'Payoff' },
      { type: 'suggestion', id: 9, label: 'Trim setup' },
    ]);
  });

  it('serializes empty mention lists as null', () => {
    expect(serializeChatMentions([])).toBeNull();
    expect(parseChatMentions('not json')).toEqual([]);
  });

  it('preserves repeated positioned occurrences and formats them in sentence order', () => {
    const content = 'Change @Setup this way and @Payoff another way';
    const mentions = parseChatMentions([
      { type: 'clip', id: 4, label: 'Setup', occurrenceId: 'one', start: 7, end: 13 },
      { type: 'clip', id: 4, label: 'Payoff', occurrenceId: 'two', start: 27, end: 34 },
    ]);

    expect(mentions).toHaveLength(2);
    expect(formatMessageWithInlineMentions(content, mentions)).toBe(
      'Change <clip-ref id="4">@Setup</clip-ref> this way and <clip-ref id="4">@Payoff</clip-ref> another way'
    );
  });
});
