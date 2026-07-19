import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createClip,
  ensureClipsTableWithoutStartTime,
  getSchemaVersion,
  initializeDatabase,
  normalizeStoredSuggestionRangesToChapterLocal,
  reconcilePendingSuggestionPreviews,
  repairDanglingClipReferences,
  repairClipForeignKeyTables,
  setDatabaseForTesting,
  updateChapter,
  validateClipMigrationState,
} from '../../src/electron/database/index.js';
import { dropProxiesTable, ensureChapterProxyTable } from '../../src/electron/database/migrations.js';

const canUseNativeSqlite = (() => {
  try {
    const probe = new Database(':memory:');
    probe.close();
    return true;
  } catch {
    return false;
  }
})();

const describeNative = canUseNativeSqlite ? describe : describe.skip;

type SeededIds = {
  projectId: number;
  assetId: number;
  chapterId: number;
  conversationId: number;
  chatMessageId: number;
};

function readCurrentSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8');
}

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setBootstrapDbPath(dbPath: string): () => void {
  const previous = process.env.VOD_PIPELINE_DB_PATH;
  process.env.VOD_PIPELINE_DB_PATH = dbPath;

  return () => {
    if (previous === undefined) {
      delete process.env.VOD_PIPELINE_DB_PATH;
      return;
    }

    process.env.VOD_PIPELINE_DB_PATH = previous;
  };
}

function closeSqliteDatabase(database: Database.Database): void {
  if (database.open) {
    database.close();
  }
}

function getColumnNames(database: Database.Database, tableName: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

function getTableSql(database: Database.Database, tableName: string): string {
  const row = database.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`
  ).get(tableName) as { sql: string } | undefined;

  if (!row?.sql) {
    throw new Error(`Table definition not found for ${tableName}`);
  }

  return row.sql;
}

function createFinalClipsTableSql(tableName: string): string {
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

function addLegacyStartTimeColumn(database: Database.Database): void {
  database.exec(
    'ALTER TABLE clips ADD COLUMN start_time REAL NOT NULL DEFAULT 0'
  );
}

function seedProjectGraph(database: Database.Database): SeededIds {
  const projectId = database.prepare(
    'INSERT INTO projects (name) VALUES (?)'
  ).run('Migration Test Project').lastInsertRowid as number;

  const assetId = database.prepare(
    `INSERT INTO assets (project_id, file_path, file_type, duration)
     VALUES (?, ?, ?, ?)`
  ).run(projectId, '/tmp/migration-test.mp4', 'video', 3600).lastInsertRowid as number;

  const chapterId = database.prepare(
    `INSERT INTO chapters (project_id, title, start_time, end_time, display_order)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, 'Chapter', 100, 180, 0).lastInsertRowid as number;

  database.prepare(
    'INSERT INTO chapter_assets (chapter_id, asset_id) VALUES (?, ?)'
  ).run(chapterId, assetId);

  const conversationId = database.prepare(
    `INSERT INTO chat_conversations (project_id, chapter_id, title, provider, thread_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(projectId, chapterId, 'Conversation', 'gemini', 'thread-1').lastInsertRowid as number;

  const chatMessageId = database.prepare(
    `INSERT INTO chat_messages (conversation_id, role, content)
     VALUES (?, ?, ?)`
  ).run(conversationId, 'user', 'hello').lastInsertRowid as number;

  return { projectId, assetId, chapterId, conversationId, chatMessageId };
}

function seedClipReferences(
  database: Database.Database,
  ids: SeededIds
): void {
  database.prepare(
    `INSERT INTO clips (
      id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at, start_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    ids.projectId,
    ids.assetId,
    0,
    110,
    140,
    'setup',
    'Opening setup',
    1,
    '2026-04-24T00:00:00.000Z',
    110
  );

  database.prepare(
    `INSERT INTO beats (
      id, chapter_id, start_time, end_time, role, why_essential, visual_dependency,
      is_essential, display_order, user_modified, discard, sort_order, clip_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    ids.chapterId,
    110,
    140,
    'setup',
    'Introduces the premise',
    'none',
    1,
    0,
    0,
    0,
    null,
    1
  );

  database.prepare(
    `INSERT INTO suggestions (
      id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
      reasoning, provider, action_type, target_clip_id, action_payload_json,
      preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    1,
    ids.chapterId,
    ids.conversationId,
    ids.chatMessageId,
    110,
    140,
    'Keep the opening',
    'It sets up the payoff',
    'gemini',
    'update_clip',
    1,
    null,
    null,
    'pending',
    0,
    '2026-04-24T00:00:00.000Z',
    null,
    1
  );
}

function insertClip(
  database: Database.Database,
  ids: Pick<SeededIds, 'projectId' | 'assetId'>,
  clipId: number,
  inPoint: number,
  outPoint: number,
  role: 'setup' | 'escalation' | 'twist' | 'payoff' | 'transition',
  description: string
): void {
  database.prepare(
    `INSERT INTO clips (
      id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clipId,
    ids.projectId,
    ids.assetId,
    0,
    inPoint,
    outPoint,
    role,
    description,
    1,
    '2026-04-24T00:00:00.000Z'
  );
}

function createBrokenClipForeignKeys(database: Database.Database): void {
  database.exec(`
    ALTER TABLE clips RENAME TO clips_legacy_start_time;
    ${createFinalClipsTableSql('clips')};
    INSERT INTO clips (
      id,
      project_id,
      asset_id,
      track_index,
      in_point,
      out_point,
      role,
      description,
      is_essential,
      created_at
    )
    SELECT
      id,
      project_id,
      asset_id,
      track_index,
      in_point,
      out_point,
      role,
      description,
      is_essential,
      created_at
    FROM clips_legacy_start_time;
    DROP TABLE clips_legacy_start_time;
  `);
}

describeNative('database clip migration repair', () => {
  it('safely rebuilds old clips tables without rewriting child foreign keys', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-old-');
    const dbPath = path.join(tempDir, 'old.db');
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      addLegacyStartTimeColumn(database);

      const ids = seedProjectGraph(database);
      seedClipReferences(database, ids);

      ensureClipsTableWithoutStartTime(database);

      expect(getColumnNames(database, 'clips')).not.toContain('start_time');
      expect(getTableSql(database, 'beats')).toContain('REFERENCES clips(id) ON DELETE SET NULL');
      expect(getTableSql(database, 'beats')).not.toContain('clips_legacy_start_time');
      expect(getTableSql(database, 'suggestions')).toContain('REFERENCES clips(id) ON DELETE SET NULL');
      expect(getTableSql(database, 'suggestions')).not.toContain('clips_legacy_start_time');
      expect(() => validateClipMigrationState(database)).not.toThrow();
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      setDatabaseForTesting(database);
      const created = await createClip({
        project_id: ids.projectId,
        asset_id: ids.assetId,
        track_index: 0,
        in_point: 150,
        out_point: 170,
        role: 'payoff',
        description: 'New clip after migration',
        is_essential: true,
      });

      expect(created.id).toBeGreaterThan(1);
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      closeSqliteDatabase(database);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs broken beats and suggestions foreign keys during bootstrap and preserves data', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-broken-');
    const dbPath = path.join(tempDir, 'broken.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());
      addLegacyStartTimeColumn(builder);

      const ids = seedProjectGraph(builder);
      seedClipReferences(builder, ids);
      createBrokenClipForeignKeys(builder);

      expect(getTableSql(builder, 'beats')).toContain('clips_legacy_start_time');
      expect(getTableSql(builder, 'suggestions')).toContain('clips_legacy_start_time');

      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      database.pragma('foreign_keys = ON');

      expect(getColumnNames(database, 'clips')).not.toContain('start_time');
      expect(getTableSql(database, 'beats')).not.toContain('clips_legacy_start_time');
      expect(getTableSql(database, 'suggestions')).not.toContain('clips_legacy_start_time');
      expect(() => validateClipMigrationState(database)).not.toThrow();

      database.prepare(
        'UPDATE suggestions SET target_clip_id = ?, clip_id = ? WHERE id = ?'
      ).run(1, 1, 1);
      database.prepare(
        'UPDATE beats SET clip_id = ? WHERE id = ?'
      ).run(1, 1);

      const repairedSuggestion = database.prepare(
        'SELECT target_clip_id, clip_id FROM suggestions WHERE id = ?'
      ).get(1) as { target_clip_id: number | null; clip_id: number | null };
      const repairedBeat = database.prepare(
        'SELECT clip_id FROM beats WHERE id = ?'
      ).get(1) as { clip_id: number | null };

      expect(repairedSuggestion.target_clip_id).toBe(1);
      expect(repairedSuggestion.clip_id).toBe(1);
      expect(repairedBeat.clip_id).toBe(1);

      database.prepare('DELETE FROM clips WHERE id = ?').run(1);

      const clearedSuggestion = database.prepare(
        'SELECT target_clip_id, clip_id FROM suggestions WHERE id = ?'
      ).get(1) as { target_clip_id: number | null; clip_id: number | null };
      const clearedBeat = database.prepare(
        'SELECT clip_id FROM beats WHERE id = ?'
      ).get(1) as { clip_id: number | null };

      expect(clearedSuggestion.target_clip_id).toBeNull();
      expect(clearedSuggestion.clip_id).toBeNull();
      expect(clearedBeat.clip_id).toBeNull();

      closeDatabase();
      const reopened = await initializeDatabase();
      expect(() => validateClipMigrationState(reopened)).not.toThrow();
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      closeSqliteDatabase(builder);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats fresh databases as a no-op and remains idempotent across launches', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-fresh-');
    const dbPath = path.join(tempDir, 'fresh.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);

    try {
      const database = await initializeDatabase();
      expect(database.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'clips_legacy_start_time'`
      ).get()).toBeUndefined();
      expect(database.prepare(
        `SELECT name FROM sqlite_master
         WHERE sql IS NOT NULL AND sql LIKE '%clips_legacy_start_time%'`
      ).all()).toEqual([]);
      expect(() => validateClipMigrationState(database)).not.toThrow();

      closeDatabase();

      const reopened = await initializeDatabase();
      expect(() => validateClipMigrationState(reopened)).not.toThrow();
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails fast when both clips and clips_legacy_start_time tables exist', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-ambiguous-');
    const dbPath = path.join(tempDir, 'ambiguous.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');

    try {
      builder.exec(readCurrentSchema());
      builder.exec(createFinalClipsTableSql('clips_legacy_start_time'));
      closeSqliteDatabase(builder);

      await expect(initializeDatabase()).rejects.toThrow(
        /both clips and clips_legacy_start_time tables exist/i
      );
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      closeSqliteDatabase(builder);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs broken child tables directly when bootstrap wiring is bypassed', () => {
    const tempDir = createTempDir('vod-pipeline-migration-direct-');
    const dbPath = path.join(tempDir, 'direct.db');
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      addLegacyStartTimeColumn(database);

      const ids = seedProjectGraph(database);
      seedClipReferences(database, ids);
      createBrokenClipForeignKeys(database);

      repairClipForeignKeyTables(database);

      expect(getTableSql(database, 'beats')).not.toContain('clips_legacy_start_time');
      expect(getTableSql(database, 'suggestions')).not.toContain('clips_legacy_start_time');
      expect(() => validateClipMigrationState(database)).not.toThrow();
    } finally {
      closeSqliteDatabase(database);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clears dangling clip references during bootstrap validation repair', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-dangling-');
    const dbPath = path.join(tempDir, 'dangling.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());

      const ids = seedProjectGraph(builder);
      insertClip(builder, ids, 1, 110, 140, 'setup', 'Beat clip');
      insertClip(builder, ids, 2, 145, 170, 'payoff', 'Preview clip');

      builder.prepare(
        `INSERT INTO beats (
          id, chapter_id, start_time, end_time, role, why_essential, visual_dependency,
          is_essential, display_order, user_modified, discard, sort_order, clip_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        1,
        ids.chapterId,
        110,
        140,
        'setup',
        'Introduces the premise',
        'none',
        1,
        0,
        0,
        0,
        null,
        1
      );

      builder.prepare(
        `INSERT INTO suggestions (
          id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
          reasoning, provider, action_type, target_clip_id, action_payload_json,
          preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        1,
        ids.chapterId,
        ids.conversationId,
        ids.chatMessageId,
        110,
        140,
        'Revise the setup clip',
        'Tighten the setup before the payoff',
        'gemini',
        'update_clip',
        1,
        null,
        JSON.stringify({
          clip: {
            id: 1,
            in_point: 110,
            out_point: 140,
            role: 'setup',
            description: 'Beat clip',
            is_essential: true,
          },
        }),
        'pending',
        0,
        '2026-04-24T00:00:00.000Z',
        null,
        1
      );

      builder.prepare(
        `INSERT INTO suggestions (
          id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
          reasoning, provider, action_type, target_clip_id, action_payload_json,
          preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        2,
        ids.chapterId,
        ids.conversationId,
        ids.chatMessageId,
        145,
        170,
        'Create a preview clip',
        'Keep the payoff clean',
        'gemini',
        'create_clip',
        null,
        null,
        null,
        'pending',
        1,
        '2026-04-24T00:00:00.000Z',
        null,
        2
      );

      builder.pragma('foreign_keys = OFF');
      builder.prepare('DELETE FROM clips WHERE id IN (?, ?)').run(1, 2);
      builder.pragma('foreign_keys = ON');

      expect(() => validateClipMigrationState(builder)).toThrow(/clip-related foreign key issues/i);

      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      expect(() => validateClipMigrationState(database)).not.toThrow();

      const repairedBeat = database.prepare(
        'SELECT clip_id FROM beats WHERE id = ?'
      ).get(1) as { clip_id: number | null };
      const repairedUpdateSuggestion = database.prepare(
        'SELECT target_clip_id, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(1) as {
        target_clip_id: number | null;
        clip_id: number | null;
        preview_snapshot_json: string | null;
      };
      const repairedCreateSuggestion = database.prepare(
        'SELECT clip_id FROM suggestions WHERE id = ?'
      ).get(2) as { clip_id: number | null };

      expect(repairedBeat.clip_id).toBeNull();
      expect(repairedUpdateSuggestion.target_clip_id).toBeNull();
      expect(repairedUpdateSuggestion.clip_id).toBeNull();
      expect(repairedUpdateSuggestion.preview_snapshot_json).toBeNull();
      expect(repairedCreateSuggestion.clip_id).toBeNull();
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      closeSqliteDatabase(builder);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs dangling clip references directly when bootstrap wiring is bypassed', () => {
    const tempDir = createTempDir('vod-pipeline-migration-dangling-direct-');
    const dbPath = path.join(tempDir, 'dangling-direct.db');
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());

      const ids = seedProjectGraph(database);
      insertClip(database, ids, 1, 110, 140, 'setup', 'Beat clip');

      database.prepare(
        `INSERT INTO beats (
          id, chapter_id, start_time, end_time, role, why_essential, visual_dependency,
          is_essential, display_order, user_modified, discard, sort_order, clip_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        1,
        ids.chapterId,
        110,
        140,
        'setup',
        'Introduces the premise',
        'none',
        1,
        0,
        0,
        0,
        null,
        1
      );

      database.pragma('foreign_keys = OFF');
      database.prepare('DELETE FROM clips WHERE id = ?').run(1);
      database.pragma('foreign_keys = ON');

      expect(() => validateClipMigrationState(database)).toThrow(/clip-related foreign key issues/i);

      repairDanglingClipReferences(database);

      expect(database.prepare('SELECT clip_id FROM beats WHERE id = ?').get(1)).toEqual({
        clip_id: null,
      });
      expect(() => validateClipMigrationState(database)).not.toThrow();
    } finally {
      closeSqliteDatabase(database);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("dropProxiesTable removes the legacy proxies table and leaves chapter_proxies intact", () => {
    const tempDir = createTempDir("drop-proxies-table-");
    const dbPath = path.join(tempDir, "test.db");
    const database = new Database(dbPath);

    try {
      database.exec(`
        CREATE TABLE proxies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          preset TEXT NOT NULL,
          status TEXT DEFAULT 'pending'
        );
        CREATE INDEX idx_proxies_asset_id ON proxies(asset_id);
        CREATE INDEX idx_proxies_status ON proxies(status);
      `);
      ensureChapterProxyTable(database);

      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proxies'").get()
      ).toBeDefined();

      dropProxiesTable(database);

      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proxies'").get()
      ).toBeUndefined();
      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_proxies_asset_id'").get()
      ).toBeUndefined();

      expect(
        database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chapter_proxies'").get()
      ).toBeDefined();

      dropProxiesTable(database);
    } finally {
      closeSqliteDatabase(database);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describeNative('schema-version-3 pending preview reconciliation (bootstrap)', () => {
  function seedPendingCreatePreview(database: Database.Database): {
    suggestionId: number;
    clipId: number;
  } {
    const ids = seedProjectGraph(database);
    insertClip(database, ids, 1, 120, 180, 'setup', 'preview create');

    database.prepare(
      `INSERT INTO suggestions (
        id, chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
        reasoning, provider, action_type, target_clip_id, action_payload_json,
        preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      1,
      ids.chapterId,
      ids.conversationId,
      ids.chatMessageId,
      // Chapter-local range matching the 120-180 clip in the 100-180 chapter.
      20,
      80,
      'preview create',
      'reason',
      'gemini',
      'create_clip',
      null,
      JSON.stringify({ create: { trackIndex: 0, role: 'setup' } }),
      null,
      'pending',
      0,
      '2026-04-24T00:00:00.000Z',
      null,
      1
    );

    return { suggestionId: 1, clipId: 1 };
  }

  it('reconciles old pending previews and advances to the current schema during bootstrap', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-v3-');
    const dbPath = path.join(tempDir, 'v3.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());
      const { clipId } = seedPendingCreatePreview(builder);
      // Simulate a pre-v3 database: stamp user_version=2 after seeding.
      builder.pragma('user_version = 2');
      expect(builder.pragma('user_version', { simple: true })).toBe(2);
      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      expect(await getSchemaVersion(database)).toBe(6);
      expect(() => validateClipMigrationState(database)).not.toThrow();

      // The exact untouched create preview was deleted and the suggestion unlinked.
      expect(database.prepare('SELECT 1 FROM clips WHERE id = ?').get(clipId)).toBeUndefined();
      const row = database.prepare(
        'SELECT status, clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(1) as { status: string; clip_id: number | null; preview_snapshot_json: string | null };
      expect(row.status).toBe('pending');
      expect(row.clip_id).toBeNull();
      expect(row.preview_snapshot_json).toBeNull();

      closeDatabase();
      const reopened = await initializeDatabase();
      expect(await getSchemaVersion(reopened)).toBe(6);
      // Reopening must not re-reconcile and must not throw.
      expect(() => validateClipMigrationState(reopened)).not.toThrow();
      expect(
        reopened.prepare('SELECT COUNT(*) AS n FROM clips').get() as { n: number }
      ).toEqual({ n: 0 });
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('holds the schema version below 3 while a preview row fails reconciliation', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-v3-retry-');
    const dbPath = path.join(tempDir, 'v3-retry.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());
      const { clipId } = seedPendingCreatePreview(builder);
      // Simulate a pre-v3 database with a row whose reconciliation always fails.
      builder.pragma('user_version = 2');
      builder.exec(
        "CREATE TRIGGER fail_clip_delete BEFORE DELETE ON clips BEGIN SELECT RAISE(ABORT, 'forced failure'); END;"
      );
      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      // The version is held below the v3 gate so the next startup retries.
      expect(await getSchemaVersion(database)).toBe(2);
      const stuckRow = database.prepare(
        'SELECT clip_id FROM suggestions WHERE id = ?'
      ).get(1) as { clip_id: number | null };
      expect(stuckRow.clip_id).toBe(clipId);

      // Repair the data; the next bootstrap retries and advances the version.
      database.exec('DROP TRIGGER fail_clip_delete');
      closeDatabase();
      const reopened = await initializeDatabase();
      expect(await getSchemaVersion(reopened)).toBe(6);
      expect(reopened.prepare('SELECT 1 FROM clips WHERE id = ?').get(clipId)).toBeUndefined();
      const reconciledRow = reopened.prepare(
        'SELECT clip_id FROM suggestions WHERE id = ?'
      ).get(1) as { clip_id: number | null };
      expect(reconciledRow.clip_id).toBeNull();
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('stamps the current schema version on a fresh database with nothing to reconcile', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-v3-fresh-');
    const dbPath = path.join(tempDir, 'fresh.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);

    try {
      const database = await initializeDatabase();
      expect(await getSchemaVersion(database)).toBe(6);
      expect(() => validateClipMigrationState(database)).not.toThrow();
      expect(
        (database.prepare('SELECT COUNT(*) AS n FROM suggestions').get() as { n: number }).n
      ).toBe(0);
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips reconciliation when user_version is already 3', () => {
    const tempDir = createTempDir('vod-pipeline-migration-v3-skip-');
    const dbPath = path.join(tempDir, 'skip.db');
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const { clipId } = seedPendingCreatePreview(database);
      // Pretend the migration already ran: stamp version 3 with the preview still
      // present (e.g. a newer preview created after the v3 migration). The
      // reconciliation must leave it alone.
      database.pragma('user_version = 3');

      const stats = reconcilePendingSuggestionPreviews(database);
      expect(stats.skipped).toBe(true);
      expect(stats.createClipsDeleted).toBe(0);
      expect(database.prepare('SELECT 1 FROM clips WHERE id = ?').get(clipId)).toBeDefined();
      const row = database.prepare(
        'SELECT clip_id FROM suggestions WHERE id = ?'
      ).get(1) as { clip_id: number };
      expect(row.clip_id).toBe(clipId);
    } finally {
      closeSqliteDatabase(database);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describeNative('schema-version-5 suggestion range normalization', () => {
  function insertSuggestion(
    database: Database.Database,
    ids: SeededIds,
    inPoint: number,
    outPoint: number,
    options: { createdAt?: string; clipId?: number | null } = {}
  ): number {
    return database.prepare(
      `INSERT INTO suggestions (
        chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
        reasoning, provider, action_type, target_clip_id, action_payload_json,
        preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ids.chapterId,
      ids.conversationId,
      ids.chatMessageId,
      inPoint,
      outPoint,
      'cut',
      'reason',
      'gemini',
      'create_clip',
      null,
      JSON.stringify({ create: { trackIndex: 0 } }),
      null,
      'pending',
      0,
      options.createdAt ?? '2026-04-24T00:00:00.000Z',
      null,
      options.clipId ?? null
    ).lastInsertRowid as number;
  }

  function getSuggestionRange(database: Database.Database, id: number) {
    return database.prepare(
      'SELECT in_point, out_point FROM suggestions WHERE id = ?'
    ).get(id) as { in_point: number; out_point: number };
  }

  it('converts unambiguous legacy-global ranges to chapter-local during bootstrap', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-v5-');
    const dbPath = path.join(tempDir, 'v5.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());
      const ids = seedProjectGraph(builder);
      // Chapter spans 100-180, so a stored 120-150 range written before
      // chapter-local storage shipped must be a legacy global source range.
      const suggestionId = insertSuggestion(builder, ids, 120, 150, {
        createdAt: '2026-01-15T00:00:00.000Z',
      });
      expect(builder.pragma('user_version', { simple: true })).toBe(0);
      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      expect(await getSchemaVersion(database)).toBe(6);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 20, out_point: 50 });

      // A second bootstrap must not shift the range again.
      closeDatabase();
      const reopened = await initializeDatabase();
      expect(await getSchemaVersion(reopened)).toBe(6);
      expect(getSuggestionRange(reopened, suggestionId)).toEqual({ in_point: 20, out_point: 50 });
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('leaves ranges that fit the chapter duration under the chapter-local convention', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 1000 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 150, 160);

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.converted).toBe(0);
      expect(stats.rowsFailed).toBe(0);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 150, out_point: 160 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('converts legacy-global ranges that only slightly exceed the chapter duration', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // Chapter spans 100-200: a legacy-global 100.2-100.8 range is within one
      // second of the 100-second duration but still cannot be chapter-local.
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 200 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 100.2, 100.8, {
        createdAt: '2026-01-15T00:00:00.000Z',
      });

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.converted).toBe(1);
      const range = getSuggestionRange(database, suggestionId);
      expect(range.in_point).toBeCloseTo(0.2, 5);
      expect(range.out_point).toBeCloseTo(0.8, 5);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('converts in-bounds legacy-global ranges using created-at provenance', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // Chapter spans 100-1000: a legacy global 150-160 range fits the
      // 900-second duration numerically, but the pre-cutoff created_at proves
      // it uses global coordinates.
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 1000 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 150, 160, {
        createdAt: '2026-01-15T00:00:00.000Z',
      });

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.converted).toBe(1);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 50, out_point: 60 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('does not reprocess marked rows when a retried run follows a failure', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 1000 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 150, 160, {
        createdAt: '2026-01-15T00:00:00.000Z',
      });

      const first = normalizeStoredSuggestionRangesToChapterLocal(database);
      expect(first.converted).toBe(1);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 50, out_point: 60 });

      // A retry (e.g. after the version was held for a failed row) must not
      // shift the already-converted range a second time.
      const second = normalizeStoredSuggestionRangesToChapterLocal(database);
      expect(second.converted).toBe(0);
      expect(second.clampedOutOfRange).toBe(0);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 50, out_point: 60 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('derives the intended window from a materialized create preview clip', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // The preview clip records the window the preview path actually
      // produced, so it disambiguates the stored range even for rows written
      // after chapter-local storage shipped.
      const previewClipId = database.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ids.projectId, ids.assetId, 0, 120, 150, null, 'preview create', 1, '2026-04-24T00:00:00.000Z')
        .lastInsertRowid as number;
      const suggestionId = insertSuggestion(database, ids, 120, 150, { clipId: previewClipId });
      database.pragma('user_version = 4');

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.resolvedFromPreview).toBe(1);
      expect(stats.converted).toBe(0);
      expect(stats.clampedOutOfRange).toBe(0);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 20, out_point: 50 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('runs the corrective pass for version-5 databases and skips at version 6', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // A pre-cutoff global range that fits the chapter duration was left
      // unchanged by the previous v5 pass and must be revisited now.
      const suggestionId = insertSuggestion(database, ids, 120, 150, {
        createdAt: '2026-01-15T00:00:00.000Z',
      });
      database.pragma('user_version = 5');

      const first = normalizeStoredSuggestionRangesToChapterLocal(database);
      expect(first.skipped).toBe(false);
      expect(first.converted).toBe(1);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 20, out_point: 50 });

      database.pragma('user_version = 6');
      const second = normalizeStoredSuggestionRangesToChapterLocal(database);
      expect(second.skipped).toBe(true);
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('normalizes SQLite CURRENT_TIMESTAMP formats before classifying provenance', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // Chapter-local suggestion written after the cutoff in SQLite's
      // space-separated timestamp format: it must not be treated as legacy.
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 1000 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 120, 150, {
        createdAt: '2026-02-14 23:30:00',
      });

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.converted).toBe(0);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 120, out_point: 150 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('clamps out-of-range rows written after chapter-local storage shipped', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      // Chapter-local 70-80 became out of range after the chapter bounds
      // changed to 100-160; written after chapter-local storage shipped, it
      // must be clamped, not shifted.
      database.prepare('UPDATE chapters SET start_time = 100, end_time = 160 WHERE id = ?').run(ids.chapterId);
      const suggestionId = insertSuggestion(database, ids, 70, 80);

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.converted).toBe(0);
      expect(stats.clampedOutOfRange).toBe(1);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 60, out_point: 60 });
    } finally {
      closeSqliteDatabase(database);
    }
  });

  it('reconciles a legacy preview before normalizing its range during bootstrap', async () => {
    const tempDir = createTempDir('vod-pipeline-migration-v3v5-');
    const dbPath = path.join(tempDir, 'v3v5.db');
    const restoreDbPath = setBootstrapDbPath(dbPath);
    const builder = new Database(dbPath);
    builder.pragma('journal_mode = WAL');
    builder.pragma('foreign_keys = ON');

    try {
      builder.exec(readCurrentSchema());
      const ids = seedProjectGraph(builder);
      // Legacy-global pending preview: stored range 120-150 with the
      // materialized clip at the same global window in the 100-180 chapter.
      const previewClipId = builder.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ids.projectId, ids.assetId, 0, 120, 150, null, 'cut', 1, '2026-01-15T00:00:00.000Z')
        .lastInsertRowid as number;
      const suggestionId = insertSuggestion(builder, ids, 120, 150, {
        createdAt: '2026-01-15T00:00:00.000Z',
        clipId: previewClipId,
      });
      builder.pragma('user_version = 2');
      closeSqliteDatabase(builder);

      const database = await initializeDatabase();
      expect(await getSchemaVersion(database)).toBe(6);
      // The reconciliation recognized the preview via its legacy-global
      // interpretation and removed it before the range was normalized.
      expect(database.prepare('SELECT 1 FROM clips WHERE id = ?').get(previewClipId)).toBeUndefined();
      const row = database.prepare(
        'SELECT in_point, out_point, clip_id FROM suggestions WHERE id = ?'
      ).get(suggestionId) as { in_point: number; out_point: number; clip_id: number | null };
      expect(row.clip_id).toBeNull();
      expect(row).toMatchObject({ in_point: 20, out_point: 50 });
    } finally {
      closeDatabase();
      setDatabaseForTesting(null);
      restoreDbPath();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('restores only the base snapshot when update previews share a target clip', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      setDatabaseForTesting(database);

      const targetClipId = database.prepare(
        `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ids.projectId, ids.assetId, 0, 140, 160, 'setup', 'second edit', 1, '2026-04-24T00:00:00.000Z')
        .lastInsertRowid as number;

      const insertUpdatePreview = (snapshot: { in: number; out: number; description: string }) =>
        database.prepare(
          `INSERT INTO suggestions (
            chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
            reasoning, provider, action_type, target_clip_id, action_payload_json,
            preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ids.chapterId, ids.conversationId, ids.chatMessageId, 10, 20, 'preview update', 'reason',
          'gemini', 'update_clip', targetClipId, JSON.stringify({ update: { outPoint: 60 } }),
          JSON.stringify({
            clip: {
              id: targetClipId,
              in_point: snapshot.in,
              out_point: snapshot.out,
              role: 'setup',
              description: snapshot.description,
              is_essential: true,
            },
          }),
          'pending', 0, '2026-04-24T00:00:00.000Z', null, targetClipId
        ).lastInsertRowid as number;

      // The clip went A (base) -> B -> current; only A may be restored.
      const olderSuggestionId = insertUpdatePreview({ in: 110, out: 170, description: 'base state' });
      const newerSuggestionId = insertUpdatePreview({ in: 120, out: 165, description: 'first edit' });

      await updateChapter(ids.chapterId, { start_time: 50, end_time: 120 });

      const clip = database.prepare(
        'SELECT in_point, out_point, description FROM clips WHERE id = ?'
      ).get(targetClipId) as { in_point: number; out_point: number; description: string };
      expect(clip).toEqual({ in_point: 110, out_point: 170, description: 'base state' });

      for (const suggestionId of [olderSuggestionId, newerSuggestionId]) {
        const row = database.prepare(
          'SELECT clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
        ).get(suggestionId) as { clip_id: number | null; preview_snapshot_json: string | null };
        expect(row.clip_id).toBeNull();
        expect(row.preview_snapshot_json).toBeNull();
      }
    } finally {
      setDatabaseForTesting(null);
      closeSqliteDatabase(database);
    }
  });

  it('clamps chapter-local suggestion ranges when chapter bounds shrink', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      setDatabaseForTesting(database);
      const suggestionId = insertSuggestion(database, ids, 70.2, 70.8);

      const updated = await updateChapter(ids.chapterId, { start_time: 50, end_time: 120 });
      expect(updated).toBe(true);

      // The new duration is 70, so the previously in-range local window is
      // clamped back into bounds instead of being stranded out of range.
      const range = getSuggestionRange(database, suggestionId);
      expect(range.in_point).toBeCloseTo(70, 5);
      expect(range.out_point).toBeCloseTo(70, 5);

      // Non-bound updates leave suggestion ranges alone.
      const unaffectedId = insertSuggestion(database, ids, 10, 20);
      await updateChapter(ids.chapterId, { title: 'Renamed' });
      expect(getSuggestionRange(database, unaffectedId)).toEqual({ in_point: 10, out_point: 20 });
    } finally {
      setDatabaseForTesting(null);
      closeSqliteDatabase(database);
    }
  });

  it('cancels materialized suggestion previews when chapter bounds change', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      setDatabaseForTesting(database);

      const insertClipRow = (inPoint: number, outPoint: number, description: string) =>
        database.prepare(
          `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(ids.projectId, ids.assetId, 0, inPoint, outPoint, 'setup', description, 1, '2026-04-24T00:00:00.000Z')
          .lastInsertRowid as number;

      const insertSuggestionRow = (values: {
        actionType: 'create_clip' | 'update_clip';
        targetClipId: number | null;
        clipId: number | null;
        snapshot: string | null;
      }) =>
        database.prepare(
          `INSERT INTO suggestions (
            chapter_id, conversation_id, chat_message_id, in_point, out_point, description,
            reasoning, provider, action_type, target_clip_id, action_payload_json,
            preview_snapshot_json, status, display_order, created_at, applied_at, clip_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          ids.chapterId, ids.conversationId, ids.chatMessageId, 20, 50, 'preview', 'reason',
          'gemini', values.actionType, values.targetClipId,
          JSON.stringify({ create: { trackIndex: 0 } }), values.snapshot, 'pending', 0,
          '2026-04-24T00:00:00.000Z', null, values.clipId
        ).lastInsertRowid as number;

      // create_clip preview: the materialized clip is linked from the suggestion.
      const previewClipId = insertClipRow(120, 150, 'preview create');
      const createSuggestionId = insertSuggestionRow({
        actionType: 'create_clip',
        targetClipId: null,
        clipId: previewClipId,
        snapshot: null,
      });

      // update_clip preview: the live clip holds speculative timing while the
      // snapshot preserves the original range.
      const targetClipId = insertClipRow(130, 160, 'speculative edit');
      const snapshot = JSON.stringify({
        clip: {
          id: targetClipId,
          in_point: 110,
          out_point: 170,
          role: 'setup',
          description: 'original timing',
          is_essential: true,
        },
      });
      const updateSuggestionId = insertSuggestionRow({
        actionType: 'update_clip',
        targetClipId,
        clipId: targetClipId,
        snapshot,
      });

      const updated = await updateChapter(ids.chapterId, { start_time: 50, end_time: 120 });
      expect(updated).toBe(true);

      // The create preview clip is deleted and both suggestions are unlinked.
      expect(database.prepare('SELECT 1 FROM clips WHERE id = ?').get(previewClipId)).toBeUndefined();
      const createRow = database.prepare(
        'SELECT clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(createSuggestionId) as { clip_id: number | null; preview_snapshot_json: string | null };
      expect(createRow.clip_id).toBeNull();
      expect(createRow.preview_snapshot_json).toBeNull();

      // The update preview clip is restored from its snapshot and unlinked.
      const restoredClip = database.prepare(
        'SELECT in_point, out_point, description FROM clips WHERE id = ?'
      ).get(targetClipId) as { in_point: number; out_point: number; description: string };
      expect(restoredClip).toEqual({ in_point: 110, out_point: 170, description: 'original timing' });
      const updateRow = database.prepare(
        'SELECT clip_id, preview_snapshot_json FROM suggestions WHERE id = ?'
      ).get(updateSuggestionId) as { clip_id: number | null; preview_snapshot_json: string | null };
      expect(updateRow.clip_id).toBeNull();
      expect(updateRow.preview_snapshot_json).toBeNull();
    } finally {
      setDatabaseForTesting(null);
      closeSqliteDatabase(database);
    }
  });

  it('skips suggestions whose chapter is missing without failing the migration', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');

    try {
      database.exec(readCurrentSchema());
      const ids = seedProjectGraph(database);
      const suggestionId = insertSuggestion(database, ids, 5000, 5100);
      database.pragma('foreign_keys = OFF');
      database.prepare('DELETE FROM chapters WHERE id = ?').run(ids.chapterId);
      database.pragma('foreign_keys = ON');

      const stats = normalizeStoredSuggestionRangesToChapterLocal(database);

      expect(stats.orphanedSkipped).toBe(1);
      expect(stats.rowsFailed).toBe(0);
      expect(stats.converted).toBe(0);
      expect(getSuggestionRange(database, suggestionId)).toEqual({ in_point: 5000, out_point: 5100 });
    } finally {
      closeSqliteDatabase(database);
    }
  });
});
