import type {
  ClearVodCutDraftResult,
  CommitVodCutInput,
  CommitVodCutResult,
  SaveVodCutDraftInput,
  VodCutDraftResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export async function saveVodCutDraft(input: SaveVodCutDraftInput): Promise<VodCutDraftResult> {
  return await getElectronApi().vodCuts.saveDraft(input);
}

export async function loadVodCutDraft(projectId: number, assetId: number): Promise<VodCutDraftResult> {
  return await getElectronApi().vodCuts.loadDraft(projectId, assetId);
}

export async function clearVodCutDraft(
  projectId: number,
  assetId: number,
): Promise<ClearVodCutDraftResult> {
  return await getElectronApi().vodCuts.clearDraft(projectId, assetId);
}

export async function commitVodCut(input: CommitVodCutInput): Promise<CommitVodCutResult> {
  return await getElectronApi().vodCuts.commit(input);
}
