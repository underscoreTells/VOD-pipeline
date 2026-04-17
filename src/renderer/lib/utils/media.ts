const ASSET_PROTOCOL = 'vod';

export function buildAssetUrl(assetId: number): string {
  return `${ASSET_PROTOCOL}://asset/${assetId}`;
}

export function buildPlayableAssetUrl(asset: { id: number; availability?: { exists: boolean } | null }): string {
  if (asset.availability?.exists === false) {
    return '';
  }

  return buildAssetUrl(asset.id);
}

export function looksLikeExternalStoragePath(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }

  return (
    filePath === '/mnt' ||
    filePath === '/media' ||
    filePath === '/Volumes' ||
    filePath.startsWith('/mnt/') ||
    filePath.startsWith('/media/') ||
    filePath.startsWith('/Volumes/')
  );
}
