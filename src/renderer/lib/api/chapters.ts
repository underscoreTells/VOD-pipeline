import type {
  AddAssetToChapterResult,
  CreateChapterInput,
  CreateChapterResult,
  DeleteChapterResult,
  GetChapterAssetsResult,
  GetChapterReverseProxyOptions,
  GetChapterReverseProxyResult,
  GetChaptersResult,
  LinkAssetToChapterOptions,
  UpdateChapterInput,
  UpdateChapterResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  AddAssetToChapterResult,
  CreateChapterInput,
  CreateChapterResult,
  DeleteChapterResult,
  GetChapterAssetsResult,
  GetChapterReverseProxyOptions,
  GetChapterReverseProxyResult,
  GetChaptersResult,
  LinkAssetToChapterOptions,
  UpdateChapterInput,
  UpdateChapterResult,
} from '../../../shared/contracts/electron-api.js';

export async function createChapter(input: CreateChapterInput): Promise<CreateChapterResult> {
  return await getElectronApi().chapters.create(input);
}

export async function getChaptersByProject(projectId: number): Promise<GetChaptersResult> {
  return await getElectronApi().chapters.getByProject(projectId);
}

export async function updateChapter(
  chapterId: number,
  updates: UpdateChapterInput
): Promise<UpdateChapterResult> {
  return await getElectronApi().chapters.update(chapterId, updates);
}

export async function deleteChapter(chapterId: number): Promise<DeleteChapterResult> {
  return await getElectronApi().chapters.delete(chapterId);
}

export async function addAssetToChapter(
  chapterId: number,
  assetId: number,
  options?: LinkAssetToChapterOptions
): Promise<AddAssetToChapterResult> {
  return await getElectronApi().chapters.addAsset(chapterId, assetId, options);
}

export async function getChapterAssets(chapterId: number): Promise<GetChapterAssetsResult> {
  return await getElectronApi().chapters.getAssets(chapterId);
}

export async function getChapterReverseProxy(
  chapterId: number,
  assetId: number,
  options?: GetChapterReverseProxyOptions
): Promise<GetChapterReverseProxyResult> {
  return await getElectronApi().chapters.getReverseProxy(chapterId, assetId, options);
}
