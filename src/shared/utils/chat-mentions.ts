import type { ChatEntityMention } from '../types/database.js';

export function parseChatMentions(value: unknown): ChatEntityMention[] {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(candidate)) return [];

  const seen = new Set<string>();
  const mentions: ChatEntityMention[] = [];
  for (const item of candidate) {
    if (!item || typeof item !== 'object') continue;
    const mention = item as Record<string, unknown>;
    const type = mention.type;
    const id = mention.id;
    const label = typeof mention.label === 'string' ? mention.label.trim() : '';
    if ((type !== 'clip' && type !== 'suggestion') || typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || !label) {
      continue;
    }
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ type, id, label: label.slice(0, 160) });
  }
  return mentions;
}

export function serializeChatMentions(mentions: readonly ChatEntityMention[]): string | null {
  return mentions.length > 0 ? JSON.stringify(mentions) : null;
}
