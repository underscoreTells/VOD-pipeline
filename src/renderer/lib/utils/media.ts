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

export function setPitchPreservingPlaybackRate(media: HTMLMediaElement, playbackRate: number): void {
  const element = media as HTMLMediaElement & {
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  element.preservesPitch = true;
  if (typeof element.webkitPreservesPitch === 'boolean') {
    element.webkitPreservesPitch = true;
  }
  if (typeof element.mozPreservesPitch === 'boolean') {
    element.mozPreservesPitch = true;
  }
  element.playbackRate = playbackRate;
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
