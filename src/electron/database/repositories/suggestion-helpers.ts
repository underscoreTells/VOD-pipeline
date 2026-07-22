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
  delete?: boolean;
  split?: {
    segments?: Array<{
      inPoint: number;
      outPoint: number;
      role?: Clip['role'];
      description?: string | null;
      isEssential?: boolean;
    }>;
    splitPoint?: number;
    leftDescription?: string | null;
    rightDescription?: string | null;
  };
}

export interface SuggestionPreviewSnapshot {
  clip: {
    id: number;
    project_id?: number;
    asset_id?: number;
    track_index?: number;
    in_point: number;
    out_point: number;
    role: Clip['role'];
    description: string | null;
    is_essential: boolean;
    created_at?: string;
  };
  createdClipIds?: number[];
}

export interface NormalizedSuggestionClipWindow {
  inPoint: number;
  outPoint: number;
}

export function isUpdateSuggestion(suggestion: Suggestion): boolean {
  return suggestion.action_type === 'update_clip';
}

export function isDeleteSuggestion(suggestion: Suggestion): boolean {
  return suggestion.action_type === 'delete_clip';
}

export function isSplitSuggestion(suggestion: Suggestion): boolean {
  return suggestion.action_type === 'split_clip';
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
      project_id: clip.project_id,
      asset_id: clip.asset_id,
      track_index: clip.track_index,
      in_point: clip.in_point,
      out_point: clip.out_point,
      role: clip.role,
      description: clip.description,
      is_essential: clip.is_essential,
      created_at: clip.created_at,
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
    action_type: row.action_type === 'update_clip' || row.action_type === 'delete_clip' || row.action_type === 'split_clip'
      ? row.action_type
      : 'create_clip',
    target_clip_id: typeof row.target_clip_id === 'number' && Number.isFinite(row.target_clip_id)
      ? row.target_clip_id
      : null,
    action_payload_json: typeof row.action_payload_json === 'string' ? row.action_payload_json : null,
    preview_snapshot_json: typeof row.preview_snapshot_json === 'string' ? row.preview_snapshot_json : null,
    supersedes_suggestion_id: typeof row.supersedes_suggestion_id === 'number' && Number.isFinite(row.supersedes_suggestion_id)
      ? row.supersedes_suggestion_id
      : null,
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
 * Candidate global windows for a suggestion range. Previews were
 * materialized by builds that stored suggestion ranges either chapter-local
 * or as legacy global source times, so the reconciliation must accept both
 * interpretations to recognize an untouched preview.
 */
function computeSuggestionWindowCandidates(
  suggestion: Suggestion,
  chapter: Chapter
): NormalizedSuggestionClipWindow[] {
  const localWindow = normalizeSuggestionClipWindow(suggestion, chapter);

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const legacyLocalIn = clampToRange(suggestion.in_point - chapter.start_time, 0, chapterDuration);
  const legacyLocalOut = clampToRange(
    suggestion.out_point - chapter.start_time,
    legacyLocalIn,
    chapterDuration
  );
  const legacyWindow: NormalizedSuggestionClipWindow = {
    inPoint: chapter.start_time + legacyLocalIn,
    outPoint: chapter.start_time + legacyLocalOut,
  };

  if (
    legacyWindow.inPoint === localWindow.inPoint &&
    legacyWindow.outPoint === localWindow.outPoint
  ) {
    return [localWindow];
  }
  return [localWindow, legacyWindow];
}

/**
 * Computes the clip shapes that `previewSuggestionWithClip` could have
 * created for a `create_clip` suggestion — one per plausible interpretation
 * of the stored range (chapter-local and legacy global source times).
 * `assetId` must already be resolved by the caller (the single chapter video
 * asset or the explicit payload assetId). Windows that collapse to
 * non-positive duration, which `previewSuggestionWithClip` would have
 * rejected rather than persisted, are omitted.
 */
export function computeExpectedCreatedClipCandidates(
  suggestion: Suggestion,
  chapter: Chapter,
  assetId: number
): ExpectedCreateClipFields[] {
  const actionPayload = parseSuggestionActionPayload(suggestion);
  const createPayload = actionPayload?.create;

  const trackIndex =
    typeof createPayload?.trackIndex === 'number' && Number.isFinite(createPayload.trackIndex)
      ? createPayload.trackIndex
      : 0;

  const candidates: ExpectedCreateClipFields[] = [];
  for (const window of computeSuggestionWindowCandidates(suggestion, chapter)) {
    if (window.inPoint >= window.outPoint) {
      continue;
    }
    candidates.push({
      project_id: chapter.project_id,
      asset_id: assetId,
      track_index: trackIndex,
      in_point: window.inPoint,
      out_point: window.outPoint,
      role: createPayload?.role ?? null,
      description: createPayload?.description ?? suggestion.description,
      is_essential: createPayload?.isEssential ?? true,
    });
  }
  return candidates;
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
