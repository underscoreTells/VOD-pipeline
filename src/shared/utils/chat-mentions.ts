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
    const start = typeof mention.start === 'number' && Number.isInteger(mention.start) && mention.start >= 0
      ? mention.start
      : undefined;
    const end = typeof mention.end === 'number' && Number.isInteger(mention.end) && start !== undefined && mention.end > start
      ? mention.end
      : undefined;
    const occurrenceId = typeof mention.occurrenceId === 'string' && mention.occurrenceId.trim()
      ? mention.occurrenceId.trim().slice(0, 80)
      : undefined;
    const key = start !== undefined && end !== undefined
      ? `${type}:${id}:${start}:${end}`
      : `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({
      type,
      id,
      label: label.slice(0, 160),
      ...(occurrenceId ? { occurrenceId } : {}),
      ...(start !== undefined && end !== undefined ? { start, end } : {}),
    });
  }
  return mentions;
}

export function formatMessageWithInlineMentions(
  content: string,
  mentions: readonly ChatEntityMention[]
): string {
  const safeContent = typeof content === 'string' ? content : '';
  const escapeReferenceText = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const positioned = mentions
    .filter((mention) => mention.start !== undefined && mention.end !== undefined && mention.end <= safeContent.length)
    .sort((a, b) => a.start! - b.start!);
  const legacy = mentions.filter((mention) => mention.start === undefined || mention.end === undefined);
  let cursor = 0;
  const parts: string[] = [];
  for (const mention of positioned) {
    if (mention.start! < cursor) continue;
    parts.push(safeContent.slice(cursor, mention.start));
    parts.push(`<${mention.type}-ref id="${mention.id}">@${escapeReferenceText(mention.label)}</${mention.type}-ref>`);
    cursor = mention.end!;
  }
  parts.push(safeContent.slice(cursor));
  const legacyPrefix = legacy.map((mention) =>
    `<${mention.type}-ref id="${mention.id}">@${escapeReferenceText(mention.label)}</${mention.type}-ref>`
  ).join(' ');
  return legacyPrefix ? `${legacyPrefix}\n\n${parts.join('')}` : parts.join('');
}

export function serializeChatMentions(mentions: readonly ChatEntityMention[]): string | null {
  return mentions.length > 0 ? JSON.stringify(mentions) : null;
}
