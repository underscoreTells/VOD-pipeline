import type { ChatEntityMention } from '../../shared/types/database.js';
import type { ConversationClipContext } from './types.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeClipContextDetails(
  clip: Record<string, unknown>
): Partial<ConversationClipContext> {
  return {
    ...(isFiniteNumber(clip.visibleDuration) ? { visibleDuration: clip.visibleDuration } : {}),
    ...(typeof clip.transcriptExcerpt === 'string'
      ? { transcriptExcerpt: clip.transcriptExcerpt }
      : {}),
    ...(clip.previousClipId === null || isFiniteNumber(clip.previousClipId)
      ? { previousClipId: clip.previousClipId }
      : {}),
    ...(clip.nextClipId === null || isFiniteNumber(clip.nextClipId)
      ? { nextClipId: clip.nextClipId }
      : {}),
    ...(isFiniteNumber(clip.omittedBeforeDuration)
      ? { omittedBeforeDuration: clip.omittedBeforeDuration }
      : {}),
    ...(isFiniteNumber(clip.omittedAfterDuration)
      ? { omittedAfterDuration: clip.omittedAfterDuration }
      : {}),
  };
}

export function normalizeReferencedEntities(value: unknown): ChatEntityMention[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((mention) => {
      if (
        typeof mention !== 'object'
        || mention === null
        || (mention.type !== 'clip' && mention.type !== 'suggestion')
        || !isFiniteNumber(mention.id)
        || typeof mention.label !== 'string'
      ) {
        return null;
      }
      return {
        type: mention.type,
        id: mention.id,
        label: mention.label,
        ...(typeof mention.occurrenceId === 'string' ? { occurrenceId: mention.occurrenceId } : {}),
        ...(isFiniteNumber(mention.start) && isFiniteNumber(mention.end)
          ? { start: mention.start, end: mention.end }
          : {}),
      };
    })
    .filter((mention): mention is ChatEntityMention => mention !== null);
}
