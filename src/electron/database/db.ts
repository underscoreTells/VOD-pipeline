import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  Asset,
  AssetMetadata,
  Chapter,
  Transcript,
  CreateAssetInput,
  CreateChapterInput,
  CreateTranscriptInput,
} from '../../shared/types/database.js';

let db: Database.Database | null = null;
let initializationPromise: Promise<Database.Database> | null = null;

export async function initializeDatabase(): Promise<Database.Database> {
  if (db) {
    return db;
  }

  if (initializationPromise) {
    return await initializationPromise;
  }

  initializationPromise = (async () => {
    const { app } = await import('electron');
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'vod-pipeline.db');

    console.log('Initializing database at:', dbPath);

    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');

    const modulePath = fileURLToPath(import.meta.url);
    const moduleDirname = path.dirname(modulePath);

    const possiblePaths = [
      path.join(moduleDirname, '../../database/schema.sql'),
      path.join(moduleDirname, '../../../database/schema.sql'),
      path.join(app.getAppPath(), 'database/schema.sql'),
    ];

    let schema: string | null = null;
    for (const schemaPath of possiblePaths) {
      if (fs.existsSync(schemaPath)) {
        schema = fs.readFileSync(schemaPath, 'utf-8');
        console.log('Database schema loaded from:', schemaPath);
        break;
      }
    }

    if (schema) {
      database.exec(schema);
      console.log('Database schema initialized successfully');
    } else {
      console.error('Schema file not found. Tried paths:', possiblePaths);
      throw new Error('Database schema not found - cannot initialize database');
    }

    return database;
  })()
    .then((database) => {
      db = database;
      initializationPromise = null;
      return database;
    })
    .catch((error) => {
      initializationPromise = null;
      throw error;
    });

  return await initializationPromise;
}

export async function getDatabase(): Promise<Database.Database> {
  if (!db) {
    return await initializeDatabase();
  }
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export interface Project {
  id?: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export async function createProject(name: string): Promise<Project> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  
  const result = database.prepare(
    'INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)'
  ).run(name, now, now);
  
  return {
    id: result.lastInsertRowid as number,
    name,
    created_at: now,
    updated_at: now,
  };
}

export async function getProject(id: number): Promise<Project | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects WHERE id = ?'
  ).get(id) as Project | undefined;
  
  return result || null;
}

export async function listProjects(): Promise<Project[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC'
  ).all() as Project[];
  
  return results;
}

export async function deleteProject(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  
  return result.changes > 0;
}

export async function updateProject(id: number, name: string): Promise<boolean> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  
  const result = database.prepare(
    'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?'
  ).run(name, now, id);
  
  return result.changes > 0;
}

// ============================================================================
// ASSET CRUD OPERATIONS
// ============================================================================

const VALID_FILE_TYPES: Array<'video' | 'audio' | 'image'> = ['video', 'audio', 'image'];

export async function createAsset(asset: CreateAssetInput): Promise<Asset> {
  const database = await getDatabase();
  
  // Validate project exists
  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(asset.project_id);
  if (!project) {
    throw new Error(`Project not found: ${asset.project_id}`);
  }
  
  // Validate file_type (allow null, but if provided must be valid)
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
  ).get(id) as {
    id: number;
    project_id: number;
    file_path: string;
    file_type: string | null;
    duration: number | null;
    metadata: string | null;
    created_at: string;
  } | undefined;
  
  if (!result) return null;
  
  return {
    ...result,
    file_type: result.file_type as Asset['file_type'],
    metadata: result.metadata ? JSON.parse(result.metadata) as AssetMetadata : null,
  };
}

export async function getAssetsByProject(projectId: number): Promise<Asset[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, project_id, file_path, file_type, duration, metadata, created_at FROM assets WHERE project_id = ? ORDER BY created_at DESC'
  ).all(projectId) as Array<{
    id: number;
    project_id: number;
    file_path: string;
    file_type: string | null;
    duration: number | null;
    metadata: string | null;
    created_at: string;
  }>;
  
  return results.map(row => ({
    ...row,
    file_type: row.file_type as Asset['file_type'],
    metadata: row.metadata ? JSON.parse(row.metadata) as AssetMetadata : null,
  }));
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

// ============================================================================
// CHAPTER CRUD OPERATIONS
// ============================================================================

export async function createChapter(chapter: CreateChapterInput): Promise<Chapter> {
  const database = await getDatabase();
  
  // Validate project exists
  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(chapter.project_id);
  if (!project) {
    throw new Error(`Project not found: ${chapter.project_id}`);
  }
  
  // Validate time range
  if (chapter.start_time < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (chapter.end_time <= chapter.start_time) {
    throw new Error('End time must be greater than start time');
  }
  
  const now = new Date().toISOString();
  
  const result = database.prepare(
    `INSERT INTO chapters (project_id, title, start_time, end_time, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    chapter.project_id,
    chapter.title,
    chapter.start_time,
    chapter.end_time,
    now
  );
  
  return {
    id: result.lastInsertRowid as number,
    project_id: chapter.project_id,
    title: chapter.title,
    start_time: chapter.start_time,
    end_time: chapter.end_time,
    created_at: now,
  };
}

export async function getChapter(id: number): Promise<Chapter | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, created_at FROM chapters WHERE id = ?'
  ).get(id) as Chapter | undefined;
  
  return result || null;
}

export async function getChaptersByProject(projectId: number): Promise<Chapter[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, created_at FROM chapters WHERE project_id = ? ORDER BY start_time ASC'
  ).all(projectId) as Chapter[];
  
  return results;
}

export async function updateChapter(
  id: number,
  updates: Partial<Pick<Chapter, 'title' | 'start_time' | 'end_time'>>
): Promise<boolean> {
  const database = await getDatabase();
  
  // Get current chapter for validation
  const current = await getChapter(id);
  if (!current) {
    return false;
  }
  
  const newStart = updates.start_time ?? current.start_time;
  const newEnd = updates.end_time ?? current.end_time;
  
  // Validate time range
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
  
  if (fields.length === 0) {
    return true; // Nothing to update
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

// ============================================================================
// CHAPTER-ASSET LINKING
// ============================================================================

export async function addAssetToChapter(chapterId: number, assetId: number): Promise<void> {
  const database = await getDatabase();
  
  try {
    database.prepare(
      'INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)'
    ).run(chapterId, assetId);
  } catch (error) {
    // Ignore duplicate key errors
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
  
  return results.map(r => r.asset_id);
}

export async function getChaptersForAsset(assetId: number): Promise<number[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT chapter_id FROM chapter_assets WHERE asset_id = ?'
  ).all(assetId) as Array<{ chapter_id: number }>;
  
  return results.map(r => r.chapter_id);
}

// ============================================================================
// TRANSCRIPT CRUD OPERATIONS
// ============================================================================

export async function createTranscript(transcript: CreateTranscriptInput): Promise<Transcript> {
  const database = await getDatabase();
  
  const result = database.prepare(
    `INSERT INTO transcripts (chapter_id, text, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  ).run(
    transcript.chapter_id,
    transcript.text,
    transcript.start_time,
    transcript.end_time
  );
  
  return {
    id: result.lastInsertRowid as number,
    chapter_id: transcript.chapter_id,
    text: transcript.text,
    start_time: transcript.start_time,
    end_time: transcript.end_time,
  };
}

export async function getTranscriptsByChapter(chapterId: number): Promise<Transcript[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, chapter_id, text, start_time, end_time FROM transcripts WHERE chapter_id = ? ORDER BY start_time ASC'
  ).all(chapterId) as Transcript[];
  
  return results;
}

export async function getTranscriptsByProject(projectId: number): Promise<Transcript[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT t.id, t.chapter_id, t.text, t.start_time, t.end_time
     FROM transcripts t
     JOIN chapters c ON t.chapter_id = c.id
     WHERE c.project_id = ?
     ORDER BY c.start_time ASC, t.start_time ASC`
  ).all(projectId) as Transcript[];
  
  return results;
}

export async function deleteTranscriptsByChapter(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?').run(chapterId);
  
  return result.changes;
}

export async function batchInsertTranscripts(
  chapterId: number,
  segments: Array<Omit<CreateTranscriptInput, 'chapter_id'>>
): Promise<number> {
  const database = await getDatabase();
  
  const insert = database.prepare(
    'INSERT INTO transcripts (chapter_id, text, start_time, end_time) VALUES (?, ?, ?, ?)'
  );
  
  const insertMany = database.transaction((items: typeof segments) => {
    for (const item of items) {
      insert.run(chapterId, item.text, item.start_time, item.end_time);
    }
    return items.length;
  });
  
  return insertMany(segments);
}
