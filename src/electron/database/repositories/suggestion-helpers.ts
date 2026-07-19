import type {
  Chapter,
  Clip,
  Suggestion,
} from '../../../shared/types/database.js';
import { normalizeSuggestionWindowForChapter } from '../../../shared/utils/clip-timing.js';

/**
 * Pure helpers shared between the suggestion repository and the schema-v3
 * preview reconciliation migration. No database I/O lives here so the
 * migration can reuse the exact normalization/parsing logic that produced a
 * preview clip without depending on the async client.
 */

export function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface SuggestionActionPayload {
  create?: {
    assetId?: number;
    trackIndex?: number;
    role?: Clip['role'];
    description?: string | null;
    isEssential?: boolean;
  };
  update?: {
    inPoint?: number;
    outPoint?: number;
    role?: Clip['role'];
    description?: string | null;
    isEssential?: boolean;
  };
}

export interface SuggestionPreviewSnapshot {
  clip: {
    id: number;
    in_point: number;
    out_point: number;
    role: Clip['role'];
    description: string | null;
    is_essential: boolean;
  };
}

export interface NormalizedSuggestionClipWindow {
  inPoint: number;
  outPoint: number;
}

export function isUpdateSuggestion(suggestion: Suggestion): boolean {
  return suggestion.action_type === 'update_clip';
}

export function parseSuggestionActionPayload(
  suggestion: Suggestion
): SuggestionActionPayload | null {
  if (!suggestion.action_payload_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(suggestion.action_payload_json) as SuggestionActionPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseSuggestionPreviewSnapshotJson(
  json: string | null
): SuggestionPreviewSnapshot | null {
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as SuggestionPreviewSnapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.clip || typeof parsed.clip !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function parseSuggestionPreviewSnapshot(
  suggestion: Suggestion
): SuggestionPreviewSnapshot | null {
  return parseSuggestionPreviewSnapshotJson(suggestion.preview_snapshot_json);
}

export function serializeSuggestionPreviewSnapshot(clip: Clip): string {
  return JSON.stringify({
    clip: {
      id: clip.id,
      in_point: clip.in_point,
      out_point: clip.out_point,
      role: clip.role,
      description: clip.description,
      is_essential: clip.is_essential,
    },
  } satisfies SuggestionPreviewSnapshot);
}

export function normalizeSuggestionRecord(row: Suggestion): Suggestion {
  return {
    ...row,
    conversation_id: typeof row.conversation_id === 'number' && Number.isFinite(row.conversation_id)
      ? row.conversation_id
      : null,
    chat_message_id: typeof row.chat_message_id === 'number' && Number.isFinite(row.chat_message_id)
      ? row.chat_message_id
      : null,
    action_type: row.action_type === 'update_clip' ? 'update_clip' : 'create_clip',
    target_clip_id: typeof row.target_clip_id === 'number' && Number.isFinite(row.target_clip_id)
      ? row.target_clip_id
      : null,
    action_payload_json: typeof row.action_payload_json === 'string' ? row.action_payload_json : null,
    preview_snapshot_json: typeof row.preview_snapshot_json === 'string' ? row.preview_snapshot_json : null,
  };
}

export function normalizeSuggestionClipWindow(
  suggestion: Suggestion,
  chapter: Chapter
): NormalizedSuggestionClipWindow {
  const window = normalizeSuggestionWindowForChapter(suggestion, chapter);
  return {
    inPoint: window.start,
    outPoint: window.end,
  };
}

/**
 * Fields the migration compares against the live clip to decide whether a
 * preview is still "exact untouched" or has been manually diverged.
 */
export interface ExpectedClipFields {
  in_point: number;
  out_point: number;
  role: Clip['role'];
  description: string | null;
  is_essential: boolean;
}

export interface ExpectedCreateClipFields extends ExpectedClipFields {
  project_id: number;
  asset_id: number;
  track_index: number;
}

/**
 * Computes the clip shape that `previewSuggestionWithClip` would have created
 * for a `create_clip` suggestion. `assetId` must already be resolved by the
 * caller (the single chapter video asset or the explicit payload assetId).
 * Returns null only if the window collapses to non-positive duration, which
 * `previewSuggestionWithClip` would have rejected rather than persisted.
 */
export function computeExpectedCreatedClipFields(
  suggestion: Suggestion,
  chapter: Chapter,
  assetId: number
): ExpectedCreateClipFields | null {
  const actionPayload = parseSuggestionActionPayload(suggestion);
  const createPayload = actionPayload?.create;
  const window = normalizeSuggestionClipWindow(suggestion, chapter);

  if (window.inPoint >= window.outPoint) {
    return null;
  }

  const trackIndex =
    typeof createPayload?.trackIndex === 'number' && Number.isFinite(createPayload.trackIndex)
      ? createPayload.trackIndex
      : 0;

  return {
    project_id: chapter.project_id,
    asset_id: assetId,
    track_index: trackIndex,
    in_point: window.inPoint,
    out_point: window.outPoint,
    role: createPayload?.role ?? null,
    description: createPayload?.description ?? suggestion.description,
    is_essential: createPayload?.isEssential ?? true,
  };
}

/**
 * Computes the clip shape that `previewSuggestionWithClip` would have produced
 * for an `update_clip` suggestion by applying the update payload to the
 * pre-preview snapshot. Mirrors `applyUpdateSuggestionToClip` so the migration
 * can distinguish an untouched preview from one the user has since edited.
 */
export function computeExpectedUpdatedClipFields(
  suggestion: Suggestion,
  chapter: Chapter,
  snapshot: SuggestionPreviewSnapshot
): ExpectedClipFields | null {
  const actionPayload = parseSuggestionActionPayload(suggestion);
  const updatePayload = actionPayload?.update;
  if (!updatePayload) {
    return null;
  }

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const expected: ExpectedClipFields = {
    in_point: snapshot.clip.in_point,
    out_point: snapshot.clip.out_point,
    role: snapshot.clip.role,
    description: snapshot.clip.description,
    is_essential: snapshot.clip.is_essential,
  };

  const hasInPointUpdate =
    typeof updatePayload.inPoint === 'number' && Number.isFinite(updatePayload.inPoint);
  const hasOutPointUpdate =
    typeof updatePayload.outPoint === 'number' && Number.isFinite(updatePayload.outPoint);

  if (hasInPointUpdate) {
    const localIn = clampToRange(updatePayload.inPoint as number, 0, chapterDuration);
    expected.in_point = chapter.start_time + localIn;
  }

  if (hasOutPointUpdate) {
    const minLocalOut = hasInPointUpdate
      ? expected.in_point - chapter.start_time
      : clampToRange(snapshot.clip.in_point - chapter.start_time, 0, chapterDuration);
    const localOut = clampToRange(updatePayload.outPoint as number, minLocalOut, chapterDuration);
    expected.out_point = chapter.start_time + localOut;
  }

  if (updatePayload.role !== undefined) {
    expected.role = updatePayload.role;
  }
  if (updatePayload.description !== undefined) {
    expected.description = updatePayload.description;
  }
  if (typeof updatePayload.isEssential === 'boolean') {
    expected.is_essential = updatePayload.isEssential;
  }

  return expected;
}

export function clipMatchesExpectedCreate(
  clip: Clip,
  expected: ExpectedCreateClipFields
): boolean {
  return (
    clip.project_id === expected.project_id &&
    clip.asset_id === expected.asset_id &&
    clip.track_index === expected.track_index &&
    clip.in_point === expected.in_point &&
    clip.out_point === expected.out_point &&
    clip.role === expected.role &&
    clip.description === expected.description &&
    clip.is_essential === expected.is_essential
  );
}

export function clipMatchesExpectedUpdate(
  clip: Clip,
  expected: ExpectedClipFields
): boolean {
  return (
    clip.in_point === expected.in_point &&
    clip.out_point === expected.out_point &&
    clip.role === expected.role &&
    clip.description === expected.description &&
    clip.is_essential === expected.is_essential
  );
}
