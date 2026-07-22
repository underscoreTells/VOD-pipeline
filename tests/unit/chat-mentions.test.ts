import { describe, expect, it } from 'vitest';
import { parseChatMentions, serializeChatMentions } from '../../src/shared/utils/chat-mentions.js';

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
});
