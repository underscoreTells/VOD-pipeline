import type { ElectronAPI } from '../../../shared/contracts/electron-api.js';

let warnedMissingApi = false;

export function getElectronApi(): ElectronAPI {
  if (typeof window === 'undefined' || !window.electronAPI) {
    if (!warnedMissingApi) {
      warnedMissingApi = true;
      console.error('[Renderer] window.electronAPI is not defined!');
      console.error('[Renderer] This usually means the preload script failed to load.');
      console.error('[Renderer] Check the main process console for preload-error messages.');
    }

    throw new Error('Electron API is not available in this renderer context.');
  }

  return window.electronAPI;
}
