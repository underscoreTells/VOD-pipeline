import type Database from 'better-sqlite3';

let db: Database.Database | null = null;
let initializationPromise: Promise<Database.Database> | null = null;

export function getActiveDatabase(): Database.Database | null {
  return db;
}

export function setActiveDatabase(database: Database.Database | null): void {
  db = database;
}

export function getInitializationPromise(): Promise<Database.Database> | null {
  return initializationPromise;
}

export function setInitializationPromise(
  promise: Promise<Database.Database> | null
): void {
  initializationPromise = promise;
}
