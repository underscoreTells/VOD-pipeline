import type Database from 'better-sqlite3';
import { getDatabase } from './client.js';

export async function getSchemaVersion(database?: Database.Database): Promise<number> {
  const activeDatabase = database ?? await getDatabase();
  const version = activeDatabase.pragma('user_version', { simple: true });
  return typeof version === 'number' ? version : 0;
}

export async function setSchemaVersion(version: number, database?: Database.Database): Promise<void> {
  const activeDatabase = database ?? await getDatabase();
  activeDatabase.pragma(`user_version = ${Math.max(0, Math.floor(version))}`);
}

export function ensureSchemaColumns(database: Database.Database): void {
  const migrations = [
    { table: 'assets', column: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { table: 'chapters', column: 'created_at', definition: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
    { table: 'chapters', column: 'display_order', definition: 'INTEGER DEFAULT 0' },
    { table: 'suggestions', column: 'conversation_id', definition: 'INTEGER REFERENCES chat_conversations(id) ON DELETE CASCADE' },
    { table: 'suggestions', column: 'chat_message_id', definition: 'INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE' },
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
      'This will cause INSERT statements to fail with "no such column" errors.'
    );
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_suggestions_conversation_id
      ON suggestions(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_suggestions_chat_message_id
      ON suggestions(chat_message_id);
  `);
}

export function ensureDetailedTranscriptTable(database: Database.Database): void {
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

export function ensureChatConversationTables(database: Database.Database): void {
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

export function ensureChapterProxyTable(database: Database.Database): void {
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

export function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): boolean {
  const columns = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  const hasColumn = columns.some((col) => col.name === column);
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

export function applySchemaStatements(
  database: Database.Database,
  schema: string,
  statementType: 'table' | 'index'
): void {
  const statements = schema
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => getSchemaStatementType(statement) === statementType);

  if (statements.length === 0) {
    return;
  }

  database.exec(`${statements.join(';\n')};`);
}

function getSchemaStatementType(statement: string): 'table' | 'index' | 'other' {
  const normalized = statement.replace(/^--.*$/gm, '').trimStart().toUpperCase();

  if (normalized.startsWith('CREATE TABLE')) {
    return 'table';
  }

  if (normalized.startsWith('CREATE INDEX')) {
    return 'index';
  }

  return 'other';
}
