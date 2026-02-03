const ASSET_PROTOCOL = 'vod';
export function buildAssetUrl(assetId) {
    return `${ASSET_PROTOCOL}://asset/${assetId}`;
}
