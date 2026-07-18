import type {
  AddAssetResult,
  GetAssetResult,
  GetAssetsResult,
  ProxyOptions,
  DeleteAssetResult,
} from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type {
  AddAssetResult,
  GetAssetResult,
  GetAssetsResult,
  ProxyOptions,
} from '../../../shared/contracts/electron-api.js';

export async function getAssetsByProject(projectId: number): Promise<GetAssetsResult> {
  return await getElectronApi().assets.getByProject(projectId);
}

export async function getAsset(id: number): Promise<GetAssetResult> {
  return await getElectronApi().assets.get(id);
}

export async function addAsset(
  projectId: number,
  filePath: string,
  proxyOptions?: ProxyOptions
): Promise<AddAssetResult> {
  return await getElectronApi().assets.add(projectId, filePath, proxyOptions);
}

export async function deleteAsset(id: number): Promise<DeleteAssetResult> {
  return await getElectronApi().assets.delete(id);
}
