/**
 * Chapter State Management
 * Manages chapters for the dual-path import system
 */
import type { Chapter, Asset } from "$shared/types/database";
interface UpdateChapterInput {
    title?: string;
    startTime?: number;
    endTime?: number;
    display_order?: number;
}
interface ChaptersState {
    chapters: Chapter[];
    selectedChapterId: number | null;
    isLoading: boolean;
    error: string | null;
    isImporting: boolean;
    importChoice: "vod" | "files" | null;
    chapterAssets: Map<number, number[]>;
}
export declare const chaptersState: ChaptersState;
/**
 * Load chapters for a project
 */
export declare function loadChapters(projectId: number): Promise<void>;
/**
 * Create a new chapter
 */
export declare function createChapter(projectId: number, title: string, startTime: number, endTime: number): Promise<Chapter | null>;
/**
 * Select a chapter
 */
export declare function selectChapter(chapterId: number | null): void;
/**
 * Update chapter metadata
 */
export declare function updateChapter(chapterId: number, updates: UpdateChapterInput): Promise<boolean>;
/**
 * Delete a chapter
 */
export declare function deleteChapter(chapterId: number): Promise<boolean>;
/**
 * Link an asset to a chapter
 */
export declare function linkAssetToChapter(chapterId: number, assetId: number): Promise<boolean>;
/**
 * Get assets linked to a chapter (sync from cache)
 */
export declare function getAssetsForChapter(chapterId: number): number[];
/**
 * Load assets for a chapter and cache them
 */
export declare function loadAssetsForChapter(chapterId: number): Promise<number[]>;
/**
 * Auto-create chapters from files (Files import path)
 * Each file becomes one chapter spanning the full asset
 */
export declare function autoCreateChaptersFromFiles(projectId: number, assets: Asset[]): Promise<Chapter[]>;
/**
 * Reorder chapters
 */
export declare function reorderChapters(orderedIds: number[]): Promise<boolean>;
/**
 * Start transcription for a chapter (triggered after chapter creation if setting enabled)
 */
export declare function transcribeChapter(chapterId: number, options?: Record<string, unknown>): Promise<void>;
/**
 * Get selected chapter
 */
export declare function getSelectedChapter(): Chapter | null;
/**
 * Clear chapter state
 */
export declare function clearChaptersState(): void;
/**
 * Set import choice
 */
export declare function setImportChoice(choice: "vod" | "files" | null): void;
/**
 * Set importing state
 */
export declare function setIsImporting(isImporting: boolean): void;
export {};
