import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

let db: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'vod-pipeline.db');

  console.log('Initializing database at:', dbPath);

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  const schemaPath = path.join(__dirname, '../../database/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
    console.log('Database schema initialized successfully');
  } else {
    console.warn('Schema file not found at:', schemaPath);
  }

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

export interface Project {
  id?: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export function createProject(name: string): Project {
  const database = getDatabase();
  const now = new Date().toISOString();
  
  const result = database.prepare(
    'INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)'
  ).run(name, now, now);
  
  return {
    id: result.lastInsertRowid as number,
    name,
    created_at: now,
    updated_at: now,
  };
}

export function getProject(id: number): Project | null {
  const database = getDatabase();
  const result = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects WHERE id = ?'
  ).get(id) as Project | undefined;
  
  return result || null;
}

export function listProjects(): Project[] {
  const database = getDatabase();
  const results = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC'
  ).all() as Project[];
  
  return results;
}

export function deleteProject(id: number): boolean {
  const database = getDatabase();
  const result = database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  
  return result.changes > 0;
}

export function updateProject(id: number, name: string): boolean {
  const database = getDatabase();
  const now = new Date().toISOString();
  
  const result = database.prepare(
    'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?'
  ).run(name, now, id);
  
  return result.changes > 0;
}
