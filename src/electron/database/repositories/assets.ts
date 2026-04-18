import type {
  Asset,
  AssetMetadata,
  CreateAssetInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

const VALID_FILE_TYPES: Array<'video' | 'audio' | 'image'> = ['video', 'audio', 'image'];

interface AssetRow {
  id: number;
  project_id: number;
  file_path: string;
  file_type: string | null;
  duration: number | null;
  metadata: string | null;
  created_at: string;
}

function mapAssetRow(row: AssetRow): Asset {
  return {
    ...row,
    file_type: row.file_type as Asset['file_type'],
    metadata: row.metadata ? (JSON.parse(row.metadata) as AssetMetadata) : null,
  };
}

export async function createAsset(asset: CreateAssetInput): Promise<Asset> {
  const database = await getDatabase();

  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(asset.project_id);
  if (!project) {
    throw new Error(`Project not found: ${asset.project_id}`);
  }

  if (asset.file_type !== null && !VALID_FILE_TYPES.includes(asset.file_type)) {
    throw new Error(`Invalid file_type: ${asset.file_type}. Must be one of: ${VALID_FILE_TYPES.join(', ')}`);
  }

  const now = new Date().toISOString();
  const result = database.prepare(
    `INSERT INTO assets (project_id, file_path, file_type, duration, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    asset.project_id,
    asset.file_path,
    asset.file_type,
    asset.duration,
    asset.metadata ? JSON.stringify(asset.metadata) : null,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    project_id: asset.project_id,
    file_path: asset.file_path,
    file_type: asset.file_type,
    duration: asset.duration,
    metadata: asset.metadata,
    created_at: now,
  };
}

export async function getAsset(id: number): Promise<Asset | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, file_path, file_type, duration, metadata, created_at FROM assets WHERE id = ?'
  ).get(id) as AssetRow | undefined;

  return result ? mapAssetRow(result) : null;
}

export async function getAssetsByProject(projectId: number): Promise<Asset[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, project_id, file_path, file_type, duration, metadata, created_at FROM assets WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId) as AssetRow[];

  return results.map(mapAssetRow);
}

export async function deleteAsset(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM assets WHERE id = ?').run(id);

  return result.changes > 0;
}

export async function deleteAssetsByProject(projectId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM assets WHERE project_id = ?').run(projectId);

  return result.changes;
}

export async function updateAssetMetadata(
  id: number,
  metadata: AssetMetadata
): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    'UPDATE assets SET metadata = ? WHERE id = ?'
  ).run(JSON.stringify(metadata), id);

  return result.changes > 0;
}
