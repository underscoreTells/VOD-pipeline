import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  const dbPath = require('path').join(userDataPath, 'vod-pipeline.db');

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initializeDatabase();
  }
  return db;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
