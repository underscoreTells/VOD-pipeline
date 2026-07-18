import type { Chapter, VodCutDraft, VodCutRange } from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

export interface CommitVodCutRange {
  title: string;
  startTime: number;
  endTime: number;
}

export class VodCutValidationError extends Error {
  override name = 'VodCutValidationError';
}

function parseRanges(value: string): VodCutRange[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((range): range is VodCutRange => (
    typeof range === 'object'
    && range !== null
    && typeof (range as VodCutRange).id === 'string'
    && typeof (range as VodCutRange).title === 'string'
    && Number.isFinite((range as VodCutRange).start_time)
    && Number.isFinite((range as VodCutRange).end_time)
  ));
}

export async function saveVodCutDraft(
  projectId: number,
  assetId: number,
  ranges: VodCutRange[],
): Promise<VodCutDraft> {
  const database = await getDatabase();
  const asset = database.prepare(
    'SELECT id FROM assets WHERE id = ? AND project_id = ?'
  ).get(assetId, projectId);
  if (!asset) throw new Error('VOD asset not found in project');

  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO vod_cut_drafts (project_id, asset_id, ranges_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, asset_id) DO UPDATE SET
      ranges_json = excluded.ranges_json,
      updated_at = excluded.updated_at
  `).run(projectId, assetId, JSON.stringify(ranges), updatedAt);

  return { project_id: projectId, asset_id: assetId, ranges, updated_at: updatedAt };
}

export async function loadVodCutDraft(projectId: number, assetId: number): Promise<VodCutDraft | null> {
  const database = await getDatabase();
  const row = database.prepare(`
    SELECT project_id, asset_id, ranges_json, updated_at
    FROM vod_cut_drafts
    WHERE project_id = ? AND asset_id = ?
  `).get(projectId, assetId) as {
    project_id: number;
    asset_id: number;
    ranges_json: string;
    updated_at: string;
  } | undefined;
  if (!row) return null;
  return {
    project_id: row.project_id,
    asset_id: row.asset_id,
    ranges: parseRanges(row.ranges_json),
    updated_at: row.updated_at,
  };
}

export async function clearVodCutDraft(projectId: number, assetId: number): Promise<boolean> {
  const database = await getDatabase();
  return database.prepare(
    'DELETE FROM vod_cut_drafts WHERE project_id = ? AND asset_id = ?'
  ).run(projectId, assetId).changes > 0;
}

export async function commitVodCut(
  projectId: number,
  assetId: number,
  ranges: CommitVodCutRange[],
): Promise<Chapter[]> {
  const database = await getDatabase();
  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const asset = database.prepare(
    'SELECT id, duration FROM assets WHERE id = ? AND project_id = ?'
  ).get(assetId, projectId) as { id: number; duration: number | null } | undefined;
  if (!asset) throw new Error('VOD asset not found in project');
  if (ranges.length === 0) throw new VodCutValidationError('Create at least one chapter range');

  const ordered = [...ranges].sort((left, right) => left.startTime - right.startTime);
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index];
    if (!range.title.trim()) throw new VodCutValidationError('Chapter title is required');
    if (!Number.isFinite(range.startTime) || range.startTime < 0) {
      throw new VodCutValidationError('Start time must be >= 0');
    }
    if (!Number.isFinite(range.endTime) || range.endTime <= range.startTime) {
      throw new VodCutValidationError('End time must be greater than start time');
    }
    if (asset.duration && range.endTime > asset.duration + 0.001) {
      throw new VodCutValidationError('Chapter range exceeds the VOD duration');
    }
    if (index > 0 && range.startTime < ordered[index - 1].endTime - 0.000001) {
      throw new VodCutValidationError('Chapter ranges cannot overlap');
    }
  }

  const insertChapter = database.prepare(`
    INSERT INTO chapters (project_id, title, start_time, end_time, display_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const linkAsset = database.prepare(
    'INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)'
  );
  const clearDraft = database.prepare(
    'DELETE FROM vod_cut_drafts WHERE project_id = ? AND asset_id = ?'
  );
  const maxOrderRow = database.prepare(
    'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM chapters WHERE project_id = ?'
  ).get(projectId) as { max_order: number };
  const firstDisplayOrder = maxOrderRow.max_order + 1;

  const transaction = database.transaction(() => {
    const created: Chapter[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const range = ordered[index];
      const createdAt = new Date().toISOString();
      const displayOrder = firstDisplayOrder + index;
      const result = insertChapter.run(
        projectId,
        range.title.trim(),
        range.startTime,
        range.endTime,
        displayOrder,
        createdAt,
      );
      const chapter: Chapter = {
        id: Number(result.lastInsertRowid),
        project_id: projectId,
        title: range.title.trim(),
        start_time: range.startTime,
        end_time: range.endTime,
        display_order: displayOrder,
        rough_cut_completed_at: null,
        created_at: createdAt,
      };
      linkAsset.run(chapter.id, assetId);
      created.push(chapter);
    }
    clearDraft.run(projectId, assetId);
    return created;
  });

  return transaction();
}
