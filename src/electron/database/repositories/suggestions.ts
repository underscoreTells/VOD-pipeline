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
  isDeleteSuggestion,
  isSplitSuggestion,
  normalizeSuggestionClipWindow,
  normalizeSuggestionRecord,
  parseSuggestionActionPayload,
  parseSuggestionPreviewSnapshot,
  parseSuggestionPreviewSnapshotJson,
  serializeSuggestionPreviewSnapshot,
} from './suggestion-helpers.js';

export interface ApplySuggestionResult {
  success: boolean;
  clip?: Clip;
  clips?: Clip[];
  removedClipIds?: number[];
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

interface ResolvedSplitSegment {
  in_point: number;
  out_point: number;
  role: Clip['role'];
  description: string | null;
  is_essential: boolean;
}

async function validateStructuralSuggestionTarget(
  suggestion: Suggestion,
  chapter: Chapter
): Promise<string | null> {
  const snapshotClip = parseSuggestionPreviewSnapshot(suggestion)?.clip;
  const targetClip = snapshotClip ?? (
    suggestion.target_clip_id ? await getClip(suggestion.target_clip_id) : null
  );
  if (!targetClip) return 'Structural suggestion target clip was not found';
  if (targetClip.asset_id === undefined) return 'Structural suggestion snapshot is incomplete';

  const chapterAssetIds = await getAssetsForChapter(chapter.id);
  if (!chapterAssetIds.includes(targetClip.asset_id)) {
    return `Target clip ${targetClip.id} is not linked to chapter ${chapter.id}`;
  }
  if (targetClip.in_point < chapter.start_time || targetClip.out_point > chapter.end_time) {
    return `Target clip ${targetClip.id} is not contained in chapter ${chapter.id}`;
  }
  return null;
}

function resolveSplitSegments(
  suggestion: Suggestion,
  chapter: Chapter,
  targetClip: Clip
): { segments: ResolvedSplitSegment[] } | { error: string } {
  const split = parseSuggestionActionPayload(suggestion)?.split;
  if (!split) return { error: 'Missing split payload for split suggestion' };

  const targetLocalIn = targetClip.in_point - chapter.start_time;
  const targetLocalOut = targetClip.out_point - chapter.start_time;
  const chapterDuration = chapter.end_time - chapter.start_time;
  const rawSegments = Array.isArray(split.segments)
    ? split.segments
    : typeof split.splitPoint === 'number'
      ? [
          {
            inPoint: targetLocalIn,
            outPoint: split.splitPoint,
            description: split.leftDescription,
          },
          {
            inPoint: split.splitPoint,
            outPoint: targetLocalOut,
            description: split.rightDescription,
          },
        ]
      : null;

  if (!rawSegments || rawSegments.length < 2) {
    return { error: 'A split suggestion requires at least two segments' };
  }

  const segments: ResolvedSplitSegment[] = [];
  for (const raw of rawSegments) {
    if (
      !raw
      || typeof raw.inPoint !== 'number'
      || !Number.isFinite(raw.inPoint)
      || typeof raw.outPoint !== 'number'
      || !Number.isFinite(raw.outPoint)
      || raw.outPoint <= raw.inPoint
      || raw.inPoint < 0
      || raw.outPoint > chapterDuration
      || raw.inPoint < targetLocalIn
      || raw.outPoint > targetLocalOut
      || (segments.length > 0 && chapter.start_time + raw.inPoint < segments[segments.length - 1].out_point)
    ) {
      return {
        error: 'Split segments must be ordered, non-overlapping kept ranges inside the target clip',
      };
    }

    segments.push({
      in_point: chapter.start_time + raw.inPoint,
      out_point: chapter.start_time + raw.outPoint,
      role: raw.role !== undefined ? raw.role : targetClip.role,
      description: raw.description !== undefined ? raw.description : targetClip.description,
      is_essential: raw.isEssential ?? targetClip.is_essential,
    });
  }

  return { segments };
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
  suggestion: Suggestion,
  preserveOwnedTarget = false
): Promise<ApplySuggestionResult> {
  const snapshot = parseSuggestionPreviewSnapshot(suggestion);
  const targetClipId = suggestion.target_clip_id ?? suggestion.clip_id;

  if (!snapshot) {
    return { success: true };
  }

  let refreshed: Clip | null = null;
  if (targetClipId) {
    const targetClip = await getClip(targetClipId);
    if (targetClip) {
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
      refreshed = await getClip(targetClip.id);
    }
  }

  if (snapshot.ownedCreatedClipId && !preserveOwnedTarget) {
    await deleteClip(snapshot.ownedCreatedClipId);
    if (refreshed?.id === snapshot.ownedCreatedClipId) refreshed = null;
  }
  return { success: true, clip: refreshed ?? undefined };
}

async function restoreStructuralSuggestionSnapshot(
  suggestion: Suggestion,
  preserveOwnedTarget = false
): Promise<ApplySuggestionResult> {
  const database = await getDatabase();
  const snapshot = parseSuggestionPreviewSnapshot(suggestion);
  if (!snapshot) return { success: true };

  for (const createdClipId of snapshot.createdClipIds ?? []) {
    await deleteClip(createdClipId);
  }

  if (!preserveOwnedTarget && snapshot.ownedCreatedClipId === snapshot.clip.id) {
    await deleteClip(snapshot.ownedCreatedClipId);
    return { success: true };
  }

  let clip = await getClip(snapshot.clip.id);
  if (clip) {
    const restored = await updateClip(clip.id, {
      in_point: snapshot.clip.in_point,
      out_point: snapshot.clip.out_point,
      role: snapshot.clip.role,
      description: snapshot.clip.description,
      is_essential: snapshot.clip.is_essential,
    });
    if (!restored) return { success: false, error: `Failed to restore clip ${clip.id}` };
    clip = await getClip(clip.id);
    if (!clip) return { success: false, error: `Restored clip ${snapshot.clip.id} could not be loaded` };
  } else {
    if (
      snapshot.clip.project_id === undefined
      || snapshot.clip.asset_id === undefined
      || snapshot.clip.track_index === undefined
    ) {
      return { success: false, error: 'Structural suggestion snapshot is incomplete' };
    }
    clip = await createClip({
      id: snapshot.clip.id,
      project_id: snapshot.clip.project_id,
      asset_id: snapshot.clip.asset_id,
      track_index: snapshot.clip.track_index,
      in_point: snapshot.clip.in_point,
      out_point: snapshot.clip.out_point,
      role: snapshot.clip.role,
      description: snapshot.clip.description,
      is_essential: snapshot.clip.is_essential,
      created_at: snapshot.clip.created_at,
    });
  }

  const restoreLinks = (table: 'beats' | 'suggestions', column: 'clip_id' | 'target_clip_id', ids: number[]) => {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    database.prepare(
      `UPDATE ${table} SET ${column} = ? WHERE ${column} IS NULL AND id IN (${placeholders})`
    ).run(clip.id, ...ids);
  };
  restoreLinks('beats', 'clip_id', snapshot.beatIds ?? []);
  restoreLinks('suggestions', 'target_clip_id', snapshot.targetSuggestionIds ?? []);
  restoreLinks('suggestions', 'clip_id', snapshot.linkedSuggestionIds ?? []);

  // Older snapshots only recorded the clip itself.
  database.prepare(
    'UPDATE suggestions SET target_clip_id = ? WHERE id = ? AND target_clip_id IS NULL'
  ).run(clip.id, suggestion.id);
  return { success: true, clip };
}

async function cleanupPendingSuggestionArtifacts(
  suggestion: Suggestion,
  preserveOwnedTarget = false
): Promise<ApplySuggestionResult> {
  if (suggestion.status !== 'pending') {
    return { success: true };
  }

  if (isDeleteSuggestion(suggestion) || isSplitSuggestion(suggestion)) {
    return await restoreStructuralSuggestionSnapshot(suggestion, preserveOwnedTarget);
  }

  if (isUpdateSuggestion(suggestion)) {
    return await restoreClipFromSuggestionSnapshot(suggestion, preserveOwnedTarget);
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
  const normalizedActionType: Suggestion['action_type'] =
    suggestion.action_type === 'update_clip'
    || suggestion.action_type === 'delete_clip'
    || suggestion.action_type === 'split_clip'
      ? suggestion.action_type
      : 'create_clip';
  const normalizedTargetClipId =
    normalizedActionType !== 'create_clip' &&
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
      ,supersedes_suggestion_id
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chapter_local', ?)`
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
    suggestion.clip_id ?? null,
    suggestion.supersedes_suggestion_id ?? null
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
    supersedes_suggestion_id: suggestion.supersedes_suggestion_id ?? null,
  };
}

export async function getSuggestion(id: number): Promise<Suggestion | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, supersedes_suggestion_id, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE id = ?`
  ).get(id) as Suggestion | undefined;

  return result ? normalizeSuggestionRecord(result) : null;
}

export async function supersedeSuggestion(
  originalId: number,
  replacementId: number,
  conversationId: number,
  chapterId: number
): Promise<boolean> {
  if (originalId === replacementId) return false;
  const database = await getDatabase();
  const original = await getSuggestion(originalId);
  const replacement = await getSuggestion(replacementId);
  if (
    !original
    || !replacement
    || original.conversation_id !== conversationId
    || original.chapter_id !== chapterId
    || original.status !== 'pending'
    || replacement.supersedes_suggestion_id !== originalId
  ) return false;
  const originalSnapshot = parseSuggestionPreviewSnapshot(original);
  const inheritedOwnedClipId = originalSnapshot?.ownedCreatedClipId;
  const ownedPreviewClipId = original.action_type === 'create_clip'
    ? original.clip_id
    : inheritedOwnedClipId;
  let replacementOwnsPreviewClip = ownedPreviewClipId !== null
    && ownedPreviewClipId !== undefined
    && replacement.target_clip_id === ownedPreviewClipId;
  let ownershipSnapshotJson: string | null = null;
  if (isSplitSuggestion(original) && originalSnapshot) {
    const replacementTargetsCreatedSegment = originalSnapshot.createdClipIds?.includes(
      replacement.target_clip_id ?? -1
    ) ?? false;
    const replacementTargetsSplitPreview = replacement.target_clip_id === originalSnapshot.clip.id
      || replacementTargetsCreatedSegment;
    const preserveOwnedTarget = replacementTargetsSplitPreview
      && inheritedOwnedClipId === originalSnapshot.clip.id;
    const cleanup = await cleanupPendingSuggestionArtifacts(original, preserveOwnedTarget);
    if (!cleanup.success) return false;

    if (replacementTargetsCreatedSegment) {
      const retargetResult = database.prepare(
        `UPDATE suggestions SET target_clip_id = ?
         WHERE id = ? AND status = 'pending' AND supersedes_suggestion_id = ?`
      ).run(originalSnapshot.clip.id, replacementId, originalId);
      if (retargetResult.changes !== 1) return false;
    }
    replacementOwnsPreviewClip = preserveOwnedTarget;
  } else if (!replacementOwnsPreviewClip) {
    const cleanup = await cleanupPendingSuggestionArtifacts(original);
    if (!cleanup.success) return false;
  }

  if (replacementOwnsPreviewClip && ownedPreviewClipId !== null && ownedPreviewClipId !== undefined) {
    const previewClip = await getClip(ownedPreviewClipId);
    if (!previewClip) return false;
    const ownershipSnapshot = parseSuggestionPreviewSnapshotJson(
      serializeSuggestionPreviewSnapshot(previewClip)
    );
    if (!ownershipSnapshot) return false;
    ownershipSnapshot.ownedCreatedClipId = previewClip.id;
    ownershipSnapshotJson = JSON.stringify(ownershipSnapshot);
  }
  const transfer = database.transaction(() => {
    if (ownershipSnapshotJson) {
      const replacementResult = database.prepare(
        `UPDATE suggestions SET preview_snapshot_json = ?
         WHERE id = ? AND status = 'pending' AND supersedes_suggestion_id = ?`
      ).run(ownershipSnapshotJson, replacementId, originalId);
      if (replacementResult.changes !== 1) return false;
    }
    const result = database.prepare(
      `UPDATE suggestions
       SET status = 'superseded', applied_at = NULL, clip_id = NULL, preview_snapshot_json = NULL
       WHERE id = ? AND conversation_id = ? AND chapter_id = ? AND status = 'pending'
          AND EXISTS (
            SELECT 1 FROM suggestions replacement
            WHERE replacement.id = ? AND replacement.supersedes_suggestion_id = suggestions.id
          )`
    ).run(originalId, conversationId, chapterId, replacementId);
    return result.changes === 1;
  });
  return transfer();
}

export async function cleanupPendingSuggestionsForMessages(messageIds: number[]): Promise<void> {
  if (messageIds.length === 0) return;
  const database = await getDatabase();
  const placeholders = messageIds.map(() => '?').join(', ');
  const suggestions = (database.prepare(
    `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, supersedes_suggestion_id, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE chat_message_id IN (${placeholders}) AND status IN ('pending', 'rejected', 'superseded')
     ORDER BY id DESC`
  ).all(...messageIds) as Suggestion[]).map(normalizeSuggestionRecord);

  for (const staleSuggestion of suggestions) {
    const suggestion = await getSuggestion(staleSuggestion.id);
    if (!suggestion) continue;

    const ancestor = suggestion.supersedes_suggestion_id
      ? await getSuggestion(suggestion.supersedes_suggestion_id)
      : null;
    const ownedCreatedClipId = parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId;
    const transferOwnership = ownedCreatedClipId !== undefined
      && ancestor?.status === 'superseded'
      && ancestor.action_type !== 'create_clip';
    const cleanup = suggestion.status === 'rejected' && transferOwnership
      ? await restoreStructuralSuggestionSnapshot(suggestion, true)
      : await cleanupPendingSuggestionArtifacts(suggestion, transferOwnership);
    if (!cleanup.success) {
      throw new Error(cleanup.error || `Failed to clean up suggestion ${suggestion.id}`);
    }
    if (ancestor) {
      let ownershipSnapshotJson: string | null = null;
      if (transferOwnership) {
        const ownedClip = cleanup.clip ?? await getClip(ownedCreatedClipId);
        if (!ownedClip) {
          throw new Error(`Failed to transfer preview ownership to suggestion ${ancestor.id}`);
        }
        const ownershipSnapshot = parseSuggestionPreviewSnapshotJson(
          serializeSuggestionPreviewSnapshot(ownedClip)
        );
        if (!ownershipSnapshot) {
          throw new Error(`Failed to snapshot preview ownership for suggestion ${ancestor.id}`);
        }
        ownershipSnapshot.ownedCreatedClipId = ownedCreatedClipId;
        ownershipSnapshotJson = JSON.stringify(ownershipSnapshot);
      }
      database.prepare(
        `UPDATE suggestions
         SET status = 'pending',
             target_clip_id = CASE WHEN ? IS NOT NULL THEN ? ELSE target_clip_id END,
             preview_snapshot_json = CASE WHEN ? IS NOT NULL THEN ? ELSE preview_snapshot_json END
         WHERE id = ? AND status = 'superseded'`
      ).run(
        ownershipSnapshotJson,
        ownedCreatedClipId ?? null,
        ownershipSnapshotJson,
        ownershipSnapshotJson,
        ancestor.id
      );
    }
  }
}

export async function getSuggestionsByChapter(
  chapterId: number,
  status?: Suggestion['status']
): Promise<Suggestion[]> {
  const database = await getDatabase();
  let query = `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description, reasoning, provider,
                      action_type, target_clip_id, action_payload_json, preview_snapshot_json,
                       status, supersedes_suggestion_id, display_order, created_at, applied_at, clip_id
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
                       status, supersedes_suggestion_id, display_order, created_at, applied_at, clip_id
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

  if (isDeleteSuggestion(suggestion) || isSplitSuggestion(suggestion)) {
    const chapter = await getChapter(suggestion.chapter_id);
    if (!chapter) return { success: false, error: 'Chapter not found for this suggestion' };
    const targetError = await validateStructuralSuggestionTarget(suggestion, chapter);
    if (targetError) return { success: false, error: targetError };
    if (suggestion.preview_snapshot_json) {
      const snapshot = parseSuggestionPreviewSnapshot(suggestion);
      if (!snapshot) {
        return { success: false, error: 'Structural suggestion preview snapshot is invalid' };
      }
      const snapshotClipId = snapshot?.clip.id;
      const ownedCreatedClipId = snapshot?.ownedCreatedClipId;
      const ownershipOnly = snapshotClipId !== undefined
        && ownedCreatedClipId === snapshotClipId
        && suggestion.clip_id === null
        && await getClip(snapshotClipId) !== null;
      if (!ownershipOnly) {
        return { success: true, clip: await getClip(snapshot.clip.id) ?? undefined };
      }
    }
    const targetClip = suggestion.target_clip_id ? await getClip(suggestion.target_clip_id) : null;
    if (!targetClip) return { success: false, error: 'Structural suggestion target clip was not found' };
    const snapshot = parseSuggestionPreviewSnapshotJson(serializeSuggestionPreviewSnapshot(targetClip));
    if (!snapshot) return { success: false, error: 'Failed to snapshot target clip' };
    const existingSnapshot = parseSuggestionPreviewSnapshot(suggestion);
    if (existingSnapshot?.ownedCreatedClipId) {
      snapshot.ownedCreatedClipId = existingSnapshot.ownedCreatedClipId;
    }
    if (isDeleteSuggestion(suggestion)) {
      snapshot.beatIds = (database.prepare(
        'SELECT id FROM beats WHERE clip_id = ?'
      ).all(targetClip.id) as Array<{ id: number }>).map(({ id }) => id);
      snapshot.targetSuggestionIds = (database.prepare(
        'SELECT id FROM suggestions WHERE target_clip_id = ?'
      ).all(targetClip.id) as Array<{ id: number }>).map(({ id }) => id);
      snapshot.linkedSuggestionIds = (database.prepare(
        'SELECT id FROM suggestions WHERE clip_id = ?'
      ).all(targetClip.id) as Array<{ id: number }>).map(({ id }) => id);
      if (!await deleteClip(targetClip.id)) return { success: false, error: `Failed to delete clip ${targetClip.id}` };
      database.prepare('UPDATE suggestions SET preview_snapshot_json = ?, clip_id = NULL WHERE id = ?')
        .run(JSON.stringify(snapshot), id);
      return { success: true };
    }
    const resolved = resolveSplitSegments(suggestion, chapter, targetClip);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const [firstSegment, ...remainingSegments] = resolved.segments;
    if (!await updateClip(targetClip.id, {
      in_point: firstSegment.in_point,
      out_point: firstSegment.out_point,
      role: firstSegment.role,
      description: firstSegment.description,
      is_essential: firstSegment.is_essential,
    })) return { success: false, error: `Failed to split clip ${targetClip.id}` };
    snapshot.createdClipIds = [];
    for (const segment of remainingSegments) {
      const createdClip = await createClip({
        project_id: targetClip.project_id,
        asset_id: targetClip.asset_id,
        track_index: targetClip.track_index,
        in_point: segment.in_point,
        out_point: segment.out_point,
        role: segment.role,
        description: segment.description,
        is_essential: segment.is_essential,
      });
      snapshot.createdClipIds.push(createdClip.id);
    }
    database.prepare('UPDATE suggestions SET preview_snapshot_json = ?, clip_id = ? WHERE id = ?')
      .run(JSON.stringify(snapshot), targetClip.id, id);
    return { success: true, clip: await getClip(targetClip.id) ?? undefined };
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

    if (suggestion.preview_snapshot_json && suggestion.clip_id) {
      return { success: true, clip: targetClip };
    }

    const snapshot = parseSuggestionPreviewSnapshotJson(serializeSuggestionPreviewSnapshot(targetClip));
    if (!snapshot) return { success: false, error: 'Failed to snapshot target clip' };
    const existingSnapshot = parseSuggestionPreviewSnapshot(suggestion);
    if (existingSnapshot?.ownedCreatedClipId) {
      snapshot.ownedCreatedClipId = existingSnapshot.ownedCreatedClipId;
    }
    const snapshotJson = JSON.stringify(snapshot);
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

  if (isDeleteSuggestion(suggestion) || isSplitSuggestion(suggestion)) {
    const restoreResult = await restoreStructuralSuggestionSnapshot(suggestion);
    if (!restoreResult.success) return restoreResult;
    database.prepare('UPDATE suggestions SET clip_id = NULL, preview_snapshot_json = NULL, applied_at = NULL WHERE id = ?')
      .run(id);
    return { success: true, clip: restoreResult.clip };
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

  if (isDeleteSuggestion(suggestion) || isSplitSuggestion(suggestion)) {
    const targetError = await validateStructuralSuggestionTarget(suggestion, chapter);
    if (targetError) return { success: false, error: targetError };
    const existingSnapshot = parseSuggestionPreviewSnapshot(suggestion);
    const snapshotClipId = existingSnapshot?.clip.id;
    const ownedCreatedClipId = existingSnapshot?.ownedCreatedClipId;
    const ownershipOnly = snapshotClipId !== undefined
      && ownedCreatedClipId === snapshotClipId
      && suggestion.clip_id === null
      && await getClip(snapshotClipId) !== null;
    if (!existingSnapshot || ownershipOnly) {
      const previewResult = await previewSuggestionWithClipTx(id);
      if (!previewResult.success) return previewResult;
    }
    const refreshed = await getSuggestion(id);
    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'applied', applied_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), id);
    if (updateResult.changes === 0) {
      throw new SuggestionRollback({ success: false, error: 'Failed to update suggestion status' });
    }
    const snapshot = refreshed ? parseSuggestionPreviewSnapshot(refreshed) : null;
    if (!snapshot) return { success: true };
    if (isDeleteSuggestion(suggestion)) {
      return { success: true, removedClipIds: [snapshot.clip.id] };
    }
    const clips = (await Promise.all(
      [...new Set([snapshot.clip.id, ...(snapshot.createdClipIds ?? [])])].map((clipId) => getClip(clipId))
    )).filter((clip): clip is Clip => clip !== null);
    return {
      success: true,
      clip: clips.find((clip) => clip.id === snapshot.clip.id),
      clips,
    };
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
    const existingSnapshot = parseSuggestionPreviewSnapshot(suggestion);
    if (!existingSnapshot || (existingSnapshot.ownedCreatedClipId && !suggestion.clip_id)) {
      const applyResult = await applyUpdateSuggestionToClip(suggestion, chapter, targetClip);
      if (!applyResult.success || !applyResult.clip) {
        return applyResult;
      }
      updatedClip = applyResult.clip;
    }

    const retainedOwnershipSnapshot = existingSnapshot?.ownedCreatedClipId
      ? suggestion.preview_snapshot_json
      : null;
    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'applied', applied_at = ?, clip_id = ?, preview_snapshot_json = ? WHERE id = ?"
    ).run(new Date().toISOString(), updatedClip.id, retainedOwnershipSnapshot, id);

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

  const retainedOwnershipSnapshot = parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId
    ? suggestion.preview_snapshot_json
    : null;
  const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
  if (!cleanupResult.success) {
    return false;
  }

  const result = database.prepare(
    "UPDATE suggestions SET status = 'rejected', applied_at = NULL, clip_id = NULL, preview_snapshot_json = ? WHERE id = ?"
  ).run(retainedOwnershipSnapshot, id);

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
  clips?: Clip[];
  removedClipIds?: number[];
  error?: string;
  /** True when the failure itself marked the suggestion as rejected. */
  autoRejected?: boolean;
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
        if (!result.success) {
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
          ...(result.clip ? { clip: result.clip } : {}),
          ...(result.clips ? { clips: result.clips } : {}),
          ...(result.removedClipIds ? { removedClipIds: result.removedClipIds } : {}),
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
        ...(error.autoRejected ? { autoRejected: true } : {}),
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
    const retainedOwnershipSnapshot = parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId
      ? suggestion.preview_snapshot_json
      : null;
    const cleanupResult = await cleanupPendingSuggestionArtifacts(suggestion);
    if (!cleanupResult.success) {
      return {
        success: false,
        error: cleanupResult.error ?? 'Failed cleaning suggestion preview artifacts',
      };
    }
    const result = database.prepare(
      "UPDATE suggestions SET status = 'rejected', applied_at = NULL, clip_id = NULL, preview_snapshot_json = ? WHERE id = ?"
    ).run(retainedOwnershipSnapshot, id);
    if (result.changes === 0) {
      return { success: false, error: 'Failed to update suggestion status' };
    }
    return { success: true, clip: cleanupResult.clip };
  }

  // mode === 'restore'
  if (suggestion.status !== 'rejected') {
    return { success: false, error: 'Suggestion is not rejected' };
  }
  let restoredClip: Clip | undefined;
  if (parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId) {
    const restored = await restoreStructuralSuggestionSnapshot(suggestion, true);
    if (!restored.success) return restored;
    restoredClip = restored.clip;
  }
  const result = database.prepare(
    "UPDATE suggestions SET status = 'pending', applied_at = NULL WHERE id = ?"
  ).run(id);
  if (result.changes === 0) {
    return { success: false, error: 'Failed to restore suggestion status' };
  }
  return { success: true, clip: restoredClip };
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
      for (const item of [...items].reverse()) {
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

  if (isDeleteSuggestion(suggestion) || isSplitSuggestion(suggestion)) {
    const ownedCreatedClipId = parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId;
    const restored = await restoreStructuralSuggestionSnapshot(suggestion, true);
    if (!restored.success) return restored;
    let ownershipSnapshotJson: string | null = null;
    if (ownedCreatedClipId && restored.clip) {
      const ownershipSnapshot = parseSuggestionPreviewSnapshotJson(
        serializeSuggestionPreviewSnapshot(restored.clip)
      );
      if (!ownershipSnapshot) {
        return { success: false, error: 'Failed to preserve structural preview ownership' };
      }
      ownershipSnapshot.ownedCreatedClipId = ownedCreatedClipId;
      ownershipSnapshotJson = JSON.stringify(ownershipSnapshot);
    }
    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'pending', applied_at = NULL, clip_id = NULL, preview_snapshot_json = ? WHERE id = ?"
    ).run(ownershipSnapshotJson, item.suggestionId);
    if (updateResult.changes === 0) {
      throw new SuggestionRollback({ success: false, error: 'Failed to update suggestion status' });
    }
    return restored;
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
    const ownedCreatedClipId = parseSuggestionPreviewSnapshot(suggestion)?.ownedCreatedClipId;
    let ownershipSnapshotJson: string | null = null;
    if (ownedCreatedClipId && refreshed) {
      const ownershipSnapshot = parseSuggestionPreviewSnapshotJson(
        serializeSuggestionPreviewSnapshot(refreshed)
      );
      if (!ownershipSnapshot) {
        return { success: false, error: 'Failed to preserve update preview ownership' };
      }
      ownershipSnapshot.ownedCreatedClipId = ownedCreatedClipId;
      ownershipSnapshotJson = JSON.stringify(ownershipSnapshot);
    }
    const updateResult = database.prepare(
      "UPDATE suggestions SET status = 'pending', applied_at = NULL, clip_id = NULL, preview_snapshot_json = ? WHERE id = ?"
    ).run(ownershipSnapshotJson, item.suggestionId);
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
