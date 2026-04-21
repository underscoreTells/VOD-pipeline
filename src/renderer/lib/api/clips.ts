import type {
  BatchUpdateClipsResult,
  CreateClipInput,
  CreateClipResult,
  DeleteClipResult,
  GetClipsResult,
  SuggestClipNameParams,
  SuggestClipNameResult,
  UpdateClipResult,
} from '../../../shared/contracts/electron-api.js';
import type { Clip } from '../../../shared/types/database.js';
import { getElectronApi } from './client.js';

export type {
  BatchUpdateClipsResult,
  CreateClipInput,
  CreateClipResult,
  DeleteClipResult,
  GetClipsResult,
  SuggestClipNameParams,
  SuggestClipNameResult,
  UpdateClipResult,
} from '../../../shared/contracts/electron-api.js';

export async function getClipsByProject(projectId: number): Promise<GetClipsResult> {
  return await getElectronApi().clips.getByProject(projectId);
}

export async function createClip(input: CreateClipInput): Promise<CreateClipResult> {
  return await getElectronApi().clips.create(input);
}

export async function updateClip(id: number, updates: Partial<Clip>): Promise<UpdateClipResult> {
  return await getElectronApi().clips.update(id, updates);
}

export async function deleteClip(id: number): Promise<DeleteClipResult> {
  return await getElectronApi().clips.delete(id);
}

export async function batchUpdateClips(
  updates: Array<{ id: number } & Partial<Clip>>
): Promise<BatchUpdateClipsResult> {
  return await getElectronApi().clips.batchUpdate(updates);
}

export async function suggestClipName(
  input: SuggestClipNameParams
): Promise<SuggestClipNameResult> {
  return await getElectronApi().clips.suggestName(input);
}
