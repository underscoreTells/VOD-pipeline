import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import type {
  Asset,
  AssetMetadata,
  Chapter,
  Transcript,
  DetailedTranscript,
  CreateAssetInput,
  CreateChapterInput,
  CreateTranscriptInput,
  CreateDetailedTranscriptInput,
  Clip,
  TimelineState,
  CreateClipInput,
  UpdateClipInput,
  UpdateTimelineStateInput,
  ChatConversation,
  ChatConversationMessage,
  CreateChatConversationInput,
  CreateChatConversationMessageInput,
  UpdateChatConversationInput,
  Proxy as ProxyModel,
  CreateProxyInput,
  ChapterProxy,
  CreateChapterProxyInput,
  Suggestion,
  CreateSuggestionInput,
  UpdateSuggestionInput,
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
    { table: 'chapters', column: 'display_order', definition: 'INTEGER DEFAULT 0' },
    { table: 'suggestions', column: 'clip_id', definition: 'INTEGER REFERENCES clips(id) ON DELETE SET NULL' },
    { table: 'suggestions', column: 'action_type', definition: "TEXT DEFAULT 'create_clip'" },
    { table: 'suggestions', column: 'target_clip_id', definition: 'INTEGER REFERENCES clips(id) ON DELETE SET NULL' },
    { table: 'suggestions', column: 'action_payload_json', definition: 'TEXT' },
    { table: 'suggestions', column: 'preview_snapshot_json', definition: 'TEXT' },
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

  ensureDetailedTranscriptTable(database);
  ensureChatConversationTables(database);
  ensureChapterProxyTable(database);
}

function ensureDetailedTranscriptTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS detailed_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      window_start REAL NOT NULL,
      window_end REAL NOT NULL,
      model TEXT NOT NULL,
      compute_type TEXT NOT NULL,
      word_timestamps BOOLEAN DEFAULT 0,
      text TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      UNIQUE(chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps)
    );

    CREATE INDEX IF NOT EXISTS idx_detailed_transcripts_chapter_id
      ON detailed_transcripts(chapter_id);

    CREATE INDEX IF NOT EXISTS idx_detailed_transcripts_window
      ON detailed_transcripts(chapter_id, window_start, window_end);
  `);
}

function ensureChatConversationTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      provider TEXT,
      thread_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      thinking_markdown TEXT,
      trace_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_conversations_project_chapter
      ON chat_conversations(project_id, chapter_id);
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at
      ON chat_conversations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
      ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
      ON chat_messages(created_at);
  `);

  ensureColumn(database, 'chat_messages', 'thinking_markdown', 'TEXT');
  ensureColumn(database, 'chat_messages', 'trace_json', 'TEXT');
}

function ensureChapterProxyTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chapter_proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      preset TEXT NOT NULL CHECK(preset IN ('ai_analysis_chapter')),
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      width INTEGER,
      height INTEGER,
      framerate INTEGER,
      file_size INTEGER,
      duration REAL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'generating', 'ready', 'error')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      UNIQUE(chapter_id, asset_id, preset)
    );

    CREATE INDEX IF NOT EXISTS idx_chapter_proxies_chapter_asset
      ON chapter_proxies(chapter_id, asset_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_proxies_status
      ON chapter_proxies(status);
  `);
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

/**
 * Set database instance for testing purposes only.
 * This allows tests to inject a test database instance.
 */
export function setDatabaseForTesting(database: Database.Database | null): void {
  db = database;
  initializationPromise = null;
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
  
  const display_order = chapter.display_order ?? 0;
  
  const result = database.prepare(
    `INSERT INTO chapters (project_id, title, start_time, end_time, display_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    chapter.project_id,
    chapter.title,
    chapter.start_time,
    chapter.end_time,
    display_order,
    now
  );
  
  return {
    id: result.lastInsertRowid as number,
    project_id: chapter.project_id,
    title: chapter.title,
    start_time: chapter.start_time,
    end_time: chapter.end_time,
    display_order,
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
  const results = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, created_at FROM chapters WHERE project_id = ? ORDER BY display_order ASC, start_time ASC'
  ).all(projectId) as Chapter[];
  
  return results;
}

export async function updateChapter(
  id: number,
  updates: Partial<Pick<Chapter, 'title' | 'start_time' | 'end_time' | 'display_order'>>
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
  if (updates.display_order !== undefined) {
    fields.push('display_order = ?');
    values.push(updates.display_order);
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

function parseDetailedTranscriptSegments(raw: string): DetailedTranscript['segments_json'] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((segment, index) => {
        if (!segment || typeof segment !== 'object') return null;
        const record = segment as Record<string, unknown>;
        if (
          typeof record.start !== 'number' ||
          !Number.isFinite(record.start) ||
          typeof record.end !== 'number' ||
          !Number.isFinite(record.end) ||
          typeof record.text !== 'string'
        ) {
          return null;
        }

        const words = Array.isArray(record.words)
          ? record.words
              .map((word) => {
                if (!word || typeof word !== 'object') return null;
                const wordRecord = word as Record<string, unknown>;
                if (
                  typeof wordRecord.word !== 'string' ||
                  typeof wordRecord.start !== 'number' ||
                  !Number.isFinite(wordRecord.start) ||
                  typeof wordRecord.end !== 'number' ||
                  !Number.isFinite(wordRecord.end)
                ) {
                  return null;
                }

                return {
                  word: wordRecord.word,
                  start: wordRecord.start,
                  end: wordRecord.end,
                  probability:
                    typeof wordRecord.probability === 'number' && Number.isFinite(wordRecord.probability)
                      ? wordRecord.probability
                      : undefined,
                };
              })
              .filter((word): word is NonNullable<typeof word> => word !== null)
          : undefined;

        return {
          id: typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : index,
          start: record.start,
          end: record.end,
          text: record.text,
          words: words && words.length > 0 ? words : undefined,
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment !== null);
  } catch {
    return [];
  }
}

function mapDetailedTranscriptRow(row: {
  id: number;
  chapter_id: number;
  asset_id: number;
  window_start: number;
  window_end: number;
  model: string;
  compute_type: string;
  word_timestamps: number;
  text: string;
  segments_json: string;
  created_at: string;
}): DetailedTranscript {
  return {
    id: row.id,
    chapter_id: row.chapter_id,
    asset_id: row.asset_id,
    window_start: row.window_start,
    window_end: row.window_end,
    model: row.model,
    compute_type: row.compute_type,
    word_timestamps: Boolean(row.word_timestamps),
    text: row.text,
    segments_json: parseDetailedTranscriptSegments(row.segments_json),
    created_at: row.created_at,
  };
}

export async function getDetailedTranscriptWindow(
  chapterId: number,
  assetId: number,
  windowStart: number,
  windowEnd: number,
  model: string,
  computeType: string,
  wordTimestamps: boolean
): Promise<DetailedTranscript | null> {
  const database = await getDatabase();
  const result = database
    .prepare(
      `SELECT id, chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps, text, segments_json, created_at
       FROM detailed_transcripts
       WHERE chapter_id = ?
         AND asset_id = ?
         AND window_start = ?
         AND window_end = ?
         AND model = ?
         AND compute_type = ?
         AND word_timestamps = ?`
    )
    .get(
      chapterId,
      assetId,
      windowStart,
      windowEnd,
      model,
      computeType,
      wordTimestamps ? 1 : 0
    ) as {
    id: number;
    chapter_id: number;
    asset_id: number;
    window_start: number;
    window_end: number;
    model: string;
    compute_type: string;
    word_timestamps: number;
    text: string;
    segments_json: string;
    created_at: string;
  } | undefined;

  if (!result) return null;
  return mapDetailedTranscriptRow(result);
}

export async function upsertDetailedTranscript(
  transcript: CreateDetailedTranscriptInput
): Promise<DetailedTranscript> {
  const database = await getDatabase();

  if (transcript.window_start < 0) {
    throw new Error('Detailed transcript window_start must be >= 0');
  }
  if (transcript.window_end <= transcript.window_start) {
    throw new Error('Detailed transcript window_end must be greater than window_start');
  }

  const chapter = await getChapter(transcript.chapter_id);
  if (!chapter) {
    throw new Error(`Chapter not found: ${transcript.chapter_id}`);
  }

  const asset = await getAsset(transcript.asset_id);
  if (!asset) {
    throw new Error(`Asset not found: ${transcript.asset_id}`);
  }

  const segmentsJson = JSON.stringify(transcript.segments_json);

  database.prepare(
    `INSERT INTO detailed_transcripts (
      chapter_id,
      asset_id,
      window_start,
      window_end,
      model,
      compute_type,
      word_timestamps,
      text,
      segments_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps)
    DO UPDATE SET
      text = excluded.text,
      segments_json = excluded.segments_json,
      created_at = CURRENT_TIMESTAMP`
  ).run(
    transcript.chapter_id,
    transcript.asset_id,
    transcript.window_start,
    transcript.window_end,
    transcript.model,
    transcript.compute_type,
    transcript.word_timestamps ? 1 : 0,
    transcript.text,
    segmentsJson
  );

  const created = await getDetailedTranscriptWindow(
    transcript.chapter_id,
    transcript.asset_id,
    transcript.window_start,
    transcript.window_end,
    transcript.model,
    transcript.compute_type,
    transcript.word_timestamps
  );

  if (!created) {
    throw new Error('Failed to persist detailed transcript');
  }

  return created;
}

export async function getDetailedTranscriptsByChapter(chapterId: number): Promise<DetailedTranscript[]> {
  const database = await getDatabase();
  const results = database
    .prepare(
      `SELECT id, chapter_id, asset_id, window_start, window_end, model, compute_type, word_timestamps, text, segments_json, created_at
       FROM detailed_transcripts
       WHERE chapter_id = ?
       ORDER BY window_start ASC, window_end ASC, created_at DESC`
    )
    .all(chapterId) as Array<{
    id: number;
    chapter_id: number;
    asset_id: number;
    window_start: number;
    window_end: number;
    model: string;
    compute_type: string;
    word_timestamps: number;
    text: string;
    segments_json: string;
    created_at: string;
  }>;

  return results.map(mapDetailedTranscriptRow);
}

export async function deleteDetailedTranscriptsByChapter(chapterId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM detailed_transcripts WHERE chapter_id = ?').run(chapterId);
  return result.changes;
}

// ============================================================================
// CLIP CRUD OPERATIONS (Timeline Editor)
// ============================================================================

const VALID_CLIP_ROLES: Array<'setup' | 'escalation' | 'twist' | 'payoff' | 'transition'> = [
  'setup', 'escalation', 'twist', 'payoff', 'transition'
];

type CreateClipHistoryInput = CreateClipInput & {
  id?: number;
  created_at?: string;
};

export async function createClip(clip: CreateClipHistoryInput): Promise<Clip> {
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
  if (clip.id !== undefined && (!Number.isInteger(clip.id) || clip.id <= 0)) {
    throw new Error('Clip ID must be a positive integer when provided');
  }
  
  // Validate role if provided
  if (clip.role !== null && !VALID_CLIP_ROLES.includes(clip.role)) {
    throw new Error(`Invalid role: ${clip.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
  }
  
  const createdAt = clip.created_at ?? new Date().toISOString();

  let result: Database.RunResult;
  if (clip.id !== undefined) {
    result = database.prepare(
      `INSERT INTO clips (id, project_id, asset_id, track_index, start_time, in_point, out_point, role, description, is_essential, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      clip.id,
      clip.project_id,
      clip.asset_id,
      clip.track_index,
      clip.start_time,
      clip.in_point,
      clip.out_point,
      clip.role,
      clip.description,
      clip.is_essential ? 1 : 0,
      createdAt
    );
  } else {
    result = database.prepare(
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
      createdAt
    );
  }
  
  return {
    id: clip.id ?? (result.lastInsertRowid as number),
    project_id: clip.project_id,
    asset_id: clip.asset_id,
    track_index: clip.track_index,
    start_time: clip.start_time,
    in_point: clip.in_point,
    out_point: clip.out_point,
    role: clip.role,
    description: clip.description,
    is_essential: clip.is_essential,
    created_at: createdAt,
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

// ============================================================================
// CHAT CONVERSATION CRUD OPERATIONS
// ============================================================================

export async function createChatConversation(input: CreateChatConversationInput): Promise<ChatConversation> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  const threadId = input.thread_id?.trim() || randomUUID();
  const title = input.title?.trim() || 'New conversation';

  const result = database.prepare(
    `INSERT INTO chat_conversations (project_id, chapter_id, title, provider, thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.project_id,
    input.chapter_id,
    title,
    input.provider ?? null,
    threadId,
    now,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    project_id: input.project_id,
    chapter_id: input.chapter_id,
    title,
    provider: input.provider ?? null,
    thread_id: threadId,
    created_at: now,
    updated_at: now,
  };
}

export async function getChatConversation(id: number): Promise<ChatConversation | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, project_id, chapter_id, title, provider, thread_id, created_at, updated_at
     FROM chat_conversations
     WHERE id = ?`
  ).get(id) as ChatConversation | undefined;

  return result || null;
}

export async function getChatConversationsByChapter(projectId: number, chapterId: number): Promise<ChatConversation[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, project_id, chapter_id, title, provider, thread_id, created_at, updated_at
     FROM chat_conversations
     WHERE project_id = ? AND chapter_id = ?
     ORDER BY updated_at DESC, created_at DESC`
  ).all(projectId, chapterId) as ChatConversation[];

  return results;
}

export async function updateChatConversation(id: number, updates: UpdateChatConversationInput): Promise<boolean> {
  const database = await getDatabase();

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title.trim() || 'New conversation');
  }

  if (updates.provider !== undefined) {
    fields.push('provider = ?');
    values.push(updates.provider ?? null);
  }

  if (updates.thread_id !== undefined) {
    fields.push('thread_id = ?');
    values.push(updates.thread_id.trim() || randomUUID());
  }

  if (fields.length === 0) {
    return true;
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const result = database.prepare(
    `UPDATE chat_conversations SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteChatConversation(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function createChatMessage(input: CreateChatConversationMessageInput): Promise<ChatConversationMessage> {
  const database = await getDatabase();
  const now = new Date().toISOString();

  const result = database.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content, thinking_markdown, trace_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.conversation_id,
    input.role,
    input.content,
    input.thinking_markdown ?? null,
    input.trace_json ?? null,
    now
  );

  database.prepare(
    'UPDATE chat_conversations SET updated_at = ? WHERE id = ?'
  ).run(now, input.conversation_id);

  return {
    id: result.lastInsertRowid as number,
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    thinking_markdown: input.thinking_markdown ?? null,
    trace_json: input.trace_json ?? null,
    created_at: now,
  };
}

export async function getChatMessagesByConversation(conversationId: number): Promise<ChatConversationMessage[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, conversation_id, role, content, thinking_markdown, trace_json, created_at
     FROM chat_messages
     WHERE conversation_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(conversationId) as ChatConversationMessage[];

  return results;
}

// ============================================================================
// PROXY CRUD OPERATIONS (Phase 4: Visual AI)
// ============================================================================

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

export async function getProxyByAsset(assetId: number, preset: 'ai_analysis' = 'ai_analysis'): Promise<ProxyModel | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message, created_at FROM proxies WHERE asset_id = ? AND preset = ?'
  ).get(assetId, preset) as ProxyModel | undefined;
  
  return result || null;
}

export async function getProxiesByAsset(assetId: number): Promise<ProxyModel[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, asset_id, file_path, preset, width, height, framerate, file_size, duration, status, error_message, created_at FROM proxies WHERE asset_id = ? ORDER BY created_at DESC'
  ).all(assetId) as ProxyModel[];
  
  return results;
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
    return true; // Nothing to update
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

export async function createChapterProxy(proxy: CreateChapterProxyInput): Promise<ChapterProxy> {
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

// ============================================================================
// SUGGESTION CRUD OPERATIONS (Phase 4: Visual AI)
// ============================================================================

export async function createSuggestion(suggestion: CreateSuggestionInput): Promise<Suggestion> {
  const database = await getDatabase();

  const normalizedActionType = suggestion.action_type === 'update_clip' ? 'update_clip' : 'create_clip';
  const normalizedTargetClipId =
    normalizedActionType === 'update_clip' && typeof suggestion.target_clip_id === 'number' && Number.isFinite(suggestion.target_clip_id)
      ? suggestion.target_clip_id
      : null;
  const normalizedActionPayload =
    typeof suggestion.action_payload_json === 'string' ? suggestion.action_payload_json : null;
  const normalizedPreviewSnapshot =
    typeof suggestion.preview_snapshot_json === 'string' ? suggestion.preview_snapshot_json : null;
  
  const result = database.prepare(
    `INSERT INTO suggestions (
      chapter_id,
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    suggestion.chapter_id,
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
    action_type: normalizedActionType,
    target_clip_id: normalizedTargetClipId,
    action_payload_json: normalizedActionPayload,
    preview_snapshot_json: normalizedPreviewSnapshot,
    created_at: new Date().toISOString(),
    applied_at: null,
    clip_id: suggestion.clip_id ?? null,
  };
}

function normalizeSuggestionRecord(row: Suggestion): Suggestion {
  return {
    ...row,
    action_type: row.action_type === 'update_clip' ? 'update_clip' : 'create_clip',
    target_clip_id: typeof row.target_clip_id === 'number' && Number.isFinite(row.target_clip_id)
      ? row.target_clip_id
      : null,
    action_payload_json: typeof row.action_payload_json === 'string' ? row.action_payload_json : null,
    preview_snapshot_json: typeof row.preview_snapshot_json === 'string' ? row.preview_snapshot_json : null,
  };
}

export async function getSuggestion(id: number): Promise<Suggestion | null> {
  const database = await getDatabase();
  const result = database.prepare(
    `SELECT id, chapter_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE id = ?`
  ).get(id) as Suggestion | undefined;
  
  return result ? normalizeSuggestionRecord(result) : null;
}

export async function getSuggestionsByChapter(chapterId: number, status?: Suggestion['status']): Promise<Suggestion[]> {
  const database = await getDatabase();
  
  let query = `SELECT id, chapter_id, in_point, out_point, description, reasoning, provider,
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

export async function getSuggestionsByProvider(chapterId: number, provider: 'gemini' | 'kimi'): Promise<Suggestion[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, chapter_id, in_point, out_point, description, reasoning, provider,
            action_type, target_clip_id, action_payload_json, preview_snapshot_json,
            status, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE chapter_id = ? AND provider = ?
     ORDER BY display_order ASC`
  ).all(chapterId, provider) as Suggestion[];
  
  return results.map(normalizeSuggestionRecord);
}

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
    startTime?: number;
    role?: Clip['role'];
    description?: string | null;
    isEssential?: boolean;
  };
  update?: {
    startTime?: number;
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
    start_time: number;
    in_point: number;
    out_point: number;
    role: Clip['role'];
    description: string | null;
    is_essential: boolean;
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
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseSuggestionPreviewSnapshot(suggestion: Suggestion): SuggestionPreviewSnapshot | null {
  if (!suggestion.preview_snapshot_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(suggestion.preview_snapshot_json) as SuggestionPreviewSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (!parsed.clip || typeof parsed.clip !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function serializeSuggestionPreviewSnapshot(clip: Clip): string {
  const snapshot: SuggestionPreviewSnapshot = {
    clip: {
      id: clip.id,
      start_time: clip.start_time,
      in_point: clip.in_point,
      out_point: clip.out_point,
      role: clip.role,
      description: clip.description,
      is_essential: clip.is_essential,
    },
  };

  return JSON.stringify(snapshot);
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

  if (typeof updatePayload.startTime === 'number' && Number.isFinite(updatePayload.startTime)) {
    const localStart = clampToRange(updatePayload.startTime, 0, chapterDuration);
    updates.start_time = chapter.start_time + localStart;
  }

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

async function restoreClipFromSuggestionSnapshot(suggestion: Suggestion): Promise<ApplySuggestionResult> {
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
    start_time: snapshot.clip.start_time,
    in_point: snapshot.clip.in_point,
    out_point: snapshot.clip.out_point,
    role: snapshot.clip.role,
    description: snapshot.clip.description,
    is_essential: snapshot.clip.is_essential,
  });

  if (!restored) {
    return { success: false, error: `Failed to restore clip ${targetClip.id} from preview snapshot` };
  }

  const refreshed = await getClip(targetClip.id);
  return { success: true, clip: refreshed ?? undefined };
}

async function cleanupPendingSuggestionArtifacts(suggestion: Suggestion): Promise<ApplySuggestionResult> {
  if (suggestion.status !== 'pending') {
    return { success: true };
  }

  if (isUpdateSuggestion(suggestion)) {
    return restoreClipFromSuggestionSnapshot(suggestion);
  }

  if (suggestion.clip_id) {
    await deleteClip(suggestion.clip_id);
  }

  return { success: true };
}

interface NormalizedSuggestionClipWindow {
  inPoint: number;
  outPoint: number;
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

async function createSuggestionTimelineClip(suggestion: Suggestion, chapter: Chapter): Promise<ApplySuggestionResult> {
  const database = await getDatabase();
  const actionPayload = parseSuggestionActionPayload(suggestion);
  const createPayload = actionPayload?.create;

  const assetIds = await getAssetsForChapter(chapter.id);
  if (assetIds.length === 0) {
    return { success: false, error: 'No assets found for this chapter' };
  }

  let assetId = assetIds[0];
  if (typeof createPayload?.assetId === 'number' && assetIds.includes(createPayload.assetId)) {
    assetId = createPayload.assetId;
  }

  const asset = await getAsset(assetId);
  if (!asset) {
    return { success: false, error: 'Asset not found' };
  }

  const normalizedWindow = normalizeSuggestionClipWindow(suggestion, chapter);

  let startTime = normalizedWindow.inPoint;
  if (typeof createPayload?.startTime === 'number' && Number.isFinite(createPayload.startTime)) {
    const chapterDuration = Math.max(0.01, chapter.end_time - chapter.start_time);
    const localStart = clampToRange(createPayload.startTime, 0, chapterDuration);
    startTime = chapter.start_time + localStart;
  }

  let inPoint = normalizedWindow.inPoint;
  const outPoint = normalizedWindow.outPoint;
  const trackIndex =
    typeof createPayload?.trackIndex === 'number' && Number.isFinite(createPayload.trackIndex)
      ? createPayload.trackIndex
      : 0;

  const existingClips = await getClipsByProject(chapter.project_id);
  const trackClips = existingClips.filter((clip) => clip.track_index === trackIndex);

  const proposedEndTime = startTime + (outPoint - inPoint);
  const overlappingClips = trackClips.filter((clip) => {
    const clipStart = clip.start_time;
    const clipEnd = clip.start_time + (clip.out_point - clip.in_point);
    return startTime < clipEnd && proposedEndTime > clipStart;
  });

  if (overlappingClips.length > 0) {
    const rightmostClip = overlappingClips.reduce((latest, clip) => {
      const clipEnd = clip.start_time + (clip.out_point - clip.in_point);
      const latestEnd = latest.start_time + (latest.out_point - latest.in_point);
      return clipEnd > latestEnd ? clip : latest;
    });

    const rightmostEnd = rightmostClip.start_time + (rightmostClip.out_point - rightmostClip.in_point);
    startTime = rightmostEnd;

    const shiftAmount = startTime - normalizedWindow.inPoint;
    inPoint = normalizedWindow.inPoint + shiftAmount;
  }

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
    start_time: startTime,
    in_point: inPoint,
    out_point: outPoint,
    role: createPayload?.role ?? null,
    description: createPayload?.description ?? suggestion.description,
    is_essential: createPayload?.isEssential ?? true,
  });

  return { success: true, clip };
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

export async function cancelSuggestionPreview(id: number): Promise<CancelSuggestionPreviewResult> {
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

/**
 * Apply a suggestion and create a corresponding timeline clip
 * This is the enhanced version that actually creates the cut on the timeline
 */
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

export async function updateSuggestion(id: number, updates: UpdateSuggestionInput): Promise<boolean> {
  const database = await getDatabase();
  
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    
    // Handle applied_at based on status
    if (updates.status === 'applied') {
      fields.push('applied_at = ?');
      values.push(new Date().toISOString());
    } else {
      // Clear applied_at for any non-applied status (rejected, pending, etc.)
      fields.push('applied_at = NULL');
    }
  }
  
  if (updates.display_order !== undefined) {
    fields.push('display_order = ?');
    values.push(updates.display_order);
  }
  
  if (fields.length === 0) {
    return true; // Nothing to update
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
