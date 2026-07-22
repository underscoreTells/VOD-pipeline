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
