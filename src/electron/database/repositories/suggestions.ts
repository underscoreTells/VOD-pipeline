import type {
  Chapter,
  Clip,
  CreateSuggestionInput,
  Suggestion,
  UpdateClipInput,
  UpdateSuggestionInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';
import { getAsset } from './assets.js';
import { getAssetsForChapter, getChapter } from './chapters.js';
import {
  createClip,
  deleteClip,
  getClip,
  updateClip,
} from './clips.js';

export interface ApplySuggestionResult {
  success: boolean;
  clip?: Clip;
  error?: string;
}

export interface CancelSuggestionPreviewResult {
  success: boolean;
  removedClipId?: number;
  clip?: Clip;
  error?: string;
}

interface SuggestionActionPayload {
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

interface SuggestionPreviewSnapshot {
  clip: {
    id: number;
    in_point: number;
    out_point: number;
    role: Clip['role'];
    description: string | null;
    is_essential: boolean;
  };
}

interface NormalizedSuggestionClipWindow {
  inPoint: number;
  outPoint: number;
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSuggestionRecord(row: Suggestion): Suggestion {
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

function isUpdateSuggestion(suggestion: Suggestion): boolean {
  return suggestion.action_type === 'update_clip';
}

function parseSuggestionActionPayload(suggestion: Suggestion): SuggestionActionPayload | null {
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

function parseSuggestionPreviewSnapshot(
  suggestion: Suggestion
): SuggestionPreviewSnapshot | null {
  if (!suggestion.preview_snapshot_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(suggestion.preview_snapshot_json) as SuggestionPreviewSnapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.clip || typeof parsed.clip !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function serializeSuggestionPreviewSnapshot(clip: Clip): string {
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

function normalizeSuggestionClipWindow(
  suggestion: Suggestion,
  chapter: Chapter
): NormalizedSuggestionClipWindow {
  const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);

  const looksLikeLegacyGlobal =
    suggestion.in_point > chapterDuration + 1 ||
    suggestion.out_point > chapterDuration + 1 ||
    suggestion.in_point < -0.5 ||
    suggestion.out_point < -0.5;

  const localInRaw = looksLikeLegacyGlobal
    ? suggestion.in_point - chapter.start_time
    : suggestion.in_point;
  const localOutRaw = looksLikeLegacyGlobal
    ? suggestion.out_point - chapter.start_time
    : suggestion.out_point;

  const localInPoint = clampToRange(localInRaw, 0, chapterDuration);
  const localOutPoint = clampToRange(localOutRaw, localInPoint, chapterDuration);

  return {
    inPoint: chapter.start_time + localInPoint,
    outPoint: chapter.start_time + localOutPoint,
  };
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
      clip_id
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

export async function getSuggestionsByProvider(
  chapterId: number,
  provider: 'gemini' | 'kimi'
): Promise<Suggestion[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE chapter_id = ? AND provider = ?
     ORDER BY display_order ASC`
  ).all(chapterId, provider) as Suggestion[];

  return results.map(normalizeSuggestionRecord);
}

export async function previewSuggestionWithClip(id: number): Promise<ApplySuggestionResult> {
  const database = await getDatabase();

  try {
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
        await restoreClipFromSuggestionSnapshot({
          ...suggestion,
          clip_id: targetClip.id,
          preview_snapshot_json: snapshotJson,
        });
        return { success: false, error: 'Failed to save update suggestion preview state' };
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
      await deleteClip(createResult.clip.id);
      return { success: false, error: 'Failed to save suggestion preview clip' };
    }

    return createResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[previewSuggestionWithClip] Error previewing suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

export async function cancelSuggestionPreview(
  id: number
): Promise<CancelSuggestionPreviewResult> {
  const database = await getDatabase();

  try {
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[cancelSuggestionPreview] Error cancelling preview for suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

export async function applySuggestionWithClip(id: number): Promise<ApplySuggestionResult> {
  const database = await getDatabase();

  try {
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
        return { success: false, error: 'Failed to update suggestion status' };
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
      return { success: false, error: 'Failed to update suggestion status' };
    }

    return { success: true, clip };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[applySuggestionWithClip] Error applying suggestion ${id}:`, error);
    return { success: false, error: errorMessage };
  }
}

export async function rejectSuggestion(id: number): Promise<boolean> {
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
