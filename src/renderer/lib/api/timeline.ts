import type {
  SaveTimelineStateResult,
  TimelineStateResult,
} from '../../../shared/contracts/electron-api.js';
import type { TimelineState } from '../../../shared/types/database.js';
import { getElectronApi } from './client.js';

export type {
  SaveTimelineStateResult,
  TimelineStateResult,
} from '../../../shared/contracts/electron-api.js';

export async function loadTimelineState(projectId: number): Promise<TimelineStateResult> {
  return await getElectronApi().timeline.loadState(projectId);
}

export async function saveTimelineState(state: TimelineState): Promise<SaveTimelineStateResult> {
  return await getElectronApi().timeline.saveState(state);
}
