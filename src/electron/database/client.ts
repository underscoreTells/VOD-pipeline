import type Database from 'better-sqlite3';
import { initializeDatabase } from './bootstrap.js';
import {
  getActiveDatabase,
  setActiveDatabase,
  setInitializationPromise,
} from './state.js';

export async function getDatabase(): Promise<Database.Database> {
  const database = getActiveDatabase();
  if (!database) {
    return await initializeDatabase();
  }

  return database;
}

/**
 * Set database instance for testing purposes only.
 * This allows tests to inject a test database instance.
 */
export function setDatabaseForTesting(database: Database.Database | null): void {
  setActiveDatabase(database);
  setInitializationPromise(null);
}

/**
 * Runs `operation` inside a database transaction, committing on success and
 * rolling back on any thrown error. Nested calls join the outer transaction.
 *
 * Safe with async operations ONLY when every awaited step is DB-bound
 * (already-resolved promises + synchronous better-sqlite3 statements):
 * such continuations run as microtasks, so no other IPC handler can
 * interleave writes into the open transaction. Do not await real I/O
 * (fs, ffmpeg, network) inside `operation`.
 */
export async function withTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const database = await getDatabase();
  if (database.inTransaction) {
    return operation();
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.inTransaction) {
      database.exec('ROLLBACK');
    }
    throw error;
  }
}
