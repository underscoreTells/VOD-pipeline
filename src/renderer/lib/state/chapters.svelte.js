/**
 * Chapter State Management
 * Manages chapters for the dual-path import system
 */
// Create chapters state
export const chaptersState = $state({
    chapters: [],
    selectedChapterId: null,
    isLoading: false,
    error: null,
    isImporting: false,
    importChoice: null,
    chapterAssets: new Map(),
});
// Keep track of current project ID for context
let currentProjectId = null;
/**
 * Load chapters for a project
 */
export async function loadChapters(projectId) {
    try {
        chaptersState.isLoading = true;
        chaptersState.error = null;
        currentProjectId = projectId;
        const result = await window.electronAPI.chapters.getByProject(projectId);
        if (result.success && result.data) {
            chaptersState.chapters = result.data;
        }
        else {
            chaptersState.error = result.error || "Failed to load chapters";
        }
    }
    catch (error) {
        console.error("[Chapters] Failed to load chapters:", error);
        chaptersState.error = error instanceof Error ? error.message : "Failed to load chapters";
    }
    finally {
        chaptersState.isLoading = false;
    }
}
/**
 * Create a new chapter
 */
export async function createChapter(projectId, title, startTime, endTime) {
    try {
        const input = {
            projectId,
            title,
            startTime,
            endTime,
        };
        const result = await window.electronAPI.chapters.create(input);
        if (result.success && result.data) {
            chaptersState.chapters = [...chaptersState.chapters, result.data];
            return result.data;
        }
        else {
            console.error("[Chapters] Failed to create chapter:", result.error);
            return null;
        }
    }
    catch (error) {
        console.error("[Chapters] Error creating chapter:", error);
        return null;
    }
}
/**
 * Select a chapter
 */
export function selectChapter(chapterId) {
    chaptersState.selectedChapterId = chapterId;
}
/**
 * Update chapter metadata
 */
export async function updateChapter(chapterId, updates) {
    try {
        const result = await window.electronAPI.chapters.update(chapterId, updates);
        if (result.success) {
            chaptersState.chapters = chaptersState.chapters.map((chapter) => chapter.id === chapterId ? { ...chapter, ...updates } : chapter);
            return true;
        }
        else {
            console.error("[Chapters] Failed to update chapter:", result.error);
            return false;
        }
    }
    catch (error) {
        console.error("[Chapters] Error updating chapter:", error);
        return false;
    }
}
/**
 * Delete a chapter
 */
export async function deleteChapter(chapterId) {
    try {
        const result = await window.electronAPI.chapters.delete(chapterId);
        if (result.success) {
            chaptersState.chapters = chaptersState.chapters.filter((chapter) => chapter.id !== chapterId);
            if (chaptersState.selectedChapterId === chapterId) {
                chaptersState.selectedChapterId = null;
            }
            return true;
        }
        else {
            console.error("[Chapters] Failed to delete chapter:", result.error);
            return false;
        }
    }
    catch (error) {
        console.error("[Chapters] Error deleting chapter:", error);
        return false;
    }
}
/**
 * Link an asset to a chapter
 */
export async function linkAssetToChapter(chapterId, assetId) {
    try {
        const result = await window.electronAPI.chapters.addAsset(chapterId, assetId);
        if (result.success) {
            return true;
        }
        else {
            console.error("[Chapters] Failed to link asset to chapter:", result.error);
            return false;
        }
    }
    catch (error) {
        console.error("[Chapters] Error linking asset to chapter:", error);
        return false;
    }
}
/**
 * Get assets linked to a chapter (sync from cache)
 */
export function getAssetsForChapter(chapterId) {
    return chaptersState.chapterAssets.get(chapterId) ?? [];
}
/**
 * Load assets for a chapter and cache them
 */
export async function loadAssetsForChapter(chapterId) {
    try {
        const result = await window.electronAPI.chapters.getAssets(chapterId);
        if (result.success && result.data) {
            chaptersState.chapterAssets.set(chapterId, result.data);
            return result.data;
        }
        else {
            console.error("[Chapters] Failed to get assets for chapter:", result.error);
            return [];
        }
    }
    catch (error) {
        console.error("[Chapters] Error getting assets for chapter:", error);
        return [];
    }
}
/**
 * Auto-create chapters from files (Files import path)
 * Each file becomes one chapter spanning the full asset
 */
export async function autoCreateChaptersFromFiles(projectId, assets) {
    const createdChapters = [];
    const existingTitles = [];
    for (const asset of assets) {
        try {
            // Generate unique title from filename
            const title = generateChapterTitleFromFilename(asset.file_path, existingTitles);
            existingTitles.push(title);
            // Create chapter spanning full asset duration
            const chapter = await createChapter(projectId, title, 0, asset.duration || 0);
            if (chapter) {
                // Link asset to chapter
                await linkAssetToChapter(chapter.id, asset.id);
                createdChapters.push(chapter);
            }
        }
        catch (error) {
            console.error(`[Chapters] Failed to create chapter for asset ${asset.id}:`, error);
        }
    }
    return createdChapters;
}
/**
 * Generate a chapter title from filename
 * Handles duplicates by appending numbers
 */
function generateChapterTitleFromFilename(filePath, existingTitles) {
    const basename = filePath.split(/[/\\]/).pop() || "unnamed";
    const nameWithoutExt = basename.replace(/\.[^/.]+$/, "");
    if (!existingTitles.includes(nameWithoutExt)) {
        return nameWithoutExt;
    }
    // Find next available number
    let counter = 1;
    while (existingTitles.includes(`${nameWithoutExt}_${counter}`)) {
        counter++;
    }
    return `${nameWithoutExt}_${counter}`;
}
/**
 * Reorder chapters
 */
export async function reorderChapters(orderedIds) {
    try {
        // Update display_order for each chapter
        for (let i = 0; i < orderedIds.length; i++) {
            await updateChapter(orderedIds[i], { display_order: i });
        }
        // Reload to get new order
        if (currentProjectId) {
            await loadChapters(currentProjectId);
        }
        return true;
    }
    catch (error) {
        console.error("[Chapters] Failed to reorder chapters:", error);
        return false;
    }
}
/**
 * Start transcription for a chapter (triggered after chapter creation if setting enabled)
 */
export async function transcribeChapter(chapterId, options) {
    try {
        // Import dynamically to avoid circular dependency
        const { transcribeChapter } = await import("./electron.svelte");
        await transcribeChapter(chapterId, options);
    }
    catch (error) {
        console.error("[Chapters] Failed to start transcription:", error);
    }
}
/**
 * Get selected chapter
 */
export function getSelectedChapter() {
    if (!chaptersState.selectedChapterId)
        return null;
    return (chaptersState.chapters.find((c) => c.id === chaptersState.selectedChapterId) || null);
}
/**
 * Clear chapter state
 */
export function clearChaptersState() {
    chaptersState.chapters = [];
    chaptersState.selectedChapterId = null;
    chaptersState.error = null;
    chaptersState.isImporting = false;
    chaptersState.importChoice = null;
    currentProjectId = null;
}
/**
 * Set import choice
 */
export function setImportChoice(choice) {
    chaptersState.importChoice = choice;
}
/**
 * Set importing state
 */
export function setIsImporting(isImporting) {
    chaptersState.isImporting = isImporting;
}
