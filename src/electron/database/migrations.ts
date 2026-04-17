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
