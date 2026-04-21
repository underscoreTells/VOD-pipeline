import type { Project } from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

export type { Project } from '../../../shared/types/database.js';

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
  return database.prepare(
    'SELECT id, name, created_at, updated_at FROM projects ORDER BY created_at DESC'
  ).all() as Project[];
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
