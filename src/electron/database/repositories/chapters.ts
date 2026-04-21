import type {
  Chapter,
  CreateChapterInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';
import { getChapterProxyByChapterAsset } from './proxies.js';

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
    created_at: now,
  };
}

export async function getChapter(id: number): Promise<Chapter | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, created_at FROM chapters WHERE id = ?'
  ).get(id) as Chapter | undefined;

  return result || null;
}

export async function getChaptersByProject(projectId: number): Promise<Chapter[]> {
  const database = await getDatabase();
  return database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, created_at FROM chapters WHERE project_id = ? ORDER BY display_order ASC, start_time ASC'
  ).all(projectId) as Chapter[];
}

export async function updateChapter(
  id: number,
  updates: Partial<Pick<Chapter, 'title' | 'start_time' | 'end_time' | 'display_order'>>
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

  if (fields.length === 0) {
    return true;
  }

  values.push(id);
  const result = database.prepare(
    `UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
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
