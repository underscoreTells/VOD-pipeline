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
  Clip,
  TimelineState,
  CreateClipInput,
  UpdateClipInput,
  UpdateTimelineStateInput,
} from '../../shared/types/database.js';
import type { WaveformPeak } from '../../shared/types/pipeline.js';

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
      path.join(moduleDirname, '../../../../database/schema.sql'), // Project root (dev mode)
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
      ensureSchemaColumns(database);
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

function ensureSchemaColumns(database: Database.Database) {
  const migrations = [
    { table: 'assets', column: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { table: 'chapters', column: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
  ];

  const failedMigrations: string[] = [];

  for (const { table, column, definition } of migrations) {
    const success = ensureColumn(database, table, column, definition);
    if (!success) {
      failedMigrations.push(`${table}.${column}`);
    }
  }

  if (failedMigrations.length > 0) {
    throw new Error(
      `Database schema migration failed for columns: ${failedMigrations.join(', ')}. ` +
      `This will cause INSERT statements to fail with "no such column" errors.`
    );
  }
}

function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = columns.some((col: any) => col.name === column);
  if (hasColumn) {
    return true;
  }

  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Database migrated: added ${table}.${column}`);
    return true;
  } catch (error) {
    console.error(`Database migration failed for ${table}.${column}:`, error);
    return false;
  }
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

/**
 * Replace all transcripts for a chapter atomically (delete + insert in transaction)
 */
export async function replaceTranscripts(
  chapterId: number,
  segments: Array<Omit<CreateTranscriptInput, 'chapter_id'>>
): Promise<number> {
  const database = await getDatabase();
  
  const deleteStmt = database.prepare('DELETE FROM transcripts WHERE chapter_id = ?');
  const insert = database.prepare(
    'INSERT INTO transcripts (chapter_id, text, start_time, end_time) VALUES (?, ?, ?, ?)'
  );
  
  const replaceTransaction = database.transaction((items: typeof segments) => {
    // Delete existing transcripts
    deleteStmt.run(chapterId);
    
    // Insert new transcripts
    for (const item of items) {
      insert.run(chapterId, item.text, item.start_time, item.end_time);
    }
    
    return items.length;
  });
  
  return replaceTransaction(segments);
}

// ============================================================================
// CLIP CRUD OPERATIONS (Timeline Editor)
// ============================================================================

const VALID_CLIP_ROLES: Array<'setup' | 'escalation' | 'twist' | 'payoff' | 'transition'> = [
  'setup', 'escalation', 'twist', 'payoff', 'transition'
];

export async function createClip(clip: CreateClipInput): Promise<Clip> {
  const database = await getDatabase();
  
  // Validate project exists
  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(clip.project_id);
  if (!project) {
    throw new Error(`Project not found: ${clip.project_id}`);
  }
  
  // Validate asset exists
  const asset = database.prepare('SELECT id FROM assets WHERE id = ?').get(clip.asset_id);
  if (!asset) {
    throw new Error(`Asset not found: ${clip.asset_id}`);
  }
  
  // Validate time range
  if (clip.start_time < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (clip.in_point < 0) {
    throw new Error('In point must be >= 0');
  }
  if (clip.out_point <= clip.in_point) {
    throw new Error('Out point must be greater than in point');
  }
  
  // Validate role if provided
  if (clip.role !== null && !VALID_CLIP_ROLES.includes(clip.role)) {
    throw new Error(`Invalid role: ${clip.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
  }
  
  const now = new Date().toISOString();
  
  const result = database.prepare(
    `INSERT INTO clips (project_id, asset_id, track_index, start_time, in_point, out_point, role, description, is_essential, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clip.project_id,
    clip.asset_id,
    clip.track_index,
    clip.start_time,
    clip.in_point,
    clip.out_point,
    clip.role,
    clip.description,
    clip.is_essential ? 1 : 0,
    now
  );
  
  return {
    id: result.lastInsertRowid as number,
    project_id: clip.project_id,
    asset_id: clip.asset_id,
    track_index: clip.track_index,
    start_time: clip.start_time,
    in_point: clip.in_point,
    out_point: clip.out_point,
    role: clip.role,
    description: clip.description,
    is_essential: clip.is_essential,
    created_at: now,
  };
}

export async function getClip(id: number): Promise<Clip | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, asset_id, track_index, start_time, in_point, out_point, role, description, is_essential, created_at FROM clips WHERE id = ?'
  ).get(id) as {
    id: number;
    project_id: number;
    asset_id: number;
    track_index: number;
    start_time: number;
    in_point: number;
    out_point: number;
    role: string | null;
    description: string | null;
    is_essential: number;
    created_at: string;
  } | undefined;
  
  if (!result) return null;
  
  return {
    ...result,
    role: result.role as Clip['role'],
    is_essential: Boolean(result.is_essential),
  };
}

export async function getClipsByProject(projectId: number): Promise<Clip[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, project_id, asset_id, track_index, start_time, in_point, out_point, role, description, is_essential, created_at 
     FROM clips 
     WHERE project_id = ? 
     ORDER BY track_index ASC, start_time ASC`
  ).all(projectId) as Array<{
    id: number;
    project_id: number;
    asset_id: number;
    track_index: number;
    start_time: number;
    in_point: number;
    out_point: number;
    role: string | null;
    description: string | null;
    is_essential: number;
    created_at: string;
  }>;
  
  return results.map(row => ({
    ...row,
    role: row.role as Clip['role'],
    is_essential: Boolean(row.is_essential),
  }));
}

export async function getClipsByAsset(assetId: number): Promise<Clip[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, project_id, asset_id, track_index, start_time, in_point, out_point, role, description, is_essential, created_at 
     FROM clips 
     WHERE asset_id = ? 
     ORDER BY start_time ASC`
  ).all(assetId) as Array<{
    id: number;
    project_id: number;
    asset_id: number;
    track_index: number;
    start_time: number;
    in_point: number;
    out_point: number;
    role: string | null;
    description: string | null;
    is_essential: number;
    created_at: string;
  }>;
  
  return results.map(row => ({
    ...row,
    role: row.role as Clip['role'],
    is_essential: Boolean(row.is_essential),
  }));
}

export async function updateClip(id: number, updates: UpdateClipInput): Promise<boolean> {
  const database = await getDatabase();

  // Get current clip for validation
  const current = await getClip(id);
  if (!current) {
    return false;
  }

  // Validate asset_id if provided
  if (updates.asset_id !== undefined) {
    const asset = await getAsset(updates.asset_id);
    if (!asset) {
      throw new Error(`Asset not found: ${updates.asset_id}`);
    }
  }

  // Validate role if provided
  if (updates.role !== undefined && updates.role !== null && !VALID_CLIP_ROLES.includes(updates.role)) {
    throw new Error(`Invalid role: ${updates.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
  }

  // Validate time ranges
  const newInPoint = updates.in_point ?? current.in_point;
  const newOutPoint = updates.out_point ?? current.out_point;
  const newStartTime = updates.start_time ?? current.start_time;

  if (newStartTime < 0) {
    throw new Error('Start time must be >= 0');
  }
  if (newInPoint < 0) {
    throw new Error('In point must be >= 0');
  }
  if (newOutPoint <= newInPoint) {
    throw new Error('Out point must be greater than in point');
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.asset_id !== undefined) {
    fields.push('asset_id = ?');
    values.push(updates.asset_id);
  }
  if (updates.track_index !== undefined) {
    fields.push('track_index = ?');
    values.push(updates.track_index);
  }
  if (updates.start_time !== undefined) {
    fields.push('start_time = ?');
    values.push(updates.start_time);
  }
  if (updates.in_point !== undefined) {
    fields.push('in_point = ?');
    values.push(updates.in_point);
  }
  if (updates.out_point !== undefined) {
    fields.push('out_point = ?');
    values.push(updates.out_point);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.is_essential !== undefined) {
    fields.push('is_essential = ?');
    values.push(updates.is_essential ? 1 : 0);
  }

  if (fields.length === 0) {
    return true; // Nothing to update
  }

  values.push(id);

  const result = database.prepare(
    `UPDATE clips SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteClip(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM clips WHERE id = ?').run(id);
  
  return result.changes > 0;
}

export async function deleteClipsByProject(projectId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM clips WHERE project_id = ?').run(projectId);
  
  return result.changes;
}

export async function batchUpdateClips(
  updates: Array<{ id: number } & UpdateClipInput>
): Promise<number> {
  const database = await getDatabase();

  const transaction = database.transaction((items: typeof updates) => {
    let count = 0;
    for (const item of items) {
      const { id, ...clipUpdates } = item;

      // Get current clip to validate
      const current = database.prepare('SELECT * FROM clips WHERE id = ?').get(id) as Clip | undefined;
      if (!current) continue;

      // Validate asset_id if provided
      if (clipUpdates.asset_id !== undefined) {
        const asset = database.prepare('SELECT id FROM assets WHERE id = ?').get(clipUpdates.asset_id);
        if (!asset) {
          throw new Error(`Asset not found: ${clipUpdates.asset_id}`);
        }
      }

      // Validate role if provided
      if (clipUpdates.role !== undefined && clipUpdates.role !== null && !VALID_CLIP_ROLES.includes(clipUpdates.role)) {
        throw new Error(`Invalid role: ${clipUpdates.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
      }

      // Validate time ranges
      const newStartTime = clipUpdates.start_time ?? current.start_time;
      const newInPoint = clipUpdates.in_point ?? current.in_point;
      const newOutPoint = clipUpdates.out_point ?? current.out_point;

      if (newStartTime < 0) {
        throw new Error('Start time must be >= 0');
      }
      if (newInPoint < 0) {
        throw new Error('In point must be >= 0');
      }
      if (newOutPoint <= newInPoint) {
        throw new Error('Out point must be greater than in point');
      }

      // Build dynamic update statement (only update provided fields)
      const fields: string[] = [];
      const values: unknown[] = [];

      if (clipUpdates.asset_id !== undefined) {
        fields.push('asset_id = ?');
        values.push(clipUpdates.asset_id);
      }
      if (clipUpdates.track_index !== undefined) {
        fields.push('track_index = ?');
        values.push(clipUpdates.track_index);
      }
      if (clipUpdates.start_time !== undefined) {
        fields.push('start_time = ?');
        values.push(clipUpdates.start_time);
      }
      if (clipUpdates.in_point !== undefined) {
        fields.push('in_point = ?');
        values.push(clipUpdates.in_point);
      }
      if (clipUpdates.out_point !== undefined) {
        fields.push('out_point = ?');
        values.push(clipUpdates.out_point);
      }
      if (clipUpdates.role !== undefined) {
        fields.push('role = ?');
        values.push(clipUpdates.role);
      }
      if (clipUpdates.description !== undefined) {
        fields.push('description = ?');
        values.push(clipUpdates.description);
      }
      if (clipUpdates.is_essential !== undefined) {
        fields.push('is_essential = ?');
        values.push(clipUpdates.is_essential ? 1 : 0);
      }

      if (fields.length === 0) continue; // Nothing to update

      values.push(id);

      const result = database.prepare(
        `UPDATE clips SET ${fields.join(', ')} WHERE id = ?`
      ).run(...values);

      if (result.changes > 0) count++;
    }
    return count;
  });

  return transaction(updates);
}

// ============================================================================
// TIMELINE STATE OPERATIONS
// ============================================================================

export async function saveTimelineState(state: TimelineState): Promise<TimelineState> {
  const database = await getDatabase();
  
  database.prepare(
    `INSERT OR REPLACE INTO timeline_state (project_id, zoom_level, scroll_position, playhead_time, selected_clip_ids)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    state.project_id,
    state.zoom_level,
    state.scroll_position,
    state.playhead_time,
    JSON.stringify(state.selected_clip_ids)
  );
  
  return state;
}

export async function loadTimelineState(projectId: number): Promise<TimelineState | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT project_id, zoom_level, scroll_position, playhead_time, selected_clip_ids FROM timeline_state WHERE project_id = ?'
  ).get(projectId) as {
    project_id: number;
    zoom_level: number;
    scroll_position: number;
    playhead_time: number;
    selected_clip_ids: string;
  } | undefined;
  
  if (!result) return null;
  
  return {
    ...result,
    selected_clip_ids: JSON.parse(result.selected_clip_ids || '[]'),
  };
}

export async function updateTimelineState(
  projectId: number,
  updates: UpdateTimelineStateInput
): Promise<boolean> {
  const database = await getDatabase();
  
  const current = await loadTimelineState(projectId);
  if (!current) {
    // Create new state with defaults
    const newState: TimelineState = {
      project_id: projectId,
      zoom_level: updates.zoom_level ?? 100.0,
      scroll_position: updates.scroll_position ?? 0.0,
      playhead_time: updates.playhead_time ?? 0.0,
      selected_clip_ids: updates.selected_clip_ids ?? [],
    };
    await saveTimelineState(newState);
    return true;
  }
  
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.zoom_level !== undefined) {
    fields.push('zoom_level = ?');
    values.push(updates.zoom_level);
  }
  if (updates.scroll_position !== undefined) {
    fields.push('scroll_position = ?');
    values.push(updates.scroll_position);
  }
  if (updates.playhead_time !== undefined) {
    fields.push('playhead_time = ?');
    values.push(updates.playhead_time);
  }
  if (updates.selected_clip_ids !== undefined) {
    fields.push('selected_clip_ids = ?');
    values.push(JSON.stringify(updates.selected_clip_ids));
  }
  
  if (fields.length === 0) {
    return true; // Nothing to update
  }
  
  values.push(projectId);
  
  const result = database.prepare(
    `UPDATE timeline_state SET ${fields.join(', ')} WHERE project_id = ?`
  ).run(...values);
  
  return result.changes > 0;
}

export async function deleteTimelineState(projectId: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM timeline_state WHERE project_id = ?').run(projectId);
  
  return result.changes > 0;
}

// ============================================================================
// WAVEFORM CACHE OPERATIONS
// ============================================================================

export async function saveWaveform(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3,
  peaks: WaveformPeak[],
  sampleRate: number,
  duration: number
): Promise<void> {
  const database = await getDatabase();
  
  database.prepare(
    `INSERT OR REPLACE INTO waveform_cache (asset_id, track_index, tier_level, peaks, sample_rate, duration, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assetId,
    trackIndex,
    tierLevel,
    JSON.stringify(peaks),
    sampleRate,
    duration,
    new Date().toISOString()
  );
}

export async function getWaveform(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3
): Promise<{ peaks: WaveformPeak[]; sampleRate: number; duration: number; generatedAt: string } | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT peaks, sample_rate, duration, generated_at FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
  ).get(assetId, trackIndex, tierLevel) as {
    peaks: string;
    sample_rate: number;
    duration: number;
    generated_at: string;
  } | undefined;
  
  if (!result) return null;
  
  return {
    peaks: JSON.parse(result.peaks),
    sampleRate: result.sample_rate,
    duration: result.duration,
    generatedAt: result.generated_at,
  };
}

export async function checkWaveformExists(
  assetId: number,
  trackIndex: number,
  tierLevel: 1 | 2 | 3
): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT 1 FROM waveform_cache WHERE asset_id = ? AND track_index = ? AND tier_level = ?'
  ).get(assetId, trackIndex, tierLevel);
  
  return !!result;
}

export async function deleteWaveformsByAsset(assetId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM waveform_cache WHERE asset_id = ?').run(assetId);
  
  return result.changes;
}

// ============================================================================
// WAVEFORM CACHE MAINTENANCE (LRU Eviction)
// ============================================================================

const MAX_WAVEFORM_CACHE_ENTRIES = 1000; // Maximum number of waveform entries to keep

/**
 * Get the total count of waveform cache entries
 */
export async function getWaveformCacheCount(): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('SELECT COUNT(*) as count FROM waveform_cache').get() as { count: number };
  return result.count;
}

/**
 * Clean up old waveform cache entries using LRU policy
 * Keeps the most recently generated entries, removes oldest ones
 */
export async function cleanupWaveformCache(maxEntries: number = MAX_WAVEFORM_CACHE_ENTRIES): Promise<number> {
  const database = await getDatabase();

  // Count current entries
  const countResult = database.prepare('SELECT COUNT(*) as count FROM waveform_cache').get() as { count: number };
  const currentCount = countResult.count;

  if (currentCount <= maxEntries) {
    return 0; // No cleanup needed
  }

  const entriesToDelete = currentCount - maxEntries;

  // Delete oldest entries (by generated_at timestamp) using rowid
  const result = database.prepare(
    `DELETE FROM waveform_cache
     WHERE rowid IN (
       SELECT rowid FROM waveform_cache
       ORDER BY generated_at ASC
       LIMIT ?
     )`
  ).run(entriesToDelete);

  console.log(`[Waveform Cache] Cleaned up ${result.changes} old entries. Remaining: ${currentCount - result.changes}`);
  return result.changes;
}

/**
 * Delete waveform cache entries older than specified days
 */
export async function deleteOldWaveforms(olderThanDays: number): Promise<number> {
  const database = await getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  const result = database.prepare(
    'DELETE FROM waveform_cache WHERE generated_at < ?'
  ).run(cutoffDate.toISOString());
  
  return result.changes;
}
