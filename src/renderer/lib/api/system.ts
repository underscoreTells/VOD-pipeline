import type { SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import { getElectronApi } from './client.js';

export async function showSaveDialog(
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  return await getElectronApi().dialog.showSaveDialog(options);
}

export function getPathForFile(file: File): string {
  return getElectronApi().webUtils.getPathForFile(file);
}
