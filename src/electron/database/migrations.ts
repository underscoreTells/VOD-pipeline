import type Database from 'better-sqlite3';
import type { Chapter, Clip, Suggestion } from '../../shared/types/database.js';
import { getDatabase } from './client.js';
import {
  clampToRange,
  clipMatchesExpectedCreate,
  clipMatchesExpectedUpdate,
  computeExpectedCreatedClipFields,
  computeExpectedUpdatedClipFields,
  isUpdateSuggestion,
  normalizeSuggestionRecord,
  parseSuggestionPreviewSnapshotJson,
} from './repositories/suggestion-helpers.js';

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
export const CURRENT_SCHEMA_VERSION = 5;

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
    { table: 'chapters', column: 'rough_cut_completed_at', definition: 'DATETIME' },
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

export function ensureVodCutDraftTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vod_cut_drafts (
      project_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      ranges_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, asset_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );
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

// ============================================================================
// Schema-version-3 reconciliation of pending DB-backed suggestion previews
//
// Before this build, previewing a suggestion left a live clip on the timeline
// (a created clip for `create_clip`, or an in-place edit for `update_clip`)
// tracked only by `suggestions.clip_id` and `suggestions.preview_snapshot_json`.
// On restart the preview was never reconciled, so stale preview clips
// accumulated and update_preview clips kept their speculative edits.
//
// This idempotent one-time migration (gated by user_version < 3) walks every
// pending suggestion that still carries a DB-backed preview and:
//
//   create_clip, clip untouched   -> delete the preview clip, unlink the row
//   create_clip, clip diverged    -> keep the clip (user clearly edited it),
//                                    unlink the row
//   update_clip, clip untouched   -> restore the clip from preview_snapshot_json,
//                                    unlink the row
//   update_clip, clip diverged    -> keep the clip's current state, unlink the row
//   dangling clip reference       -> unlink the row
//   applied/rejected rows         -> untouched (applied stays applied)
//
// "Untouched" means the live clip still matches exactly what
// previewSuggestionWithClip would have produced from this suggestion. The
// comparison reuses the same pure helpers the preview path uses, so the
// migration cannot drift from the runtime semantics. The preview columns
// (clip_id, preview_snapshot_json) are preserved on the schema for the
// ongoing preview feature; only the stale row data is reconciled.
// ============================================================================

export interface SuggestionPreviewReconciliationStats {
  /** True when the migration skipped because user_version is already >= 3. */
  skipped: boolean;
  createClipsDeleted: number;
  createClipsPreserved: number;
  updateSnapshotsRestored: number;
  updateClipsPreserved: number;
  danglingUnlinked: number;
  /**
   * Rows whose reconciliation threw and were left untouched. When non-zero,
   * bootstrap must keep user_version below 3 so a later startup retries them.
   */
  rowsFailed: number;
}

type SuggestionRow = Suggestion;

// ============================================================================
// Schema-version-5 suggestion range normalization
//
// Older builds persisted suggestion in/out points as global source times while
// current builds persist chapter-local values. A heuristic cannot always tell
// the two apart (a legacy global range that happens to fit inside the chapter
// duration is indistinguishable from a chapter-local one), so the runtime no
// longer guesses: this idempotent one-time migration (gated by
// user_version < 5) makes the coordinate convention explicit.
//
// Provenance: chapter-local writes predate version stamping, and schema-v2
// rows were already written chapter-local, so out-of-range rows in a v2+
// database are chapter-local rows stranded by chapter bound edits — they are
// clamped back into the chapter range. Only databases older than version 2
// may hold legacy global-source rows; for those, values that cannot be
// chapter-local (beyond the chapter duration or negative, past a negligible
// floating-point epsilon) are rewritten into chapter-local coordinates. Rows
// that already fit the chapter range are left untouched, fixing the
// convention that all stored suggestion ranges are chapter-local from
// version 5 onward.
// ============================================================================

export interface SuggestionRangeNormalizationStats {
  /** True when the migration skipped because user_version is already >= 5. */
  skipped: boolean;
  /** Rows rewritten from legacy global source times to chapter-local. */
  converted: number;
  /** Chapter-local rows clamped back into bounds after chapter edits. */
  clampedOutOfRange: number;
  /** Rows skipped because their chapter no longer exists. */
  orphanedSkipped: number;
  /**
   * Rows whose conversion threw and were left untouched. When non-zero,
   * bootstrap must keep user_version below 5 so a later startup retries them.
   */
  rowsFailed: number;
}

export function normalizeStoredSuggestionRangesToChapterLocal(
  database: Database.Database
): SuggestionRangeNormalizationStats {
  const stats: SuggestionRangeNormalizationStats = {
    skipped: false,
    converted: 0,
    clampedOutOfRange: 0,
    orphanedSkipped: 0,
    rowsFailed: 0,
  };

  const currentVersion = readSchemaVersion(database);
  if (currentVersion >= 5) {
    stats.skipped = true;
    return stats;
  }

  if (!tableExists(database, 'suggestions') || !tableExists(database, 'chapters')) {
    return stats;
  }

  // Schema-v2 rows were already written chapter-local, so only databases
  // older than version 2 can contain legacy global-source ranges. In newer
  // databases an out-of-range row is a chapter-local row stranded by a
  // chapter bound edit and must be clamped, not shifted.
  const treatOutOfRangeAsLegacyGlobal = currentVersion < 2;

  const selectRows = database.prepare(
    `SELECT s.id AS suggestion_id, s.in_point AS in_point, s.out_point AS out_point,
            c.start_time AS chapter_start, c.end_time AS chapter_end
     FROM suggestions s
     LEFT JOIN chapters c ON c.id = s.chapter_id`
  );
  const updateRange = database.prepare(
    'UPDATE suggestions SET in_point = ?, out_point = ? WHERE id = ?'
  );

  interface SuggestionRangeRow {
    suggestion_id: number;
    in_point: number;
    out_point: number;
    chapter_start: number | null;
    chapter_end: number | null;
  }

  const migrate = database.transaction(() => {
    const rows = selectRows.all() as SuggestionRangeRow[];
    for (const row of rows) {
      try {
        if (
          typeof row.chapter_start !== 'number' ||
          typeof row.chapter_end !== 'number' ||
          !Number.isFinite(row.chapter_start) ||
          !Number.isFinite(row.chapter_end)
        ) {
          stats.orphanedSkipped += 1;
          continue;
        }

        const chapterDuration = Math.max(0.01, row.chapter_end - row.chapter_start);
        // Persisted chapter-local values are clamped to [0, chapterDuration]
        // by the write path, so anything outside those bounds (beyond a
        // negligible floating-point epsilon) is either a legacy global source
        // time (pre-v2 databases) or a local row stranded by a bound edit.
        const rangeEpsilon = 1e-6;
        const isOutOfRange =
          row.in_point > chapterDuration + rangeEpsilon ||
          row.out_point > chapterDuration + rangeEpsilon ||
          row.in_point < -rangeEpsilon ||
          row.out_point < -rangeEpsilon;
        if (!isOutOfRange) {
          continue;
        }

        if (treatOutOfRangeAsLegacyGlobal) {
          const localIn = clampToRange(row.in_point - row.chapter_start, 0, chapterDuration);
          const localOut = clampToRange(row.out_point - row.chapter_start, localIn, chapterDuration);
          updateRange.run(localIn, localOut, row.suggestion_id);
          stats.converted += 1;
        } else {
          const localIn = clampToRange(row.in_point, 0, chapterDuration);
          const localOut = clampToRange(row.out_point, localIn, chapterDuration);
          updateRange.run(localIn, localOut, row.suggestion_id);
          stats.clampedOutOfRange += 1;
        }
      } catch (error) {
        // Leave the row untouched; bootstrap keeps user_version below 5 while
        // rowsFailed is non-zero so a later startup retries the conversion.
        stats.rowsFailed += 1;
        console.error(
          `Database migration: skipped range normalization of suggestion ${row.suggestion_id}:`,
          error
        );
      }
    }
  });

  migrate();

  if (
    stats.converted > 0 ||
    stats.clampedOutOfRange > 0 ||
    stats.rowsFailed > 0 ||
    stats.orphanedSkipped > 0
  ) {
    console.log(
      `Database migrated: normalized suggestion ranges to chapter-local ` +
      `(converted ${stats.converted}, clamped ${stats.clampedOutOfRange}, ` +
      `orphaned skipped ${stats.orphanedSkipped}, failed ${stats.rowsFailed})`
    );
  }

  return stats;
}

interface ClipRow {
  id: number;
  project_id: number;
  asset_id: number;
  track_index: number;
  in_point: number;
  out_point: number;
  role: string | null;
  description: string | null;
  is_essential: number;
  created_at: string;
}

interface ChapterRow {
  id: number;
  project_id: number;
  title: string | null;
  start_time: number;
  end_time: number;
  display_order: number;
  created_at: string;
}

interface ChapterAssetRow {
  asset_id: number;
  file_type: string | null;
}

function mapClipRow(row: ClipRow): Clip {
  return {
    ...row,
    role: row.role as Clip['role'],
    is_essential: Boolean(row.is_essential),
  };
}

function mapChapterRow(row: ChapterRow): Chapter {
  return {
    ...row,
    title: row.title ?? '',
    rough_cut_completed_at: null,
  };
}

function readSchemaVersion(database: Database.Database): number {
  const version = database.pragma('user_version', { simple: true });
  return typeof version === 'number' ? version : 0;
}

/**
 * Idempotent schema-version-3 reconciliation of pending DB-backed suggestion
 * previews. Safe to call on every bootstrap: it is a no-op once user_version
 * reaches 3, and a second run before the version is stamped finds no pending
 * previews to reconcile because the first run already unlinked them.
 */
export function reconcilePendingSuggestionPreviews(
  database: Database.Database
): SuggestionPreviewReconciliationStats {
  const stats: SuggestionPreviewReconciliationStats = {
    skipped: false,
    createClipsDeleted: 0,
    createClipsPreserved: 0,
    updateSnapshotsRestored: 0,
    updateClipsPreserved: 0,
    danglingUnlinked: 0,
    rowsFailed: 0,
  };

  if (readSchemaVersion(database) >= 3) {
    stats.skipped = true;
    return stats;
  }

  if (!tableExists(database, 'suggestions') || !tableExists(database, 'clips')) {
    return stats;
  }

  const selectSuggestions = database.prepare(
    `SELECT id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
            reasoning, provider, action_type, target_clip_id, action_payload_json,
            preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
     FROM suggestions
     WHERE status = 'pending'
       AND (clip_id IS NOT NULL OR preview_snapshot_json IS NOT NULL)`
  );
  const selectClip = database.prepare(
    'SELECT id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at FROM clips WHERE id = ?'
  );
  const selectChapter = database.prepare(
    'SELECT id, project_id, title, start_time, end_time, display_order, created_at FROM chapters WHERE id = ?'
  );
  const selectChapterAssets = database.prepare(
    `SELECT a.id AS asset_id, a.file_type AS file_type
     FROM chapter_assets ca
     JOIN assets a ON a.id = ca.asset_id
     WHERE ca.chapter_id = ?`
  );
  const deleteClip = database.prepare('DELETE FROM clips WHERE id = ?');
  const unlinkCreateSuggestion = database.prepare(
    'UPDATE suggestions SET clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?'
  );
  const unlinkUpdateSuggestion = database.prepare(
    'UPDATE suggestions SET clip_id = NULL, preview_snapshot_json = NULL WHERE id = ?'
  );
  const restoreClipFromSnapshot = database.prepare(
    `UPDATE clips
     SET in_point = ?, out_point = ?, role = ?, description = ?, is_essential = ?
     WHERE id = ?`
  );

  const reconcile = database.transaction(() => {
    const pending = selectSuggestions.all() as SuggestionRow[];
    for (const rawRow of pending) {
      try {
        const suggestion = normalizeSuggestionRecord(rawRow);

        if (isUpdateSuggestion(suggestion)) {
          reconcileUpdateSuggestion({
            suggestion,
            stats,
            selectClip,
            selectChapter,
            unlinkUpdateSuggestion,
            restoreClipFromSnapshot,
          });
        } else {
          reconcileCreateSuggestion({
            suggestion,
            stats,
            selectClip,
            selectChapter,
            selectChapterAssets,
            deleteClip,
            unlinkCreateSuggestion,
          });
        }
      } catch (error) {
        // A single malformed row must not abort the whole migration or break
        // bootstrap. Leave the row untouched and continue with the rest; the
        // migration is idempotent and bootstrap keeps user_version below 3
        // while rowsFailed is non-zero, so a later startup retries it once
        // the data is repaired.
        stats.rowsFailed += 1;
        const suggestionId = typeof rawRow.id === 'number' ? rawRow.id : -1;
        console.error(
          `Database migration: skipped reconciliation of suggestion ${suggestionId}:`,
          error
        );
      }
    }
  });

  reconcile();

  const touched =
    stats.createClipsDeleted +
    stats.createClipsPreserved +
    stats.updateSnapshotsRestored +
    stats.updateClipsPreserved +
    stats.danglingUnlinked;
  if (touched > 0 || stats.rowsFailed > 0) {
    console.log(
      `Database migrated: reconciled pending suggestion previews ` +
      `(create deleted ${stats.createClipsDeleted}, create preserved ${stats.createClipsPreserved}, ` +
      `update restored ${stats.updateSnapshotsRestored}, update preserved ${stats.updateClipsPreserved}, ` +
      `dangling unlinked ${stats.danglingUnlinked}, failed ${stats.rowsFailed})`
    );
  }

  return stats;
}

interface ReconcileUpdateContext {
  suggestion: Suggestion;
  stats: SuggestionPreviewReconciliationStats;
  selectClip: Database.Statement;
  selectChapter: Database.Statement;
  unlinkUpdateSuggestion: Database.Statement;
  restoreClipFromSnapshot: Database.Statement;
}

function reconcileUpdateSuggestion(ctx: ReconcileUpdateContext): void {
  const { suggestion, stats, selectClip, selectChapter, unlinkUpdateSuggestion, restoreClipFromSnapshot } = ctx;

  const snapshot = parseSuggestionPreviewSnapshotJson(suggestion.preview_snapshot_json);
  const targetClipId = suggestion.target_clip_id ?? suggestion.clip_id;

  if (!targetClipId) {
    // No target clip to reconcile; just clear any stray snapshot link.
    unlinkUpdateSuggestion.run(suggestion.id);
    return;
  }

  const clipRow = selectClip.get(targetClipId) as ClipRow | undefined;
  if (!clipRow) {
    // Dangling reference: the preview clip is gone. Unlink and preserve nothing.
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.danglingUnlinked += 1;
    return;
  }

  if (!snapshot) {
    // No snapshot means we cannot prove the clip is untouched, so keep the
    // user's current clip and unlink the suggestion. This is the safe,
    // non-destructive choice.
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.updateClipsPreserved += 1;
    return;
  }

  const chapterRow = selectChapter.get(suggestion.chapter_id) as ChapterRow | undefined;
  if (!chapterRow) {
    // Cannot normalize in/out without the chapter; preserve the clip and unlink.
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.updateClipsPreserved += 1;
    return;
  }

  const chapter = mapChapterRow(chapterRow);
  const expected = computeExpectedUpdatedClipFields(suggestion, chapter, snapshot);
  if (!expected) {
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.updateClipsPreserved += 1;
    return;
  }

  const clip = mapClipRow(clipRow);
  if (clipMatchesExpectedUpdate(clip, expected)) {
    // Exact untouched preview: restore the clip to its pre-preview snapshot.
    restoreClipFromSnapshot.run(
      snapshot.clip.in_point,
      snapshot.clip.out_point,
      snapshot.clip.role,
      snapshot.clip.description,
      snapshot.clip.is_essential ? 1 : 0,
      targetClipId
    );
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.updateSnapshotsRestored += 1;
  } else {
    // Manually diverged: keep the clip's current state and unlink.
    unlinkUpdateSuggestion.run(suggestion.id);
    stats.updateClipsPreserved += 1;
  }
}

interface ReconcileCreateContext {
  suggestion: Suggestion;
  stats: SuggestionPreviewReconciliationStats;
  selectClip: Database.Statement;
  selectChapter: Database.Statement;
  selectChapterAssets: Database.Statement;
  deleteClip: Database.Statement;
  unlinkCreateSuggestion: Database.Statement;
}

function reconcileCreateSuggestion(ctx: ReconcileCreateContext): void {
  const {
    suggestion,
    stats,
    selectClip,
    selectChapter,
    selectChapterAssets,
    deleteClip,
    unlinkCreateSuggestion,
  } = ctx;

  const previewClipId = suggestion.clip_id;
  if (!previewClipId) {
    // No preview clip; just clear any stray snapshot link.
    unlinkCreateSuggestion.run(suggestion.id);
    return;
  }

  const clipRow = selectClip.get(previewClipId) as ClipRow | undefined;
  if (!clipRow) {
    // Dangling reference: preview clip is gone. Unlink the suggestion.
    unlinkCreateSuggestion.run(suggestion.id);
    stats.danglingUnlinked += 1;
    return;
  }

  const chapterRow = selectChapter.get(suggestion.chapter_id) as ChapterRow | undefined;
  if (!chapterRow) {
    // Cannot reconstruct the expected clip without the chapter; preserve and unlink.
    unlinkCreateSuggestion.run(suggestion.id);
    stats.createClipsPreserved += 1;
    return;
  }

  const chapter = mapChapterRow(chapterRow);
  const assetRows = selectChapterAssets.all(suggestion.chapter_id) as ChapterAssetRow[];
  const videoAssetIds = assetRows
    .filter((row) => row.file_type === 'video')
    .map((row) => row.asset_id);

  const expectedAssetId = resolveExpectedCreateAssetId(suggestion, videoAssetIds);
  if (expectedAssetId === null) {
    // Ambiguous or missing asset: cannot prove the clip is untouched. Preserve and unlink.
    unlinkCreateSuggestion.run(suggestion.id);
    stats.createClipsPreserved += 1;
    return;
  }

  const expected = computeExpectedCreatedClipFields(suggestion, chapter, expectedAssetId);
  if (!expected) {
    // Collapsed window: the preview path would have rejected this, so a live
    // clip here must be user-created/diverged. Preserve and unlink.
    unlinkCreateSuggestion.run(suggestion.id);
    stats.createClipsPreserved += 1;
    return;
  }

  const clip = mapClipRow(clipRow);
  if (clipMatchesExpectedCreate(clip, expected)) {
    // Exact untouched preview: delete the preview clip and unlink.
    deleteClip.run(previewClipId);
    unlinkCreateSuggestion.run(suggestion.id);
    stats.createClipsDeleted += 1;
  } else {
    // Manually diverged: keep the clip and unlink.
    unlinkCreateSuggestion.run(suggestion.id);
    stats.createClipsPreserved += 1;
  }
}

/**
 * Mirrors the asset resolution in `createSuggestionTimelineClip`: an explicit
 * payload assetId wins if it is a linked video asset; otherwise a single
 * chapter video asset is implied. Returns null when the resolution is
 * ambiguous or impossible, which makes the caller treat the preview as
 * manually diverged (the safe, non-destructive choice).
 */
function resolveExpectedCreateAssetId(
  suggestion: Suggestion,
  videoAssetIds: number[]
): number | null {
  const actionPayloadJson = suggestion.action_payload_json;
  if (typeof actionPayloadJson === 'string' && actionPayloadJson.length > 0) {
    try {
      const parsed = JSON.parse(actionPayloadJson) as { create?: { assetId?: number } };
      const payloadAssetId = parsed?.create?.assetId;
      if (typeof payloadAssetId === 'number' && Number.isFinite(payloadAssetId)) {
        if (videoAssetIds.includes(payloadAssetId)) {
          return payloadAssetId;
        }
        return null;
      }
    } catch {
      // Fall through to single-asset resolution.
    }
  }

  if (videoAssetIds.length === 1) {
    return videoAssetIds[0] ?? null;
  }
  return null;
}
