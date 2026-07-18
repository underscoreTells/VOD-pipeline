import {
  getAssetsByProject,
  getAssetsForChapter,
  getChapterProxyByChapterAsset,
  getChaptersByProject,
} from '../../database/index.js';
import type { ProxyOptions } from '../../../shared/contracts/electron-api.js';
import {
  getReusableChapterProxy,
  recoverChapterProxyIfCurrent,
  scheduleChapterMediaPrewarm,
} from './chapter-proxies.js';

export async function scheduleProjectProxyPrewarm(
  projectId: number,
  proxyOptions?: ProxyOptions
): Promise<{ accepted: number; skipped: number }> {
  const [chapters, assets] = await Promise.all([
    getChaptersByProject(projectId),
    getAssetsByProject(projectId),
  ]);
  const videoAssetsById = new Map(
    assets.filter((asset) => asset.file_type === 'video').map((asset) => [asset.id, asset])
  );

  const candidates = (await Promise.all(chapters.map(async (chapter) => {
    const linkedAssetIds = await getAssetsForChapter(chapter.id);
    return linkedAssetIds
      .map((assetId) => videoAssetsById.get(assetId))
      .filter((asset) => asset !== undefined)
      .map((asset) => ({ chapter, asset }));
  }))).flat();

  const reusable = await Promise.all(candidates.map(async ({ chapter, asset }) => {
    let proxy = await getChapterProxyByChapterAsset(chapter.id, asset.id);
    proxy = await recoverChapterProxyIfCurrent(proxy, chapter);
    return Boolean(await getReusableChapterProxy(proxy, chapter));
  }));

  let accepted = 0;
  let skipped = 0;
  candidates.forEach(({ chapter, asset }, index) => {
    if (reusable[index]) {
      skipped += 1;
      return;
    }

    accepted += 1;
    void scheduleChapterMediaPrewarm(chapter.id, asset.id, proxyOptions).catch((error) => {
      console.warn(
        `[ProjectPrewarm] Failed chapter=${chapter.id} asset=${asset.id}:`,
        error
      );
    });
  });

  return { accepted, skipped };
}
