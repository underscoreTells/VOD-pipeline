import type Database from 'better-sqlite3';
import type {
  Chapter,
  CreateChapterInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';
import { parseSuggestionPreviewSnapshotJson } from './suggestion-helpers.js';

export { getChapterProxyByChapterAsset } from './proxies.js';

export async function createChapter(chapter: CreateChapterInput): Promise<Chapter> {
  const database = await getDatabase();
  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(chapter.project_id);
  if (!project) {
    throw new Error(`Project not found: ${chapter.project_id}`);
  }

  if (chapter.start_time < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (chapter.end_time <= chapter.start_time) {
    throw new Error('End time must be greater than start time');
  }

  const now = new Date().toISOString();
  const displayOrder = chapter.display_order ?? 0;
  const result = database.prepare(
    `INSERT INTO chapters (project_id, title, start_time, end_time, display_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    chapter.project_id,
    chapter.title,
    chapter.start_time,
    chapter.end_time,
    displayOrder,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    project_id: chapter.project_id,
    title: chapter.title,
    start_time: chapter.start_time,
    end_time: chapter.end_time,
    display_order: displayOrder,
    rough_cut_completed_at: null,
    created_at: now,
  };
}

export async function getChapter(id: number): Promise<Chapter | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, rough_cut_completed_at, created_at FROM chapters WHERE id = ?'
  ).get(id) as Chapter | undefined;

  return result || null;
}

export async function getChaptersByProject(projectId: number): Promise<Chapter[]> {
  const database = await getDatabase();
  return database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, rough_cut_completed_at, created_at FROM chapters WHERE project_id = ? ORDER BY display_order ASC, start_time ASC'
  ).all(projectId) as Chapter[];
}

export async function updateChapter(
  id: number,
  updates: Partial<Pick<Chapter, 'title' | 'start_time' | 'end_time' | 'display_order' | 'rough_cut_completed_at'>>
): Promise<boolean> {
  const database = await getDatabase();
  const current = await getChapter(id);
  if (!current) {
    return false;
  }

  const newStart = updates.start_time ?? current.start_time;
  const newEnd = updates.end_time ?? current.end_time;
  if (newStart < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (newEnd <= newStart) {
    throw new Error('End time must be greater than start time');
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(updates.start_time);
  }
  if (updates.end_time !== undefined) {
    fields.push('end_time = ?');
    values.push(updates.end_time);
  }
  if (updates.display_order !== undefined) {
    fields.push('display_order = ?');
    values.push(updates.display_order);
  }
  if (updates.rough_cut_completed_at !== undefined) {
    fields.push('rough_cut_completed_at = ?');
    values.push(updates.rough_cut_completed_at);
  }

  if (fields.length === 0) {
    return true;
  }

  const boundsChanged =
    updates.start_time !== undefined || updates.end_time !== undefined;

  const applyUpdates = database.transaction(() => {
    values.push(id);
    const result = database.prepare(
      `UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);

    if (result.changes > 0 && boundsChanged) {
      // Materialized previews reference global source times derived from the
      // old bounds, so cancel them before re-clamping the stored ranges;
      // apply would otherwise commit a stale or out-of-chapter clip.
      cancelChapterSuggestionPreviews(database, id);
      // Stored suggestion ranges are chapter-local, so keep them inside the
      // new bounds instead of stranding them out of range.
      clampChapterSuggestionRanges(database, id, newStart, newEnd);
    }

    return result.changes > 0;
  });

  return applyUpdates();
}

function cancelChapterSuggestionPreviews(
  database: Database.Database,
  chapterId: number
): void {
  // Oldest first: when several pending update previews target the same clip,
  // the oldest snapshot holds the clip's base state; restoring any later
  // snapshot would leave stale preview state materialized.
  const rows = database.prepare(
    `SELECT id, action_type, target_clip_id, clip_id, preview_snapshot_json
     FROM suggestions
     WHERE chapter_id = ? AND status = 'pending'
       AND (clip_id IS NOT NULL OR preview_snapshot_json IS NOT NULL)
     ORDER BY id ASC`
  ).all(chapterId) as Array<{
    id: number;
    action_type: string | null;
    target_clip_id: number | null;
    clip_id: number | null;
    preview_snapshot_json: string | null;
  }>;

  if (rows.length === 0) return;

  const restoreClip = database.prepare(
    'UPDATE clips SET in_point = ?, out_point = ?, role = ?, description = ?, is_essential = ? WHERE id = ?'
  );
  const deletePreviewClip = database.prepare('DELETE FROM clips WHERE id = ?');
  const unlinkSuggestion = database.prepare(
    'UPDATE suggestions SET clip_id = NULL, preview_snapshot_json = NULL, applied_at = NULL WHERE id = ?'
  );

  const restoredTargetClipIds = new Set<number>();
  for (const row of rows) {
    if (row.action_type === 'update_clip') {
      const snapshot = parseSuggestionPreviewSnapshotJson(row.preview_snapshot_json);
      const targetClipId = row.target_clip_id ?? row.clip_id;
      if (snapshot && targetClipId !== null && !restoredTargetClipIds.has(targetClipId)) {
        restoreClip.run(
          snapshot.clip.in_point,
          snapshot.clip.out_point,
          snapshot.clip.role,
          snapshot.clip.description,
          snapshot.clip.is_essential ? 1 : 0,
          targetClipId
        );
        restoredTargetClipIds.add(targetClipId);
      }
    } else if (row.clip_id !== null) {
      deletePreviewClip.run(row.clip_id);
    }
    unlinkSuggestion.run(row.id);
  }
}

function clampChapterSuggestionRanges(
  database: Database.Database,
  chapterId: number,
  chapterStart: number,
  chapterEnd: number
): void {
  const chapterDuration = Math.max(0.01, chapterEnd - chapterStart);
  const rows = database.prepare(
    'SELECT id, in_point, out_point FROM suggestions WHERE chapter_id = ?'
  ).all(chapterId) as Array<{ id: number; in_point: number; out_point: number }>;
  const updateRange = database.prepare(
    `UPDATE suggestions SET in_point = ?, out_point = ?, range_space = 'chapter_local' WHERE id = ?`
  );

  for (const row of rows) {
    const localIn = Math.min(Math.max(row.in_point, 0), chapterDuration);
    const localOut = Math.min(Math.max(row.out_point, localIn), chapterDuration);
    if (localIn !== row.in_point || localOut !== row.out_point) {
      updateRange.run(localIn, localOut, row.id);
    }
  }
}

export async function deleteChapter(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM chapters WHERE id = ?').run(id);

  return result.changes > 0;
}

export async function deleteChaptersByProject(projectId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM chapters WHERE project_id = ?').run(projectId);

  return result.changes;
}

export async function addAssetToChapter(chapterId: number, assetId: number): Promise<void> {
  const database = await getDatabase();
  try {
    database.prepare(
      'INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)'
    ).run(chapterId, assetId);
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE constraint failed')) {
      return;
    }
    throw error;
  }
}

export async function removeAssetFromChapter(chapterId: number, assetId: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    'DELETE FROM chapter_assets WHERE chapter_id = ? AND asset_id = ?'
  ).run(chapterId, assetId);

  return result.changes > 0;
}

export async function getAssetsForChapter(chapterId: number): Promise<number[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT asset_id FROM chapter_assets WHERE chapter_id = ?'
  ).all(chapterId) as Array<{ asset_id: number }>;

  return results.map((row) => row.asset_id);
}

export async function getChaptersForAsset(assetId: number): Promise<number[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT chapter_id FROM chapter_assets WHERE asset_id = ?'
  ).all(assetId) as Array<{ chapter_id: number }>;

  return results.map((row) => row.chapter_id);
}
