import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ReverseProxyVariant = 'full' | 'quick';

export function getProxyDirectoryPath(): string {
  return path.join(app.getPath('userData'), 'proxies');
}

export function ensureProxyDirectory(): string {
  const proxiesDir = getProxyDirectoryPath();
  if (!fs.existsSync(proxiesDir)) {
    fs.mkdirSync(proxiesDir, { recursive: true });
  }
  return proxiesDir;
}

export function getChapterProxyPath(chapterId: number, assetId: number): string {
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_ai_proxy.mp4`);
}

export function getChapterProxyTempPath(chapterId: number, assetId: number, generationEpoch: number): string {
  return path.join(
    getProxyDirectoryPath(),
    `chapter_${chapterId}_asset_${assetId}_ai_proxy.partial.${generationEpoch}.mp4`
  );
}

export function getChapterReverseProxyPath(chapterId: number, assetId: number, variant: ReverseProxyVariant = 'full'): string {
  const suffix = variant === 'full' ? 'reverse_preview.mp4' : 'reverse_preview_quick.mp4';
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_${suffix}`);
}

export function getChapterReverseProxyTempPath(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full',
  generationEpoch?: number
): string {
  const baseName = variant === 'full'
    ? `chapter_${chapterId}_asset_${assetId}_reverse_preview.partial`
    : `chapter_${chapterId}_asset_${assetId}_reverse_preview_quick.partial`;
  if (generationEpoch === undefined) {
    return path.join(getProxyDirectoryPath(), `${baseName}.mp4`);
  }
  return path.join(getProxyDirectoryPath(), `${baseName}.${generationEpoch}.mp4`);
}

export function getChapterReverseProxyUrl(
  chapterId: number,
  assetId: number,
  variant: ReverseProxyVariant = 'full'
): string {
  if (variant === 'quick') {
    return `vod://reverse/${chapterId}/${assetId}/quick`;
  }
  return `vod://reverse/${chapterId}/${assetId}`;
}
