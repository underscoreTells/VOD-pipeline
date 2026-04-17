import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { generateAIProxy } from '../../pipeline/ffmpeg.js';
import { createProxy, getProxyByAsset, updateProxyMetadata, updateProxyStatus } from '../database/index.js';
import { createLogger } from '../logger.js';

const logger = createLogger('ProxyService');

function getProxyDirectoryPath(): string {
  const proxyDir = path.join(app.getPath('userData'), 'proxies');
  fs.mkdirSync(proxyDir, { recursive: true });
  return proxyDir;
}

export function getAssetProxyPath(assetId: number): string {
  return path.join(getProxyDirectoryPath(), `asset_${assetId}_ai_analysis.mp4`);
}

export async function generateAssetProxyInBackground(input: {
  assetId: number;
  sourcePath: string;
  mainWindow: BrowserWindow | null;
  encodingMode?: 'cpu' | 'gpu' | 'auto';
  quality?: 'high' | 'balanced' | 'fast';
}): Promise<void> {
  const proxyPath = getAssetProxyPath(input.assetId);
  let proxyId: number | null = null;

  try {
    const proxy = await createProxy({
      asset_id: input.assetId,
      file_path: proxyPath,
      preset: 'ai_analysis',
      width: null,
      height: null,
      framerate: null,
      file_size: null,
      duration: null,
      status: 'generating',
      error_message: null,
    });
    proxyId = proxy.id;

    const proxyMetadata = await generateAIProxy(
      input.sourcePath,
      proxyPath,
      (progress) => {
        if (input.mainWindow && !input.mainWindow.isDestroyed()) {
          input.mainWindow.webContents.send('proxy:progress', { assetId: input.assetId, progress });
        }
      },
      undefined,
      input.encodingMode ?? 'auto',
      input.quality ?? 'balanced'
    );

    await updateProxyMetadata(proxyId, {
      width: proxyMetadata.width,
      height: proxyMetadata.height,
      framerate: proxyMetadata.framerate,
      file_size: proxyMetadata.fileSize,
      duration: proxyMetadata.duration,
    });
    await updateProxyStatus(proxyId, 'ready');

    if (input.mainWindow && !input.mainWindow.isDestroyed()) {
      input.mainWindow.webContents.send('proxy:complete', { assetId: input.assetId, proxyPath });
    }
  } catch (error) {
    logger.error(`Generation failed for asset ${input.assetId}:`, error);

    if (proxyId) {
      await updateProxyStatus(proxyId, 'error', error instanceof Error ? error.message : 'Unknown error');
    } else {
      const existingProxy = await getProxyByAsset(input.assetId);
      if (existingProxy) {
        await updateProxyStatus(
          existingProxy.id,
          'error',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }

    if (input.mainWindow && !input.mainWindow.isDestroyed()) {
      input.mainWindow.webContents.send('proxy:error', {
        assetId: input.assetId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
