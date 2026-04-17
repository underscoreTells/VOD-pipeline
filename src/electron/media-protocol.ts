import { app, protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { getAsset } from './database/index.js';
import { createLogger } from './logger.js';
import { getAssetAvailability } from './services/asset-availability-service.js';

const MEDIA_SCHEME = 'vod';
const logger = createLogger('MediaProtocol');

export function registerMediaProtocolScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function parseAssetId(requestUrl: string): number | null {
  try {
    const url = new URL(requestUrl);
    if (url.hostname !== 'asset') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    const assetId = Number(segments[0]);
    if (!Number.isInteger(assetId)) return null;
    return assetId;
  } catch {
    return null;
  }
}

function parseReverseProxyIds(
  requestUrl: string
): { chapterId: number; assetId: number; variant: 'full' | 'quick' } | null {
  try {
    const url = new URL(requestUrl);
    if (url.hostname !== 'reverse') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2 || segments.length > 3) return null;

    const chapterId = Number(segments[0]);
    const assetId = Number(segments[1]);
    if (!Number.isInteger(chapterId) || chapterId <= 0) return null;
    if (!Number.isInteger(assetId) || assetId <= 0) return null;

    const variant = segments[2] === 'quick' ? 'quick' : 'full';

    return { chapterId, assetId, variant };
  } catch {
    return null;
  }
}

function getProxyDirectoryPath(): string {
  const userDataPath = app.getPath('userData');
  const proxiesDir = path.join(userDataPath, 'proxies');
  if (!fs.existsSync(proxiesDir)) {
    fs.mkdirSync(proxiesDir, { recursive: true });
  }
  return proxiesDir;
}

function getChapterReverseProxyPath(chapterId: number, assetId: number, variant: 'full' | 'quick' = 'full'): string {
  const suffix = variant === 'quick' ? 'reverse_preview_quick.mp4' : 'reverse_preview.mp4';
  return path.join(getProxyDirectoryPath(), `chapter_${chapterId}_asset_${assetId}_${suffix}`);
}

function streamFileWithRange(
  request: Electron.ProtocolRequest,
  callback: (response: any) => void,
  filePath: string
) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = request.headers?.range ?? request.headers?.Range ?? request.headers?.['Range'];
  const mimeType = getMimeType(filePath);

  if (rangeHeader) {
    const rangeMatch = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!rangeMatch) {
      callback({
        statusCode: 416,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Range': `bytes */${fileSize}`,
        },
        data: Readable.from(['Invalid range']),
      });
      return;
    }

    let start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
    let end = rangeMatch[2] ? Number(rangeMatch[2]) : fileSize - 1;

    if (!rangeMatch[1] && rangeMatch[2]) {
      const suffixLength = Number(rangeMatch[2]);
      if (Number.isFinite(suffixLength)) {
        start = Math.max(fileSize - suffixLength, 0);
        end = fileSize - 1;
      }
    }

    if (end > fileSize - 1) {
      end = fileSize - 1;
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end < start) {
      callback({
        statusCode: 416,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Range': `bytes */${fileSize}`,
        },
        data: Readable.from(['Requested range not satisfiable']),
      });
      return;
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    callback({
      statusCode: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
      },
      data: stream,
    });
    return;
  }

  callback({
    statusCode: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
    },
    data: fs.createReadStream(filePath),
  });
}

export function registerMediaProtocol() {
  protocol.registerStreamProtocol(MEDIA_SCHEME, (request, callback) => {
    const respondWithError = (statusCode: number, message: string, extraHeaders: Record<string, string> = {}) => {
      callback({
        statusCode,
        headers: {
          'Content-Type': 'text/plain',
          ...extraHeaders,
        },
        data: Readable.from([message]),
      });
    };

    void (async () => {
      const reverseIds = parseReverseProxyIds(request.url);
      if (reverseIds) {
        const reverseProxyPath = getChapterReverseProxyPath(
          reverseIds.chapterId,
          reverseIds.assetId,
          reverseIds.variant
        );
        if (!fs.existsSync(reverseProxyPath)) {
          respondWithError(404, 'Reverse proxy file not found');
          return;
        }

        streamFileWithRange(request, callback, reverseProxyPath);
        return;
      }

      const assetId = parseAssetId(request.url);
      if (!assetId) {
        respondWithError(400, 'Invalid asset URL');
        return;
      }

      const asset = await getAsset(assetId);
      if (!asset) {
        respondWithError(404, 'Asset not found');
        return;
      }

      if (!fs.existsSync(asset.file_path)) {
        const availability = getAssetAvailability(asset.file_path);
        logger.warn('Asset file not found', {
          assetId,
          savedPath: asset.file_path,
          nearestExistingAncestor: availability.nearestExistingAncestor,
        });
        respondWithError(404, 'Asset file not found');
        return;
      }

      streamFileWithRange(request, callback, asset.file_path);
    })().catch((error) => {
      console.error('[Media Protocol] Failed to stream asset:', error);
      respondWithError(500, 'Failed to load asset');
    });
  });
}

function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.mkv':
      return 'video/x-matroska';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.m4v':
      return 'video/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.m4a':
      return 'audio/mp4';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}
