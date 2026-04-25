import type {
  Clip,
  CreateClipInput,
  UpdateClipInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';
import { getAsset } from './assets.js';

const VALID_CLIP_ROLES: Array<'setup' | 'escalation' | 'twist' | 'payoff' | 'transition'> = [
  'setup',
  'escalation',
  'twist',
  'payoff',
  'transition',
];

type CreateClipHistoryInput = CreateClipInput & {
  id?: number;
  created_at?: string;
};

interface ClipRow {
  id: number;
  project_id: number;
  asset_id: number;
  track_index: number;
  in_point: number;
  out_point: number;
  role: string | null;
  description: string | null;
  is_essential: number;
  created_at: string;
}

function mapClipRow(row: ClipRow): Clip {
  return {
    ...row,
    role: row.role as Clip['role'],
    is_essential: Boolean(row.is_essential),
  };
}

export async function createClip(clip: CreateClipHistoryInput): Promise<Clip> {
  const database = await getDatabase();

  const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(clip.project_id);
  if (!project) {
    throw new Error(`Project not found: ${clip.project_id}`);
  }

  const asset = database.prepare('SELECT id FROM assets WHERE id = ?').get(clip.asset_id);
  if (!asset) {
    throw new Error(`Asset not found: ${clip.asset_id}`);
  }

  if (clip.in_point < 0) {
    throw new Error('In point must be >= 0');
  }
  if (clip.out_point <= clip.in_point) {
    throw new Error('Out point must be greater than in point');
  }
  if (clip.id !== undefined && (!Number.isInteger(clip.id) || clip.id <= 0)) {
    throw new Error('Clip ID must be a positive integer when provided');
  }
  if (clip.role !== null && !VALID_CLIP_ROLES.includes(clip.role)) {
    throw new Error(`Invalid role: ${clip.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
  }

  const createdAt = clip.created_at ?? new Date().toISOString();

  let result;
  if (clip.id !== undefined) {
    result = database.prepare(
      `INSERT INTO clips (id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      clip.id,
      clip.project_id,
      clip.asset_id,
      clip.track_index,
      clip.in_point,
      clip.out_point,
      clip.role,
      clip.description,
      clip.is_essential ? 1 : 0,
      createdAt
    );
  } else {
    result = database.prepare(
      `INSERT INTO clips (project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      clip.project_id,
      clip.asset_id,
      clip.track_index,
      clip.in_point,
      clip.out_point,
      clip.role,
      clip.description,
      clip.is_essential ? 1 : 0,
      createdAt
    );
  }

  return {
    id: clip.id ?? (result.lastInsertRowid as number),
    project_id: clip.project_id,
    asset_id: clip.asset_id,
    track_index: clip.track_index,
    in_point: clip.in_point,
    out_point: clip.out_point,
    role: clip.role,
    description: clip.description,
    is_essential: clip.is_essential,
    created_at: createdAt,
  };
}

export async function getClip(id: number): Promise<Clip | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at FROM clips WHERE id = ?'
  ).get(id) as ClipRow | undefined;

  return result ? mapClipRow(result) : null;
}

export async function getClipsByProject(projectId: number): Promise<Clip[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at
     FROM clips
     WHERE project_id = ?
     ORDER BY track_index ASC, in_point ASC, asset_id ASC, id ASC`
  ).all(projectId) as ClipRow[];

  return results.map(mapClipRow);
}

export async function getClipsByAsset(assetId: number): Promise<Clip[]> {
  const database = await getDatabase();
  const results = database.prepare(
    `SELECT id, project_id, asset_id, track_index, in_point, out_point, role, description, is_essential, created_at
     FROM clips
     WHERE asset_id = ?
     ORDER BY in_point ASC, id ASC`
  ).all(assetId) as ClipRow[];

  return results.map(mapClipRow);
}

export async function updateClip(id: number, updates: UpdateClipInput): Promise<boolean> {
  const database = await getDatabase();
  const current = await getClip(id);
  if (!current) {
    return false;
  }

  if (updates.asset_id !== undefined) {
    const asset = await getAsset(updates.asset_id);
    if (!asset) {
      throw new Error(`Asset not found: ${updates.asset_id}`);
    }
  }

  if (updates.role !== undefined && updates.role !== null && !VALID_CLIP_ROLES.includes(updates.role)) {
    throw new Error(`Invalid role: ${updates.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
  }

  const newInPoint = updates.in_point ?? current.in_point;
  const newOutPoint = updates.out_point ?? current.out_point;
  if (newInPoint < 0) {
    throw new Error('In point must be >= 0');
  }
  if (newOutPoint <= newInPoint) {
    throw new Error('Out point must be greater than in point');
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.asset_id !== undefined) {
    fields.push('asset_id = ?');
    values.push(updates.asset_id);
  }
  if (updates.track_index !== undefined) {
    fields.push('track_index = ?');
    values.push(updates.track_index);
  }
  if (updates.in_point !== undefined) {
    fields.push('in_point = ?');
    values.push(updates.in_point);
  }
  if (updates.out_point !== undefined) {
    fields.push('out_point = ?');
    values.push(updates.out_point);
  }
  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.is_essential !== undefined) {
    fields.push('is_essential = ?');
    values.push(updates.is_essential ? 1 : 0);
  }

  if (fields.length === 0) {
    return true;
  }

  values.push(id);
  const result = database.prepare(
    `UPDATE clips SET ${fields.join(', ')} WHERE id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteClip(id: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM clips WHERE id = ?').run(id);

  return result.changes > 0;
}

export async function deleteClipsByProject(projectId: number): Promise<number> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM clips WHERE project_id = ?').run(projectId);

  return result.changes;
}

export async function batchUpdateClips(
  updates: Array<{ id: number } & UpdateClipInput>
): Promise<number> {
  const database = await getDatabase();

  const transaction = database.transaction((items: typeof updates) => {
    let count = 0;
    for (const item of items) {
      const { id, ...clipUpdates } = item;
      const current = database.prepare(
        'SELECT * FROM clips WHERE id = ?'
      ).get(id) as Clip | undefined;
      if (!current) {
        continue;
      }

      if (clipUpdates.asset_id !== undefined) {
        const asset = database.prepare('SELECT id FROM assets WHERE id = ?').get(clipUpdates.asset_id);
        if (!asset) {
          throw new Error(`Asset not found: ${clipUpdates.asset_id}`);
        }
      }

      if (clipUpdates.role !== undefined && clipUpdates.role !== null && !VALID_CLIP_ROLES.includes(clipUpdates.role)) {
        throw new Error(`Invalid role: ${clipUpdates.role}. Must be one of: ${VALID_CLIP_ROLES.join(', ')}`);
      }

      const newInPoint = clipUpdates.in_point ?? current.in_point;
      const newOutPoint = clipUpdates.out_point ?? current.out_point;
      if (newInPoint < 0) {
        throw new Error('In point must be >= 0');
      }
      if (newOutPoint <= newInPoint) {
        throw new Error('Out point must be greater than in point');
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      if (clipUpdates.asset_id !== undefined) {
        fields.push('asset_id = ?');
        values.push(clipUpdates.asset_id);
      }
      if (clipUpdates.track_index !== undefined) {
        fields.push('track_index = ?');
        values.push(clipUpdates.track_index);
      }
      if (clipUpdates.in_point !== undefined) {
        fields.push('in_point = ?');
        values.push(clipUpdates.in_point);
      }
      if (clipUpdates.out_point !== undefined) {
        fields.push('out_point = ?');
        values.push(clipUpdates.out_point);
      }
      if (clipUpdates.role !== undefined) {
        fields.push('role = ?');
        values.push(clipUpdates.role);
      }
      if (clipUpdates.description !== undefined) {
        fields.push('description = ?');
        values.push(clipUpdates.description);
      }
      if (clipUpdates.is_essential !== undefined) {
        fields.push('is_essential = ?');
        values.push(clipUpdates.is_essential ? 1 : 0);
      }

      if (fields.length === 0) {
        continue;
      }

      values.push(id);
      const result = database.prepare(
        `UPDATE clips SET ${fields.join(', ')} WHERE id = ?`
      ).run(...values);

      if (result.changes > 0) {
        count += 1;
      }
    }
    return count;
  });

  return transaction(updates);
}
