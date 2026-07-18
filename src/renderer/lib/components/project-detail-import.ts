import type { Asset } from '$shared/types/database';
import type { LinkAssetToChapterOptions } from '../api/chapters.js';
import { autoTranscribeChapters } from './project-detail-transcription.js';

interface ImportDeps {
  addAssetToProject: (projectId: number, filePath: string) => Promise<Asset | null | undefined>;
  autoCreateChaptersFromFiles: (
    projectId: number,
    assets: Asset[],
    linkOptions?: LinkAssetToChapterOptions
  ) => Promise<Array<{ id: number }>>;
  selectChapter: (chapterId: number) => void;
  autoTranscribeOnImport: boolean;
  getTranscriptionStatus: (autoSetup?: boolean) => Promise<{
    success: boolean;
    data?: { available?: boolean; error?: string };
    error?: string;
  }>;
  startChapterTranscription: (
    chapterId: number,
    options?: Record<string, unknown>
  ) => Promise<{ success: boolean; error?: string }>;
  setTranscriptionError: (chapterId: number, message: string) => void;
}

export async function importProjectFiles(
  projectId: number,
  filePaths: string[],
  deps: ImportDeps,
  linkOptions?: LinkAssetToChapterOptions
): Promise<void> {
  const assets: Asset[] = [];

  for (const filePath of filePaths) {
    const asset = await deps.addAssetToProject(projectId, filePath);
    if (asset) {
      assets.push(asset);
    }
  }

  if (assets.length === 0) {
    return;
  }

  const created = await deps.autoCreateChaptersFromFiles(projectId, assets, linkOptions);
  if (deps.autoTranscribeOnImport) {
    await autoTranscribeChapters(
      created.map((chapter) => chapter.id),
      deps,
      { awaitCompletion: false, background: true }
    );
  }

  if (created.length > 0) {
    deps.selectChapter(created[0].id);
  }
}
