import type { ExportResult } from '../../../shared/contracts/electron-api.js';
import { getElectronApi } from './client.js';

export type { ExportResult } from '../../../shared/contracts/electron-api.js';

export async function exportProject(
  projectId: number,
  format: string,
  filePath: string
): Promise<ExportResult> {
  return await getElectronApi().exports.generate(projectId, format, filePath);
}
