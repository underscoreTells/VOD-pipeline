import fs from 'node:fs';
import path from 'node:path';
import type { Asset } from '../../shared/types/database.js';
import type { AssetAvailability, ProjectAsset } from '../../shared/contracts/ipc.js';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findNearestExistingAncestor(filePath: string): Promise<string | null> {
  let currentPath = path.resolve(filePath);

  while (true) {
    if (await pathExists(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

export async function getAssetAvailability(filePath: string): Promise<AssetAvailability> {
  const exists = await pathExists(filePath);
  const checkedAt = new Date().toISOString();

  if (exists) {
    return {
      exists: true,
      issue: null,
      savedPath: filePath,
      nearestExistingAncestor: null,
      checkedAt,
    };
  }

  const nearestExistingAncestor = await findNearestExistingAncestor(filePath);
  const immediateParent = path.dirname(path.resolve(filePath));
  const issue = nearestExistingAncestor === immediateParent ? 'missing_file' : 'missing_parent';

  return {
    exists: false,
    issue,
    savedPath: filePath,
    nearestExistingAncestor,
    checkedAt,
  };
}

export async function enrichProjectAsset(asset: Asset): Promise<ProjectAsset> {
  return {
    ...asset,
    availability: await getAssetAvailability(asset.file_path),
  };
}
