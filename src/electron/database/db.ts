import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

let db: Database.Database | null = null;

export async function initializeDatabase(): Promise<Database.Database> {
  if (db) {
    return db;
  }

  const { app } = await import('electron');
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'vod-pipeline.db');

  console.log('Initializing database at:', dbPath);

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');

  const modulePath = fileURLToPath(import.meta.url);
  const moduleDirname = path.dirname(modulePath);

  const possiblePaths = [
    path.join(moduleDirname, '../../database/schema.sql'),
    path.join(moduleDirname, '../../../database/schema.sql'),
    path.join(app.getAppPath(), 'database/schema.sql'),
  ];

  let schema: string | null = null;
  for (const schemaPath of possiblePaths) {
    if (fs.existsSync(schemaPath)) {
      schema = fs.readFileSync(schemaPath, 'utf-8');
      console.log('Database schema loaded from:', schemaPath);
      break;
    }
  }

  if (schema) {
    db.exec(schema);
    console.log('Database schema initialized successfully');
  } else {
    console.error('Schema file not found. Tried paths:', possiblePaths);
    throw new Error('Database schema not found - cannot initialize database');
  }

  return db;
}

export async function getDatabase(): Promise<Database.Database> {
  if (!db) {
    return await initializeDatabase();
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

export async function createProject(name: string): Promise<Project> {
  const database = await getDatabase();
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

export async function getProject(id: number): Promise<Project | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects WHERE id = ?'
  ).get(id) as Project | undefined;
  
  return result || null;
}

export async function listProjects(): Promise<Project[]> {
  const database = await getDatabase();
  const results = database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC'
  ).all() as Project[];
  
  return results;
}

export async function deleteProject(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  
  return result.changes > 0;
}

export async function updateProject(id: number, name: string): Promise<boolean> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  
  const result = database.prepare(
    'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?'
  ).run(name, now, id);
  
  return result.changes > 0;
}
