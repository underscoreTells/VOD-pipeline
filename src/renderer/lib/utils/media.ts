const ASSET_PROTOCOL = 'vod';

export function buildAssetUrl(assetId: number): string {
  return `${ASSET_PROTOCOL}://asset/${assetId}`;
}
