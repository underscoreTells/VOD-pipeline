import type { ProxyProgressEvent } from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type { ProxyProgressEvent } from '../../../shared/contracts/electron-api.js';

export function onProxyProgress(callback: (data: ProxyProgressEvent) => void): () => void {
  return getElectronApi().proxies.onProgress(callback);
}
