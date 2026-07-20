import type {
  Chapter,
  Clip,
  CreateSuggestionInput,
  Suggestion,
  UpdateClipInput,
  UpdateSuggestionInput,
} from '../../../shared/types/database.js';
import { getDatabase, withTransaction } from '../client.js';
import { getAsset } from './assets.js';
import { getAssetsForChapter, getChapter } from './chapters.js';
import {
  createClip,
  deleteClip,
  getClip,
  updateClip,
} from './clips.js';
import {
  clampToRange,
  isUpdateSuggestion,
  normalizeSuggestionClipWindow,
  normalizeSuggestionRecord,
  parseSuggestionActionPayload,
  parseSuggestionPreviewSnapshot,
  serializeSuggestionPreviewSnapshot,
} from './suggestion-helpers.js';

export interface ApplySuggestionResult {
  success: boolean;
  clip?: Clip;
  error?: string;
  /** True when the failure itself marked the suggestion as rejected. */
  autoRejected?: boolean;
}

export interface CancelSuggestionPreviewResult {
  success: boolean;
  removedClipId?: number;
  clip?: Clip;
  error?: string;
}

/**
 * Thrown inside a suggestion transaction to roll back all writes while
 * still returning a structured failure result to the caller.
 */
class SuggestionRollback extends Error {
  constructor(public readonly result: ApplySuggestionResult) {
    super(result.error ?? 'Suggestion operation failed');
    this.name = 'SuggestionRollback';
  }
}

async function applyUpdateSuggestionToClip(
  suggestion: Suggestion,
  chapter: Chapter,
  targetClip: Clip
): Promise<ApplySuggestionResult> {
  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  if (!chapterAssetIds.includes(targetClip.asset_id)) {
    return {
      success: false,
      error: `Target clip ${targetClip.id} is not linked to chapter ${chapter.id}`,
    };
  }

  const actionPayload = parseSuggestionActionPayload(suggestion);
  const updatePayload = actionPayload?.update;
  if (!updatePayload) {
    return { success: false, error: 'Missing update payload for update suggestion' };
  }

  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
  const updates: UpdateClipInput = {};

  if (typeof updatePayload.inPoint === 'number' && Number.isFinite(updatePayload.inPoint)) {
    const localIn = clampToRange(updatePayload.inPoint, 0, chapterDuration);
    updates.in_point = chapter.start_time + localIn;
  }
  if (typeof updatePayload.outPoint === 'number' && Number.isFinite(updatePayload.outPoint)) {
    const minLocalOut = updates.in_point !== undefined
      ? updates.in_point - chapter.start_time
      : clampToRange(targetClip.in_point - chapter.start_time, 0, chapterDuration);
    const localOut = clampToRange(updatePayload.outPoint, minLocalOut, chapterDuration);
    updates.out_point = chapter.start_time + localOut;
  }
  if (updatePayload.role !== undefined) {
    updates.role = updatePayload.role;
  }
  if (updatePayload.description !== undefined) {
    updates.description = updatePayload.description;
  }
  if (typeof updatePayload.isEssential === 'boolean') {
    updates.is_essential = updatePayload.isEssential;
  }

  if (Object.keys(updates).length === 0) {
    return { success: true, clip: targetClip };
  }

  const applied = await updateClip(targetClip.id, updates);
  if (!applied) {
    return { success: false, error: `Failed to update clip ${targetClip.id}` };
  }

  const refreshed = await getClip(targetClip.id);
  if (!refreshed) {
    return { success: false, error: `Updated clip ${targetClip.id} could not be loaded` };
  }

  return { success: true, clip: refreshed };
}

async function restoreClipFromSuggestionSnapshot(
  suggestion: Suggestion
): Promise<ApplySuggestionResult> {
  const snapshot = parseSuggestionPreviewSnapshot(suggestion);
  const targetClipId = suggestion.target_clip_id ?? suggestion.clip_id;

  if (!snapshot || !targetClipId) {
    return { success: true };
  }

  const targetClip = await getClip(targetClipId);
  if (!targetClip) {
    return { success: true };
  }

  const restored = await updateClip(targetClip.id, {
    in_point: snapshot.clip.in_point,
    out_point: snapshot.clip.out_point,
    role: snapshot.clip.role,
    description: snapshot.clip.description,
    is_essential: snapshot.clip.is_essential,
  });

  if (!restored) {
    return {
      success: false,
      error: `Failed to restore clip ${targetClip.id} from preview snapshot`,
    };
  }

  const refreshed = await getClip(targetClip.id);
  return { success: true, clip: refreshed ?? undefined };
}

async function cleanupPendingSuggestionArtifacts(
  suggestion: Suggestion
): Promise<ApplySuggestionResult> {
  if (suggestion.status !== 'pending') {
    return { success: true };
  }

  if (isUpdateSuggestion(suggestion)) {
    return await restoreClipFromSuggestionSnapshot(suggestion);
  }

  if (suggestion.clip_id) {
    await deleteClip(suggestion.clip_id);
  }

  return { success: true };
}

async function createSuggestionTimelineClip(
  suggestion: Suggestion,
  chapter: Chapter
): Promise<ApplySuggestionResult> {
  const database = await getDatabase();
  const actionPayload = parseSuggestionActionPayload(suggestion);
  const createPayload = actionPayload?.create;

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  if (chapterAssetIds.length === 0) {
    return { success: false, error: 'No assets found for this chapter' };
  }

  const chapterAssets = await Promise.all(chapterAssetIds.map(async (assetId) => await getAsset(assetId)));
  const chapterVideoAssets = chapterAssets.filter(
    (asset): asset is NonNullable<typeof asset> => asset !== null && asset.file_type === 'video'
  );

  if (chapterVideoAssets.length === 0) {
    return { success: false, error: 'No video assets found for this chapter' };
  }

  let assetId: number | undefined;
  if (typeof createPayload?.assetId === 'number') {
    const selectedAsset = chapterVideoAssets.find((asset) => asset.id === createPayload.assetId);
    if (!selectedAsset) {
      return {
        success: false,
        error: `Asset ${createPayload.assetId} is not a linked video asset for chapter ${chapter.id}`,
      };
    }
    assetId = selectedAsset.id;
  } else if (chapterVideoAssets.length === 1) {
    assetId = chapterVideoAssets[0]?.id;
  } else {
    return {
      success: false,
      error: 'assetId is required when multiple chapter video assets are available',
    };
  }

  const asset = assetId ? await getAsset(assetId) : null;
  if (!asset) {
    return { success: false, error: 'Asset not found' };
  }

  const normalizedWindow = normalizeSuggestionClipWindow(suggestion, chapter);
  const inPoint = normalizedWindow.inPoint;
  const outPoint = normalizedWindow.outPoint;
  const trackIndex =
    typeof createPayload?.trackIndex === 'number' && Number.isFinite(createPayload.trackIndex)
      ? createPayload.trackIndex
      : 0;

  if (inPoint >= outPoint) {
    database.prepare(
      "UPDATE suggestions SET status = 'rejected', clip_id = NULL, applied_at = NULL WHERE id = ?"
    ).run(suggestion.id);

    return {
      success: false,
      error: `Suggestion would have non-positive duration after collision detection (in_point: ${inPoint}, out_point: ${outPoint}). Marked as rejected.`,
      autoRejected: true,
    };
  }

  const clip = await createClip({
    project_id: chapter.project_id,
    asset_id: assetId,
    track_index: trackIndex,
    in_point: inPoint,
    out_point: outPoint,
    role: createPayload?.role ?? null,
    description: createPayload?.description ?? suggestion.description,
    is_essential: createPayload?.isEssential ?? true,
  });

  return { success: true, clip };
}

export async function createSuggestion(
  suggestion: CreateSuggestionInput
): Promise<Suggestion> {
  const database = await getDatabase();
  const normalizedActionType = suggestion.action_type === 'update_clip' ? 'update_clip' : 'create_clip';
  const normalizedTargetClipId =
    normalizedActionType === 'update_clip' &&
    typeof suggestion.target_clip_id === 'number' &&
    Number.isFinite(suggestion.target_clip_id)
      ? suggestion.target_clip_id
      : null;
  const normalizedActionPayload =
    typeof suggestion.action_payload_json === 'string' ? suggestion.action_payload_json : null;
  const normalizedPreviewSnapshot =
    typeof suggestion.preview_snapshot_json === 'string' ? suggestion.preview_snapshot_json : null;

  const result = database.prepare(
    `INSERT INTO suggestions (
      chapter_id,
      conversation_id,
      chat_message_id,
      in_point,
      out_point,
      description,
      reasoning,
      provider,
      action_type,
      target_clip_id,
      action_payload_json,
      preview_snapshot_json,
      status,
      display_order,
      clip_id,
      range_space
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chapter_local')`
  ).run(
    suggestion.chapter_id,
    suggestion.conversation_id ?? null,
    suggestion.chat_message_id ?? null,
    suggestion.in_point,
    suggestion.out_point,
    suggestion.description,
    suggestion.reasoning,
    suggestion.provider,
    normalizedActionType,
    normalizedTargetClipId,
    normalizedActionPayload,
    normalizedPreviewSnapshot,
    suggestion.status,
    suggestion.display_order,
    suggestion.clip_id ?? null
  );

  return {
    id: result.lastInsertRowid as number,
    ...suggestion,
    conversation_id: suggestion.conversation_id ?? null,
    chat_message_id: suggestion.chat_message_id ?? null,
    action_type: normalizedActionType,
    target_clip_id: normalizedTargetClipId,
    action_payload_json: normalizedActionPayload,
    preview_snapshot_json: normalizedPreviewSnapshot,
    created_at: new Date().toISOString(),
    applied_at: null,
    clip_id: suggestion.clip_id ?? null,
  };
}

export async function getSuggestion(id: number): Promise<Suggestion | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE id = ?`
  ).get(id) as Suggestion | undefined;

  return result ? normalizeSuggestionRecord(result) : null;
}

export async function getSuggestionsByChapter(
  chapterId: number,
  status?: Suggestion['status']
): Promise<Suggestion[]> {
  const database = await getDatabase();
  let query = `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
                      action_type, target_clip_id, action_payload_json, preview_snapshot_json,
                      status, display_order, created_at, applied_at, clip_id
               FROM suggestions
               WHERE chapter_id = ?`;
  const params: unknown[] = [chapterId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY display_order ASC, created_at DESC';
  const results = database.prepare(query).all(...params) as Suggestion[];
  return results.map(normalizeSuggestionRecord);
}

export async function getSuggestionsByConversation(
  conversationId: number,
  chapterId?: number,
  status?: Suggestion['status']
): Promise<Suggestion[]> {
  const database = await getDatabase();
  let query = `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
                      action_type, target_clip_id, action_payload_json, preview_snapshot_json,
                      status, display_order, created_at, applied_at, clip_id
               FROM suggestions
               WHERE conversation_id = ?`;
  const params: unknown[] = [conversationId];

  if (typeof chapterId === 'number' && Number.isFinite(chapterId)) {
    query += ' AND chapter_id = ?';
    params.push(chapterId);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY display_order ASC, created_at DESC';
  const results = database.prepare(query).all(...params) as Suggestion[];
  return results.map(normalizeSuggestionRecord);
}

export async function previewSuggestionWithClip(id: number): Promise<ApplySuggestionResult> {
  try {
    return await withTransaction(() => previewSuggestionWithClipTx(id));
  } catch (error) {
    if (error instanceof SuggestionRollback) {
      return error.result;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[previewSuggestionWithClip] Error previewing suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

async function previewSuggestionWithClipTx(id: number): Promise<ApplySuggestionResult> {
  const database = await getDatabase();

  const suggestion = await getSuggestion(id);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }
  if (suggestion.status !== 'pending') {
    return { success: false, error: 'Suggestion is not pending' };
  }

  if (isUpdateSuggestion(suggestion)) {
    const chapter = await getChapter(suggestion.chapter_id);
    if (!chapter) {
      return { success: false, error: 'Chapter not found for this suggestion' };
    }

    const targetClipId = suggestion.target_clip_id;
    if (!targetClipId) {
      return { success: false, error: 'Update suggestion has no target clip' };
    }

    const targetClip = await getClip(targetClipId);
    if (!targetClip) {
      return { success: false, error: `Target clip ${targetClipId} not found` };
    }

    if (suggestion.preview_snapshot_json) {
      return { success: true, clip: targetClip };
    }

    const snapshotJson = serializeSuggestionPreviewSnapshot(targetClip);
    const applyResult = await applyUpdateSuggestionToClip(suggestion, chapter, targetClip);
    if (!applyResult.success || !applyResult.clip) {
      return applyResult;
    }

    const updateResult = database.prepare(
      'UPDATE suggestions SET clip_id = ?, preview_snapshot_json = ?, applied_at = NULL WHERE id = ?'
    ).run(targetClip.id, snapshotJson, id);

    if (updateResult.changes === 0) {
      // Roll back the clip update applied above.
      throw new SuggestionRollback({
        success: false,
        error: 'Failed to save update suggestion preview state',
      });
    }

    return applyResult;
  }

  if (suggestion.clip_id) {
    const existingClip = await getClip(suggestion.clip_id);
    if (existingClip) {
      return { success: true, clip: existingClip };
    }

    database.prepare('UPDATE suggestions SET clip_id = NULL WHERE id = ?').run(id);
  }

  const chapter = await getChapter(suggestion.chapter_id);
  if (!chapter) {
    return { success: false, error: 'Chapter not found for this suggestion' };
  }

  const createResult = await createSuggestionTimelineClip(suggestion, chapter);
  if (!createResult.success || !createResult.clip) {
    return createResult;
  }

  const updateResult = database.prepare(
    'UPDATE suggestions SET clip_id = ?, applied_at = NULL WHERE id = ?'
  ).run(createResult.clip.id, id);

  if (updateResult.changes === 0) {
    // Roll back the preview clip created above.
    throw new SuggestionRollback({
      success: false,
      error: 'Failed to save suggestion preview clip',
    });
  }

  return createResult;
}

export async function cancelSuggestionPreview(
  id: number
): Promise<CancelSuggestionPreviewResult> {
  try {
    return await withTransaction(() => cancelSuggestionPreviewTx(id));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[cancelSuggestionPreview] Error cancelling preview for suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

async function cancelSuggestionPreviewTx(
  id: number
): Promise<CancelSuggestionPreviewResult> {
  const database = await getDatabase();

  const suggestion = await getSuggestion(id);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }
  if (suggestion.status !== 'pending') {
    return { success: false, error: 'Suggestion is not pending' };
  }

  if (isUpdateSuggestion(suggestion)) {
    const restoreResult = await restoreClipFromSuggestionSnapshot(suggestion);
    if (!restoreResult.success) {
      return {
        success: false,
        error: restoreResult.error || 'Failed to restore update preview state',
      };
    }

    database.prepare(
      'UPDATE suggestions SET clip_id = NULL, preview_snapshot_json = NULL, applied_at = NULL WHERE id = ?'
    ).run(id);

    return {
      success: true,
      removedClipId: undefined,
      clip: restoreResult.clip,
    };
  }

  const previewClipId = suggestion.clip_id ?? undefined;
  if (previewClipId) {
    await deleteClip(previewClipId);
  }

  database.prepare(
    'UPDATE suggestions SET clip_id = NULL, applied_at = NULL WHERE id = ?'
  ).run(id);

  return {
    success: true,
    removedClipId: previewClipId,
    clip: undefined,
  };
}

export async function applySuggestionWithClip(id: number): Promise<ApplySuggestionResult> {
  try {
    return await withTransaction(() => applySuggestionWithClipTx(id));
  } catch (error) {
    if (error instanceof SuggestionRollback) {
      return error.result;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[applySuggestionWithClip] Error applying suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

async function applySuggestionWithClipTx(id: number): Promise<ApplySuggestionResult> {
  const database = await getDatabase();

  const suggestion = await getSuggestion(id);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }
  if (suggestion.status === 'applied') {
    return { success: false, error: 'Suggestion has already been applied' };
  }
  if (suggestion.status !== 'pending') {
    return { success: false, error: 'Suggestion is not pending' };
  }

  const chapter = await getChapter(suggestion.chapter_id);
  if (!chapter) {
    return { success: false, error: 'Chapter not found for this suggestion' };
  }

  if (isUpdateSuggestion(suggestion)) {
    const targetClipId = suggestion.target_clip_id ?? suggestion.clip_id;
    if (!targetClipId) {
      return { success: false, error: 'Update suggestion has no target clip' };
    }

    const targetClip = await getClip(targetClipId);
    if (!targetClip) {
      return { success: false, error: `Target clip ${targetClipId} not found` };
    }

    let updatedClip = targetClip;
    if (!suggestion.preview_snapshot_json) {
      const applyResult = await applyUpdateSuggestionToClip(suggestion, chapter, targetClip);
      if (!applyResult.success || !applyResult.clip) {
        return applyResult;
      }
      updatedClip = applyResult.clip;
    }

    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'applied', applied_at = ?, clip_id = ?, preview_snapshot_json = NULL WHERE id = ?"
    ).run(new Date().toISOString(), updatedClip.id, id);

    if (updateResult.changes === 0) {
      // Roll back the clip update applied above.
      throw new SuggestionRollback({
        success: false,
        error: 'Failed to update suggestion status',
      });
    }

    return { success: true, clip: updatedClip };
  }

  let clip: Clip | undefined;
  if (suggestion.clip_id) {
    const existingPreviewClip = await getClip(suggestion.clip_id);
    if (existingPreviewClip) {
      clip = existingPreviewClip;
    } else {
      database.prepare('UPDATE suggestions SET clip_id = NULL WHERE id = ?').run(id);
    }
  }

  if (!clip) {
    const createResult = await createSuggestionTimelineClip(suggestion, chapter);
    if (!createResult.success || !createResult.clip) {
      return createResult;
    }
    clip = createResult.clip;
  }

  const updateResult = database.prepare(
    "UPDATE suggestions SET status = 'applied', applied_at = ?, clip_id = ?, preview_snapshot_json = NULL WHERE id = ?"
  ).run(new Date().toISOString(), clip.id, id);

  if (updateResult.changes === 0) {
    // Roll back the clip created above.
    throw new SuggestionRollback({
      success: false,
      error: 'Failed to update suggestion status',
    });
  }

  return { success: true, clip };
}

export async function rejectSuggestion(id: number): Promise<boolean> {
  try {
    return await withTransaction(() => rejectSuggestionTx(id));
  } catch (error) {
    console.error(`[rejectSuggestion] Error rejecting suggestion ${id}:`, error);
    return false;
  }
}

async function rejectSuggestionTx(id: number): Promise<boolean> {
  const database = await getDatabase();
  const suggestion = await getSuggestion(id);
  if (!suggestion) {
    return false;
  }

  const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
  if (!cleanupResult.success) {
    return false;
  }

  const result = database.prepare(
    "UPDATE suggestions SET status = 'rejected', applied_at = NULL, clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?"
  ).run(id);

  return result.changes > 0;
}

export async function updateSuggestion(
  id: number,
  updates: UpdateSuggestionInput
): Promise<boolean> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'applied') {
      fields.push('applied_at = ?');
      values.push(new Date().toISOString());
    } else {
      fields.push('applied_at = NULL');
    }
  }
  if (updates.display_order !== undefined) {
    fields.push('display_order = ?');
    values.push(updates.display_order);
  }

  if (fields.length === 0) {
    return true;
  }

  values.push(id);
  const result = database.prepare(
    `UPDATE suggestions SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteSuggestion(id: number): Promise<boolean> {
  const database = await getDatabase();
  const suggestion = await getSuggestion(id);
  if (suggestion) {
    const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
    if (!cleanupResult.success) {
      return false;
    }
  }

  const result = database.prepare('DELETE FROM suggestions WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function deleteSuggestionsByChapter(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const suggestions = await getSuggestionsByChapter(chapterId);
  for (const suggestion of suggestions) {
    const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
    if (!cleanupResult.success) {
      throw new Error(cleanupResult.error || `Failed cleaning suggestion ${suggestion.id}`);
    }
  }

  const result = database.prepare('DELETE FROM suggestions WHERE chapter_id = ?').run(chapterId);
  return result.changes;
}

export async function clearPendingSuggestions(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const pendingSuggestions = await getSuggestionsByChapter(chapterId, 'pending');
  for (const suggestion of pendingSuggestions) {
    const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
    if (!cleanupResult.success) {
      throw new Error(cleanupResult.error || `Failed cleaning suggestion ${suggestion.id}`);
    }
  }

  const result = database.prepare(
    "DELETE FROM suggestions WHERE chapter_id = ? AND status = 'pending'"
  ).run(chapterId);
  return result.changes;
}

// ============================================================================
// Transactional batch operations
//
// Each batch runs every step inside a single transaction (BEGIN IMMEDIATE).
// A logical failure on any item aborts the whole batch and rolls back every
// preceding write, so a batch result is either fully committed or fully
// rolled back. The caller-supplied `beforeSnapshot` on revert inputs is the
// minimal safe contract for undoing applied update_clip suggestions: the
// applied row no longer carries its pre-apply snapshot, so the caller must
// supply the exact clip state captured before apply.
// ============================================================================

export interface SuggestionBatchItemResult {
  suggestionId: number;
  success: boolean;
  clip?: Clip;
  error?: string;
}

export interface SuggestionBatchResult {
  /** True iff every item succeeded and the batch committed. */
  success: boolean;
  /** Number of items that committed. Always 0 when success is false. */
  appliedCount: number;
  total: number;
  /** Per-item outcomes. When success is false, results reflect the attempted state pre-rollback. */
  results: SuggestionBatchItemResult[];
  /** First error message when success is false. */
  error?: string;
}

/**
 * Clip state to restore when reverting an applied `update_clip` suggestion.
 * Required for update_clip reverts; ignored for create_clip reverts (which
 * delete the created clip instead).
 */
export interface SuggestionRevertSnapshot {
  clip: {
    in_point: number;
    out_point: number;
    role: Clip['role'];
    description: string | null;
    is_essential: boolean;
  };
}

export interface SuggestionBatchRevertItem {
  suggestionId: number;
  beforeSnapshot?: SuggestionRevertSnapshot | null;
}

class SuggestionBatchAbort extends Error {
  constructor(
    public readonly suggestionId: number,
    message: string,
    public readonly clip?: Clip,
    public readonly autoRejected: boolean = false
  ) {
    super(message);
    this.name = 'SuggestionBatchAbort';
  }
}

function emptyFailure(total: number, error: string): SuggestionBatchResult {
  return {
    success: false,
    appliedCount: 0,
    total,
    results: [],
    error,
  };
}

/**
 * Atomically apply a batch of pending suggestions. Either every suggestion
 * is applied (clips created/updated and statuses flipped to 'applied') or no
 * writes persist. A logical failure (e.g. missing chapter, ambiguous asset)
 * on any item rolls back the entire batch.
 */
export async function applySuggestionsBatch(
  suggestionIds: number[]
): Promise<SuggestionBatchResult> {
  const total = suggestionIds.length;
  if (total === 0) {
    return { success: true, appliedCount: 0, total: 0, results: [] };
  }

  const collected: SuggestionBatchItemResult[] = [];
  try {
    return await withTransaction(async () => {
      for (const id of suggestionIds) {
        const result = await applySuggestionWithClipTx(id);
        if (!result.success || !result.clip) {
          throw new SuggestionBatchAbort(
            id,
            result.error ?? 'Suggestion operation failed',
            undefined,
            result.autoRejected === true
          );
        }
        collected.push({
          suggestionId: id,
          success: true,
          clip: result.clip,
        });
      }
      return {
        success: true,
        appliedCount: collected.length,
        total,
        results: collected,
      } satisfies SuggestionBatchResult;
    });
  } catch (error) {
    if (error instanceof SuggestionBatchAbort) {
      // The rollback above also undid the automatic rejection write that
      // accompanied this failure; re-persist it outside the transaction so
      // the malformed suggestion does not stay pending and fail every apply.
      if (error.autoRejected) {
        try {
          const database = await getDatabase();
          database.prepare(
            "UPDATE suggestions SET status = 'rejected', clip_id = NULL, applied_at = NULL WHERE id = ?"
          ).run(error.suggestionId);
        } catch (persistError) {
          console.error('[applySuggestionsBatch] Failed to persist automatic rejection:', persistError);
        }
      }
      const abortResult: SuggestionBatchItemResult = {
        suggestionId: error.suggestionId,
        success: false,
        error: error.message,
      };
      return {
        success: false,
        appliedCount: 0,
        total,
        results: [...collected, abortResult],
        error: error.message,
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[applySuggestionsBatch] Error applying batch:', error);
    return emptyFailure(total, errorMessage);
  }
}

/**
 * Atomically reject a batch of suggestions. Each suggestion's preview
 * artifacts are cleaned up (preview clips deleted, update snapshots restored)
 * and statuses flipped to 'rejected'. Any failure rolls back the entire batch.
 */
export async function rejectSuggestionsBatch(
  suggestionIds: number[]
): Promise<SuggestionBatchResult> {
  return rejectOrRestoreBatch(suggestionIds, 'reject');
}

/**
 * Atomically restore a batch of rejected suggestions back to pending. No
 * preview artifacts are re-created: the suggestion is simply un-rejected so
 * it can be previewed/applied again. Any failure rolls back the entire batch.
 */
export async function restoreRejectedSuggestionsBatch(
  suggestionIds: number[]
): Promise<SuggestionBatchResult> {
  return rejectOrRestoreBatch(suggestionIds, 'restore');
}

async function rejectOrRestoreBatch(
  suggestionIds: number[],
  mode: 'reject' | 'restore'
): Promise<SuggestionBatchResult> {
  const total = suggestionIds.length;
  if (total === 0) {
    return { success: true, appliedCount: 0, total: 0, results: [] };
  }

  const collected: SuggestionBatchItemResult[] = [];
  try {
    return await withTransaction(async () => {
      for (const id of suggestionIds) {
        const outcome = await rejectOrRestoreSuggestionTx(id, mode);
        if (!outcome.success) {
          throw new SuggestionBatchAbort(id, outcome.error ?? 'Suggestion operation failed');
        }
        collected.push({
          suggestionId: id,
          success: true,
          clip: outcome.clip,
        });
      }
      return {
        success: true,
        appliedCount: collected.length,
        total,
        results: collected,
      } satisfies SuggestionBatchResult;
    });
  } catch (error) {
    if (error instanceof SuggestionBatchAbort) {
      const abortResult: SuggestionBatchItemResult = {
        suggestionId: error.suggestionId,
        success: false,
        error: error.message,
      };
      return {
        success: false,
        appliedCount: 0,
        total,
        results: [...collected, abortResult],
        error: error.message,
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${mode}SuggestionsBatch] Error:`, error);
    return emptyFailure(total, errorMessage);
  }
}

async function rejectOrRestoreSuggestionTx(
  id: number,
  mode: 'reject' | 'restore'
): Promise<ApplySuggestionResult> {
  const database = await getDatabase();
  const suggestion = await getSuggestion(id);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }

  if (mode === 'reject') {
    if (suggestion.status === 'rejected') {
      return { success: true };
    }
    if (suggestion.status !== 'pending') {
      return { success: false, error: 'Suggestion is not pending' };
    }
    const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
    if (!cleanupResult.success) {
      return {
        success: false,
        error: cleanupResult.error ?? 'Failed cleaning suggestion preview artifacts',
      };
    }
    const result = database.prepare(
      "UPDATE suggestions SET status = 'rejected', applied_at = NULL, clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?"
    ).run(id);
    if (result.changes === 0) {
      return { success: false, error: 'Failed to update suggestion status' };
    }
    return { success: true, clip: cleanupResult.clip };
  }

  // mode === 'restore'
  if (suggestion.status !== 'rejected') {
    return { success: false, error: 'Suggestion is not rejected' };
  }
  const result = database.prepare(
    "UPDATE suggestions SET status = 'pending', applied_at = NULL WHERE id = ?"
  ).run(id);
  if (result.changes === 0) {
    return { success: false, error: 'Failed to restore suggestion status' };
  }
  return { success: true };
}
/**
 * Atomically revert a batch of applied suggestions. For `create_clip`
 * suggestions the linked clip is deleted and the suggestion returns to
 * pending. For `update_clip` suggestions the caller must supply the exact
 * pre-apply clip `beforeSnapshot` so the clip can be restored; a missing
 * snapshot for an update_clip item aborts the batch. Any failure rolls back
 * the entire batch.
 */
export async function revertAppliedSuggestionsBatch(
  items: SuggestionBatchRevertItem[]
): Promise<SuggestionBatchResult> {
  const total = items.length;
  if (total === 0) {
    return { success: true, appliedCount: 0, total: 0, results: [] };
  }

  const collected: SuggestionBatchItemResult[] = [];
  try {
    return await withTransaction(async () => {
      for (const item of items) {
        const outcome = await revertAppliedSuggestionTx(item);
        if (!outcome.success) {
          throw new SuggestionBatchAbort(
            item.suggestionId,
            outcome.error ?? 'Suggestion operation failed',
            outcome.clip
          );
        }
        collected.push({
          suggestionId: item.suggestionId,
          success: true,
          clip: outcome.clip,
        });
      }
      return {
        success: true,
        appliedCount: collected.length,
        total,
        results: collected,
      } satisfies SuggestionBatchResult;
    });
  } catch (error) {
    if (error instanceof SuggestionBatchAbort) {
      const abortResult: SuggestionBatchItemResult = {
        suggestionId: error.suggestionId,
        success: false,
        error: error.message,
        clip: error.clip,
      };
      return {
        success: false,
        appliedCount: 0,
        total,
        results: [...collected, abortResult],
        error: error.message,
      };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[revertAppliedSuggestionsBatch] Error reverting batch:', error);
    return emptyFailure(total, errorMessage);
  }
}

async function revertAppliedSuggestionTx(
  item: SuggestionBatchRevertItem
): Promise<ApplySuggestionResult> {
  const database = await getDatabase();
  const suggestion = await getSuggestion(item.suggestionId);
  if (!suggestion) {
    return { success: false, error: 'Suggestion not found' };
  }
  if (suggestion.status !== 'applied') {
    return { success: false, error: 'Suggestion is not applied' };
  }

  if (isUpdateSuggestion(suggestion)) {
    const targetClipId = suggestion.target_clip_id ?? suggestion.clip_id;
    if (!targetClipId) {
      return { success: false, error: 'Applied update suggestion has no target clip' };
    }
    const targetClip = await getClip(targetClipId);
    if (!targetClip) {
      return { success: false, error: `Target clip ${targetClipId} not found` };
    }
    if (!item.beforeSnapshot) {
      return {
        success: false,
        error: 'beforeSnapshot is required to revert an applied update_clip suggestion',
      };
    }
    const restored = await updateClip(targetClip.id, {
      in_point: item.beforeSnapshot.clip.in_point,
      out_point: item.beforeSnapshot.clip.out_point,
      role: item.beforeSnapshot.clip.role,
      description: item.beforeSnapshot.clip.description,
      is_essential: item.beforeSnapshot.clip.is_essential,
    });
    if (!restored) {
      return { success: false, error: `Failed to restore clip ${targetClip.id}` };
    }
    const refreshed = await getClip(targetClip.id);
    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'pending', applied_at = NULL, clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?"
    ).run(item.suggestionId);
    if (updateResult.changes === 0) {
      throw new SuggestionRollback({
        success: false,
        error: 'Failed to update suggestion status',
      });
    }
    return { success: true, clip: refreshed ?? undefined };
  }

  const appliedClipId = suggestion.clip_id;
  if (appliedClipId) {
    const existingClip = await getClip(appliedClipId);
    if (!existingClip) {
      // Dangling reference: clear the link and continue reverting the row.
      database.prepare('UPDATE suggestions SET clip_id = NULL WHERE id = ?').run(item.suggestionId);
    } else {
      await deleteClip(appliedClipId);
    }
  }

  const updateResult = database.prepare(
    "UPDATE suggestions SET status = 'pending', applied_at = NULL, clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?"
  ).run(item.suggestionId);
  if (updateResult.changes === 0) {
    throw new SuggestionRollback({
      success: false,
      error: 'Failed to update suggestion status',
    });
  }
  return { success: true };
}
