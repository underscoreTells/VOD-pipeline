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
