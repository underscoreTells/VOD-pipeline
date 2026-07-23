interface ComposerSubmitState {
  isEditing: boolean;
  isStreaming: boolean;
  message: string;
}

interface ComposerEnterState {
  canSubmit: boolean;
  key: string;
  shiftKey: boolean;
}

export interface ComposerMentionCandidate {
  type: 'clip' | 'suggestion';
  id: number;
  label: string;
  detail: string;
}

export interface ComposerMentionQuery {
  start: number;
  end: number;
  query: string;
}

export function canSubmitComposerMessage(state: ComposerSubmitState): boolean {
  return Boolean(
    state.message.trim()
    && !state.isStreaming
    && !state.isEditing
  );
}

export function shouldInterceptComposerEnter(state: ComposerEnterState): boolean {
  return state.key === "Enter" && !state.shiftKey && state.canSubmit;
}

export function getComposerMentionQuery(message: string, cursor: number): ComposerMentionQuery | null {
  const beforeCursor = message.slice(0, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) return null;
  const atOffset = match[0].lastIndexOf('@');
  return {
    start: match.index + atOffset,
    end: cursor,
    query: match[1].toLocaleLowerCase(),
  };
}

export function filterComposerMentionCandidates(
  candidates: readonly ComposerMentionCandidate[],
  query: string,
  limit = 8
): ComposerMentionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  return candidates
    .filter((candidate) => !normalized || `${candidate.label} ${candidate.detail}`.toLocaleLowerCase().includes(normalized))
    .slice(0, limit);
}

export function removeComposerMentionQuery(
  message: string,
  mentionQuery: ComposerMentionQuery
): { message: string; cursor: number } {
  const prefix = message.slice(0, mentionQuery.start);
  const suffix = message.slice(mentionQuery.end);
  const separator = prefix && !prefix.endsWith(' ') && suffix && !suffix.startsWith(' ') ? ' ' : '';
  const nextMessage = `${prefix}${separator}${suffix}`;
  return { message: nextMessage, cursor: prefix.length + separator.length };
}

export function insertComposerMention(
  message: string,
  mentionQuery: ComposerMentionQuery,
  mention: Omit<import('../../../shared/types/database.js').ChatEntityMention, 'start' | 'end' | 'occurrenceId'>
): { message: string; cursor: number; mention: import('../../../shared/types/database.js').ChatEntityMention } {
  const token = `@${mention.label}`;
  const prefix = message.slice(0, mentionQuery.start);
  const suffix = message.slice(mentionQuery.end);
  const trailingSpace = suffix.startsWith(' ') || suffix.length === 0 ? '' : ' ';
  const nextMessage = `${prefix}${token}${trailingSpace}${suffix}`;
  return {
    message: nextMessage,
    cursor: prefix.length + token.length + trailingSpace.length,
    mention: {
      ...mention,
      occurrenceId: crypto.randomUUID(),
      start: prefix.length,
      end: prefix.length + token.length,
    },
  };
}

export function updateComposerMentionRanges(
  previous: string,
  next: string,
  mentions: readonly import('../../../shared/types/database.js').ChatEntityMention[]
): import('../../../shared/types/database.js').ChatEntityMention[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  const oldEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  return mentions.flatMap((mention) => {
    if (mention.start === undefined || mention.end === undefined) return [mention];
    if (oldEnd <= mention.start) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    if (prefix >= mention.end) return [mention];
    return [];
  });
}

export function removeComposerMention(
  message: string,
  mentions: readonly import('../../../shared/types/database.js').ChatEntityMention[],
  occurrenceId: string
): { message: string; mentions: import('../../../shared/types/database.js').ChatEntityMention[] } {
  const target = mentions.find((mention) => mention.occurrenceId === occurrenceId);
  if (!target || target.start === undefined || target.end === undefined) {
    return { message, mentions: mentions.filter((mention) => mention.occurrenceId !== occurrenceId) };
  }
  const nextMessage = `${message.slice(0, target.start)}${message.slice(target.end)}`;
  const removedLength = target.end - target.start;
  return {
    message: nextMessage,
    mentions: mentions
      .filter((mention) => mention.occurrenceId !== occurrenceId)
      .map((mention) => mention.start !== undefined && mention.end !== undefined && mention.start >= target.end!
        ? { ...mention, start: mention.start - removedLength, end: mention.end - removedLength }
        : mention),
  };
}
