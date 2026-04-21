export const DEFAULT_CONVERSATION_TITLE = "New conversation";

const MAX_FALLBACK_TITLE_LENGTH = 64;

export function deriveConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  if (normalized.length <= MAX_FALLBACK_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_FALLBACK_TITLE_LENGTH - 3)}...`;
}
