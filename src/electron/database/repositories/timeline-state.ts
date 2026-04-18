import type {
  TimelineState,
  UpdateTimelineStateInput,
} from '../../../shared/types/database.js';
import { getDatabase } from '../client.js';

export async function saveTimelineState(state: TimelineState): Promise<TimelineState> {
  const database = await getDatabase();
  database.prepare(
    `INSERT OR REPLACE INTO timeline_state (project_id, zoom_level, scroll_position, playhead_time, selected_clip_ids)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    state.project_id,
    state.zoom_level,
    state.scroll_position,
    state.playhead_time,
    JSON.stringify(state.selected_clip_ids)
  );

  return state;
}

export async function loadTimelineState(projectId: number): Promise<TimelineState | null> {
  const database = await getDatabase();
  const result = database.prepare(
    'SELECT project_id, zoom_level, scroll_position, playhead_time, selected_clip_ids FROM timeline_state WHERE project_id = ?'
  ).get(projectId) as {
    project_id: number;
    zoom_level: number;
    scroll_position: number;
    playhead_time: number;
    selected_clip_ids: string;
  } | undefined;

  return result
    ? {
        ...result,
        selected_clip_ids: JSON.parse(result.selected_clip_ids || '[]'),
      }
    : null;
}

export async function updateTimelineState(
  projectId: number,
  updates: UpdateTimelineStateInput
): Promise<boolean> {
  const database = await getDatabase();
  const current = await loadTimelineState(projectId);
  if (!current) {
    await saveTimelineState({
      project_id: projectId,
      zoom_level: updates.zoom_level ?? 100.0,
      scroll_position: updates.scroll_position ?? 0.0,
      playhead_time: updates.playhead_time ?? 0.0,
      selected_clip_ids: updates.selected_clip_ids ?? [],
    });
    return true;
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.zoom_level !== undefined) {
    fields.push('zoom_level = ?');
    values.push(updates.zoom_level);
  }
  if (updates.scroll_position !== undefined) {
    fields.push('scroll_position = ?');
    values.push(updates.scroll_position);
  }
  if (updates.playhead_time !== undefined) {
    fields.push('playhead_time = ?');
    values.push(updates.playhead_time);
  }
  if (updates.selected_clip_ids !== undefined) {
    fields.push('selected_clip_ids = ?');
    values.push(JSON.stringify(updates.selected_clip_ids));
  }

  if (fields.length === 0) {
    return true;
  }

  values.push(projectId);
  const result = database.prepare(
    `UPDATE timeline_state SET ${fields.join(', ')} WHERE project_id = ?`
  ).run(...values);

  return result.changes > 0;
}

export async function deleteTimelineState(projectId: number): Promise<boolean> {
  const database = await getDatabase();
  const result = database.prepare('DELETE FROM timeline_state WHERE project_id = ?').run(projectId);

  return result.changes > 0;
}
