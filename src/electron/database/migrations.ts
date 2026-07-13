import type Database from 'better-sqlite3';
import { getDatabase } from './client.js';

type ForeignKeyCheckRow = {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
};

type SqliteMasterEntry = {
  type: string;
  name: string;
  sql: string | null;
};

const CLIP_MIGRATION_RELEVANT_TABLES = new Set(['clips', 'beats', 'suggestions']);

function createClipsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      track_index INTEGER DEFAULT 0,
      in_point REAL NOT NULL,
      out_point REAL NOT NULL,
      role TEXT CHECK(role IN ('setup', 'escalation', 'twist', 'payoff', 'transition')),
      description TEXT,
      is_essential BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    )
  `;
}

function createBeatsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      role TEXT NOT NULL,
      why_essential TEXT,
      visual_dependency TEXT,
      is_essential BOOLEAN DEFAULT 1,
      display_order INTEGER DEFAULT 0,
      user_modified BOOLEAN DEFAULT 0,
      discard BOOLEAN DEFAULT 0,
      sort_order INTEGER,
      clip_id INTEGER,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL
    )
  `;
}

function createSuggestionsTableSql(tableName: string): string {
  return `
    CREATE TABLE ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      conversation_id INTEGER,
      chat_message_id INTEGER,
      in_point REAL NOT NULL,
      out_point REAL NOT NULL,
      description TEXT,
      reasoning TEXT,
      provider TEXT,
      action_type TEXT DEFAULT 'create_clip' CHECK(action_type IN ('create_clip', 'update_clip')),
      target_clip_id INTEGER,
      action_payload_json TEXT,
      preview_snapshot_json TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      applied_at DATETIME,
      clip_id INTEGER,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (chat_message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (target_clip_id) REFERENCES clips(id) ON DELETE SET NULL,
      FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE SET NULL
    )
  `;
}

function withForeignKeysDisabled(
  database: Database.Database,
  callback: () => void
): void {
  const foreignKeysEnabled = database.pragma('foreign_keys', { simple: true }) === 1;
  database.pragma('foreign_keys = OFF');

  try {
    callback();
  } finally {
    database.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function tableExists(database: Database.Database, tableName: string): boolean {
  const row = database.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(tableName);

  return row !== undefined;
}

function tableHasColumn(
  database: Database.Database,
  tableName: string,
  columnName: string
): boolean {
  if (!tableExists(database, tableName)) {
    return false;
  }

  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return columns.some((column) => column.name === columnName);
}

function getTableSql(database: Database.Database, tableName: string): string | null {
  const row = database.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(tableName) as { sql: string | null } | undefined;

  return typeof row?.sql === 'string' ? row.sql : null;
}

function rebuildTable(
  database: Database.Database,
  tableName: string,
  rebuiltTableName: string,
  createTableSql: string,
  columnNames: string[]
): void {
  const columns = columnNames.join(', ');
  database.exec(`
    DROP TABLE IF EXISTS ${rebuiltTableName};
    ${createTableSql};
    INSERT INTO ${rebuiltTableName} (${columns})
    SELECT ${columns}
    FROM ${tableName};
    DROP TABLE ${tableName};
    ALTER TABLE ${rebuiltTableName} RENAME TO ${tableName};
  `);
}

function listSchemaObjectsReferencingLegacyClipsTable(
  database: Database.Database
): SqliteMasterEntry[] {
  return database.prepare(
    `SELECT type, name, sql
     FROM sqlite_master
     WHERE sql IS NOT NULL
       AND sql LIKE '%clips_legacy_start_time%'`
  ).all() as SqliteMasterEntry[];
}

export function assertNoAmbiguousLegacyClipsTable(database: Database.Database): void {
  if (!tableExists(database, 'clips_legacy_start_time')) {
    return;
  }

  if (tableExists(database, 'clips')) {
    throw new Error(
      'Database migration error: both clips and clips_legacy_start_time tables exist. ' +
      'Automatic recovery is unsafe because the authoritative clips table cannot be determined.'
    );
  }
}

/**
 * Schema revision expected by this build. Bump when schema.sql or the
 * imperative ensure* migrations change shape.
 */
export const CURRENT_SCHEMA_VERSION = 1;

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

export function ensureClipsTableWithoutStartTime(database: Database.Database): void {
  assertNoAmbiguousLegacyClipsTable(database);

  const clipColumns = database
    .prepare('PRAGMA table_info(clips)')
    .all() as Array<{ name: string }>;

  if (clipColumns.length === 0) {
    return;
  }

  const hasStartTime = clipColumns.some((column) => column.name === 'start_time');
  if (!hasStartTime) {
    return;
  }

  withForeignKeysDisabled(database, () => {
    rebuildTable(
      database,
      'clips',
      'clips_rebuilt_without_start_time',
      createClipsTableSql('clips_rebuilt_without_start_time'),
      [
        'id',
        'project_id',
        'asset_id',
        'track_index',
        'in_point',
        'out_point',
        'role',
        'description',
        'is_essential',
        'created_at',
      ]
    );
  });
}

export function repairClipForeignKeyTables(database: Database.Database): void {
  assertNoAmbiguousLegacyClipsTable(database);

  const brokenTables = ['beats', 'suggestions'].filter((tableName) => {
    const sql = getTableSql(database, tableName);
    return typeof sql === 'string' && sql.includes('clips_legacy_start_time');
  });

  if (brokenTables.length === 0) {
    return;
  }

  withForeignKeysDisabled(database, () => {
    if (brokenTables.includes('beats')) {
      rebuildTable(
        database,
        'beats',
        'beats_repaired_clip_fk',
        createBeatsTableSql('beats_repaired_clip_fk'),
        [
          'id',
          'chapter_id',
          'start_time',
          'end_time',
          'role',
          'why_essential',
          'visual_dependency',
          'is_essential',
          'display_order',
          'user_modified',
          'discard',
          'sort_order',
          'clip_id',
        ]
      );
    }

    if (brokenTables.includes('suggestions')) {
      rebuildTable(
        database,
        'suggestions',
        'suggestions_repaired_clip_fk',
        createSuggestionsTableSql('suggestions_repaired_clip_fk'),
        [
          'id',
          'chapter_id',
          'conversation_id',
          'chat_message_id',
          'in_point',
          'out_point',
          'description',
          'reasoning',
          'provider',
          'action_type',
          'target_clip_id',
          'action_payload_json',
          'preview_snapshot_json',
          'status',
          'display_order',
          'created_at',
          'applied_at',
          'clip_id',
        ]
      );
    }
  });
}

export function repairDanglingClipReferences(database: Database.Database): void {
  assertNoAmbiguousLegacyClipsTable(database);

  if (!tableExists(database, 'clips')) {
    return;
  }

  const repairs = [
    {
      tableName: 'beats',
      columnName: 'clip_id',
      updateSql: `
        UPDATE beats
        SET clip_id = NULL
        WHERE clip_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM clips
            WHERE clips.id = beats.clip_id
          )
      `,
    },
    {
      tableName: 'suggestions',
      columnName: 'target_clip_id',
      updateSql: `
        UPDATE suggestions
        SET target_clip_id = NULL
        WHERE target_clip_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM clips
            WHERE clips.id = suggestions.target_clip_id
          )
      `,
    },
    {
      tableName: 'suggestions',
      columnName: 'clip_id',
      updateSql: `
        UPDATE suggestions
        SET clip_id = NULL,
            preview_snapshot_json = NULL
        WHERE clip_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM clips
            WHERE clips.id = suggestions.clip_id
          )
      `,
    },
  ] as const;

  const clearedReferences = repairs.flatMap(({ tableName, columnName, updateSql }) => {
    if (!tableHasColumn(database, tableName, columnName)) {
      return [];
    }

    const result = database.prepare(updateSql).run();
    return result.changes > 0 ? [`${tableName}.${columnName}=${result.changes}`] : [];
  });

  if (clearedReferences.length > 0) {
    console.log(
      `Database migrated: cleared dangling clip references in ${clearedReferences.join(', ')}`
    );
  }
}

export function validateClipMigrationState(database: Database.Database): void {
  assertNoAmbiguousLegacyClipsTable(database);

  const legacyReferences = listSchemaObjectsReferencingLegacyClipsTable(database);
  if (legacyReferences.length > 0) {
    const formattedReferences = legacyReferences
      .map((entry) => `${entry.type}:${entry.name}`)
      .join(', ');

    throw new Error(
      `Database migration validation failed: legacy clips table references remain in ${formattedReferences}.`
    );
  }

  let foreignKeyViolations: ForeignKeyCheckRow[];
  try {
    foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all() as ForeignKeyCheckRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Database migration validation failed while checking clip foreign keys: ${message}`
    );
  }

  const relevantViolations = foreignKeyViolations.filter((row) =>
    CLIP_MIGRATION_RELEVANT_TABLES.has(row.table) ||
    CLIP_MIGRATION_RELEVANT_TABLES.has(row.parent)
  );

  if (relevantViolations.length === 0) {
    return;
  }

  const formattedViolations = relevantViolations
    .map((row) => `${row.table} row ${row.rowid} -> ${row.parent} (fk ${row.fkid})`)
    .join(', ');

  throw new Error(
    `Database migration validation failed due to clip-related foreign key issues: ${formattedViolations}`
  );
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

/**
 * Drop the legacy full-asset `proxies` table.
 *
 * The table was defined in `schema.sql` for a never-wired full-asset AI proxy
 * flow; only `chapter_proxies` is used at runtime. Existing databases created
 * before this refactor still carry the orphaned table, so this idempotent drop
 * cleans it up. SQLite drops associated indexes automatically.
 */
export function dropProxiesTable(database: Database.Database): void {
  database.exec(`DROP TABLE IF EXISTS proxies;`);
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
