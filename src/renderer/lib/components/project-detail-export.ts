interface ExportFormatOption {
  id: string;
  name: string;
  extension: string;
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface ExportProjectDeps {
  showSaveDialog: (options: {
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }) => Promise<SaveDialogResult>;
  exportProjectToFile: (
    projectId: number,
    format: string,
    filePath: string
  ) => Promise<boolean>;
}

export async function exportProjectWithDialog(
  projectId: number,
  projectName: string,
  selectedExportFormat: string,
  exportFormats: ExportFormatOption[],
  deps: ExportProjectDeps
): Promise<boolean> {
  const format = exportFormats.find((item) => item.id === selectedExportFormat);
  if (!format) {
    return false;
  }

  const result = await deps.showSaveDialog({
    defaultPath: `${projectName}${format.extension}`,
    filters: [{ name: format.name, extensions: [format.extension.replace('.', '')] }],
  });

  if (result.canceled || !result.filePath) {
    return false;
  }

  return await deps.exportProjectToFile(projectId, selectedExportFormat, result.filePath);
}
