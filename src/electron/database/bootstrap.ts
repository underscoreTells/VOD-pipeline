import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applySchemaStatements,
  assertNoAmbiguousLegacyClipsTable,
  ensureChapterProxyTable,
  ensureChatConversationTables,
  ensureClipsTableWithoutStartTime,
  ensureDetailedTranscriptTable,
  ensureSchemaColumns,
  repairDanglingClipReferences,
  repairClipForeignKeyTables,
  validateClipMigrationState,
} from './migrations.js';
import {
  getActiveDatabase,
  getInitializationPromise,
  setActiveDatabase,
  setInitializationPromise,
} from './state.js';

export async function initializeDatabase(): Promise<Database.Database> {
  const existingDatabase = getActiveDatabase();
  if (existingDatabase) {
    return existingDatabase;
  }

  const existingPromise = getInitializationPromise();
  if (existingPromise) {
    return await existingPromise;
  }

  const initializationPromise = (async () => {
    const configuredDbPath = process.env.VOD_PIPELINE_DB_PATH?.trim();
    let dbPath = configuredDbPath ?? '';
    let appPath: string | null = null;

    if (!dbPath) {
      const electronModule = await import('electron');
      const app = electronModule.app;
      if (!app) {
        throw new Error('Electron app is unavailable and VOD_PIPELINE_DB_PATH is not set');
      }

      const userDataPath = app.getPath('userData');
      dbPath = path.join(userDataPath, 'vod-pipeline.db');
      appPath = app.getAppPath();
    }

    console.log('Initializing database at:', dbPath);

    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');

    const modulePath = fileURLToPath(import.meta.url);
    const moduleDirname = path.dirname(modulePath);

    const possiblePaths = [
      path.join(moduleDirname, '../../database/schema.sql'),
      path.join(moduleDirname, '../../../database/schema.sql'),
      path.join(moduleDirname, '../../../../database/schema.sql'),
      ...(appPath ? [path.join(appPath, 'database/schema.sql')] : []),
    ];

    let schema: string | null = null;
    for (const schemaPath of possiblePaths) {
      if (fs.existsSync(schemaPath)) {
        schema = fs.readFileSync(schemaPath, 'utf-8');
        console.log('Database schema loaded from:', schemaPath);
        break;
      }
    }

    if (!schema) {
      console.error('Schema file not found. Tried paths:', possiblePaths);
      throw new Error('Database schema not found - cannot initialize database');
    }

    applySchemaStatements(database, schema, 'table');
    assertNoAmbiguousLegacyClipsTable(database);
    ensureClipsTableWithoutStartTime(database);
    repairClipForeignKeyTables(database);
    ensureDetailedTranscriptTable(database);
    ensureChatConversationTables(database);
    ensureChapterProxyTable(database);
    ensureSchemaColumns(database);
    repairDanglingClipReferences(database);
    applySchemaStatements(database, schema, 'index');
    validateClipMigrationState(database);
    console.log('Database schema initialized successfully');

    return database;
  })()
    .then((database) => {
      setActiveDatabase(database);
      setInitializationPromise(null);
      return database;
    })
    .catch((error) => {
      setInitializationPromise(null);
      throw error;
    });

  setInitializationPromise(initializationPromise);
  return await initializationPromise;
}

export function closeDatabase(): void {
  const database = getActiveDatabase();
  if (!database) {
    return;
  }

  database.close();
  setActiveDatabase(null);
}
