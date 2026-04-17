import { exportProject as ipcExportProject, type ExportResult } from '../api/exports.js';
import { setError } from './timeline.svelte';

export async function exportProjectToFile(projectId: number, format: string, filePath: string): Promise<boolean> {
  try {
    const result: ExportResult = await ipcExportProject(projectId, format, filePath);
    if (result.success) {
      return true;
    }

    throw new Error(result.error || 'Export failed');
  } catch (error) {
    setError((error as Error).message);
    return false;
  }
}
