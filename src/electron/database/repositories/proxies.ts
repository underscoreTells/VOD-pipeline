import type {
  ChapterProxy,
  CreateChapterProxyInput,
  CreateProxyInput,
  Proxy as ProxyModel,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

export async function createProxy(proxy: CreateProxyInput): Promise<ProxyModel> {
  const database = await getDatabase();
  const result = database.prepare(
    `INSERT INTO proxies (asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    proxy.asset_id,
    proxy.file_path,
    proxy.preset,
    proxy.width,
    proxy.height,
    proxy.framerate,
    proxy.file_size,
    proxy.duration,
    proxy.status,
    proxy.error_message
  );

  return {
    id: result.lastInsertRowid as number,
    ...proxy,
    created_at: new Date().toISOString(),
  };
}

export async function getProxy(id: number): Promise<ProxyModel | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message, created_at FROM proxies WHERE id = ?'
  ).get(id) as ProxyModel | undefined;

  return result || null;
}

export async function getProxyByAsset(
  assetId: number,
  preset: 'ai_analysis' = 'ai_analysis'
): Promise<ProxyModel | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message, created_at FROM proxies WHERE asset_id = ? AND preset = ?'
  ).get(assetId, preset) as ProxyModel | undefined;

  return result || null;
}

export async function getProxiesByAsset(assetId: number): Promise<ProxyModel[]> {
  const database = await getDatabase();
  return database.prepare(
    'SELECT id, asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message, created_at FROM proxies WHERE asset_id = ? ORDER BY created_at DESC'
  ).all(assetId) as ProxyModel[];
}

export async function updateProxyStatus(
  id: number,
  status: ProxyModel['status'],
  errorMessage?: string
): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    'UPDATE proxies SET status = ?, error_message = ? WHERE id = ?'
  ).run(status, errorMessage || null, id);

  return result.changes > 0;
}

export async function updateProxyMetadata(
  id: number,
  updates: { width?: number; height?: number; framerate?: number; file_size?: number; duration?: number }
): Promise<boolean> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.width !== undefined) {
    fields.push('width = ?');
    values.push(updates.width);
  }
  if (updates.height !== undefined) {
    fields.push('height = ?');
    values.push(updates.height);
  }
  if (updates.framerate !== undefined) {
    fields.push('framerate = ?');
    values.push(updates.framerate);
  }
  if (updates.file_size !== undefined) {
    fields.push('file_size = ?');
    values.push(updates.file_size);
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?');
    values.push(updates.duration);
  }

  if (fields.length === 0) {
    return true;
  }

  values.push(id);
  const result = database.prepare(
    `UPDATE proxies SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteProxy(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM proxies WHERE id = ?').run(id);

  return result.changes > 0;
}

export async function deleteProxiesByAsset(assetId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM proxies WHERE asset_id = ?').run(assetId);

  return result.changes;
}

export async function createChapterProxy(
  proxy: CreateChapterProxyInput
): Promise<ChapterProxy> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const result = database.prepare(
    `INSERT INTO chapter_proxies (
      chapter_id, asset_id, file_path, preset, start_time, end_time,
      width, height, framerate, file_size, duration, status, error_message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    proxy.chapter_id,
    proxy.asset_id,
    proxy.file_path,
    proxy.preset,
    proxy.start_time,
    proxy.end_time,
    proxy.width,
    proxy.height,
    proxy.framerate,
    proxy.file_size,
    proxy.duration,
    proxy.status,
    proxy.error_message,
    now,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    ...proxy,
    created_at: now,
    updated_at: now,
  };
}

export async function getChapterProxyByChapterAsset(
  chapterId: number,
  assetId: number,
  preset: 'ai_analysis_chapter' = 'ai_analysis_chapter'
): Promise<ChapterProxy | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, chapter_id, asset_id, file_path, preset, start_time, end_time,
            width, height, framerate, file_size, duration, status, error_message, created_at, updated_at
     FROM chapter_proxies
     WHERE chapter_id = ? AND asset_id = ? AND preset = ?`
  ).get(chapterId, assetId, preset) as ChapterProxy | undefined;

  return result || null;
}

export async function updateChapterProxyStatus(
  id: number,
  status: ChapterProxy['status'],
  errorMessage?: string
): Promise<boolean> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const result = database.prepare(
    'UPDATE chapter_proxies SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
  ).run(status, errorMessage || null, now, id);

  return result.changes > 0;
}

export async function updateChapterProxyMetadata(
  id: number,
  updates: { width?: number; height?: number; framerate?: number; file_size?: number; duration?: number }
): Promise<boolean> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.width !== undefined) {
    fields.push('width = ?');
    values.push(updates.width);
  }
  if (updates.height !== undefined) {
    fields.push('height = ?');
    values.push(updates.height);
  }
  if (updates.framerate !== undefined) {
    fields.push('framerate = ?');
    values.push(updates.framerate);
  }
  if (updates.file_size !== undefined) {
    fields.push('file_size = ?');
    values.push(updates.file_size);
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?');
    values.push(updates.duration);
  }

  if (fields.length === 0) {
    return true;
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const result = database.prepare(
    `UPDATE chapter_proxies SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function updateChapterProxyDefinition(
  id: number,
  updates: {
    file_path?: string;
    start_time?: number;
    end_time?: number;
    width?: number | null;
    height?: number | null;
    framerate?: number | null;
    file_size?: number | null;
    duration?: number | null;
    status?: ChapterProxy['status'];
    error_message?: string | null;
  }
): Promise<boolean> {
  const database = await getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.file_path !== undefined) {
    fields.push('file_path = ?');
    values.push(updates.file_path);
  }
  if (updates.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(updates.start_time);
  }
  if (updates.end_time !== undefined) {
    fields.push('end_time = ?');
    values.push(updates.end_time);
  }
  if (updates.width !== undefined) {
    fields.push('width = ?');
    values.push(updates.width);
  }
  if (updates.height !== undefined) {
    fields.push('height = ?');
    values.push(updates.height);
  }
  if (updates.framerate !== undefined) {
    fields.push('framerate = ?');
    values.push(updates.framerate);
  }
  if (updates.file_size !== undefined) {
    fields.push('file_size = ?');
    values.push(updates.file_size);
  }
  if (updates.duration !== undefined) {
    fields.push('duration = ?');
    values.push(updates.duration);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.error_message !== undefined) {
    fields.push('error_message = ?');
    values.push(updates.error_message);
  }

  if (fields.length === 0) {
    return true;
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const result = database.prepare(
    `UPDATE chapter_proxies SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}
