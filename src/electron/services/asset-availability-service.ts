import fs from 'node:fs';
import path from 'node:path';
import type { Asset } from '../../shared/types/database.js';
import type { AssetAvailability, ProjectAsset } from '../../shared/contracts/ipc.js';

export function findNearestExistingAncestor(filePath: string): string | null {
  let currentPath = path.resolve(filePath);

  while (true) {
    if (fs.existsSync(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

export function getAssetAvailability(filePath: string): AssetAvailability {
  const exists = fs.existsSync(filePath);
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

  const nearestExistingAncestor = findNearestExistingAncestor(filePath);
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

export function enrichProjectAsset(asset: Asset): ProjectAsset {
  return {
    ...asset,
    availability: getAssetAvailability(asset.file_path),
  };
}
