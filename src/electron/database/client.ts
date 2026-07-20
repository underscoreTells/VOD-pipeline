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
 * rolling back on any thrown error. Nested calls run inside a SAVEPOINT so a
 * nested failure rolls back only that operation's writes: callers that convert
 * a thrown abort into a failure result (e.g. the suggestion batch helpers)
 * can no longer leak partial writes into the outer transaction.
 *
 * Safe with async operations ONLY when every awaited step is DB-bound
 * (already-resolved promises + synchronous better-sqlite3 statements):
 * such continuations run as microtasks, so no other IPC handler can
 * interleave writes into the open transaction. Do not await real I/O
 * (fs, ffmpeg, network) inside `operation`.
 */
let savepointCounter = 0;

export async function withTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const database = await getDatabase();
  if (database.inTransaction) {
    const savepoint = `with_transaction_sp_${(savepointCounter += 1)}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = await operation();
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
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
