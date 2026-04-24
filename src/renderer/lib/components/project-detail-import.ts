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
  createChapter: (
    projectId: number,
    title: string,
    startTime: number,
    endTime: number
  ) => Promise<{ id: number } | null>;
  linkAssetToChapter: (
    chapterId: number,
    assetId: number,
    options?: LinkAssetToChapterOptions
  ) => Promise<boolean>;
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

export async function createProjectChaptersFromDefinition(
  projectId: number,
  vodAsset: Asset,
  chapterInputs: Array<{ title: string; startTime: number; endTime: number }>,
  deps: ImportDeps,
  linkOptions?: LinkAssetToChapterOptions
): Promise<number | null> {
  let firstChapterId: number | null = null;
  const createdChapterIds: number[] = [];

  for (const input of chapterInputs) {
    const chapter = await deps.createChapter(
      projectId,
      input.title,
      input.startTime,
      input.endTime
    );

    if (!chapter) {
      continue;
    }

    if (!firstChapterId) {
      firstChapterId = chapter.id;
    }

    await deps.linkAssetToChapter(chapter.id, vodAsset.id, linkOptions);
    createdChapterIds.push(chapter.id);
  }

  if (deps.autoTranscribeOnImport) {
    await autoTranscribeChapters(createdChapterIds, deps, {
      awaitCompletion: false,
      background: true,
    });
  }

  if (firstChapterId) {
    deps.selectChapter(firstChapterId);
  }

  return firstChapterId;
}
