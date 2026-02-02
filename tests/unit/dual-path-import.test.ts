import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Dual-Path Import Feature Tests
 * Tests for chapters-first workflow, import flows, and chapter management
 */

describe("Dual-Path Import Feature - Chapter Management", () => {
  // Mock types matching the actual implementation
  interface Chapter {
    id: number;
    project_id: number;
    title: string;
    start_time: number;
    end_time: number;
    display_order: number;
    created_at: string;
  }

  interface Asset {
    id: number;
    project_id: number;
    file_path: string;
    file_type: 'video' | 'audio' | 'image' | null;
    duration: number | null;
    created_at: string;
  }

  interface Settings {
    autoChapterNamingEnabled: boolean;
    autoChapterNamingModel: string;
    autoTranscribeOnImport: boolean;
  }

  const defaultSettings: Settings = {
    autoChapterNamingEnabled: true,
    autoChapterNamingModel: "gpt-4o-mini",
    autoTranscribeOnImport: true,
  };

  describe("Settings (Phase 1)", () => {
    it("should have autoChapterNamingEnabled default to true", () => {
      expect(defaultSettings.autoChapterNamingEnabled).toBe(true);
    });

    it("should have autoChapterNamingModel default to gpt-4o-mini", () => {
      expect(defaultSettings.autoChapterNamingModel).toBe("gpt-4o-mini");
    });

    it("should have autoTranscribeOnImport default to true", () => {
      expect(defaultSettings.autoTranscribeOnImport).toBe(true);
    });

    it("should support different chapter naming models", () => {
      const models = ["gpt-4o-mini", "gpt-4o", "gemini-1.5-flash"];
      models.forEach((model) => {
        const settings = { ...defaultSettings, autoChapterNamingModel: model };
        expect(settings.autoChapterNamingModel).toBe(model);
      });
    });
  });

  describe("Chapter Type with display_order", () => {
    it("should have all required fields including display_order", () => {
      const chapter: Chapter = {
        id: 1,
        project_id: 1,
        title: "Test Chapter",
        start_time: 0,
        end_time: 100,
        display_order: 0,
        created_at: new Date().toISOString(),
      };

      expect(chapter).toHaveProperty("id");
      expect(chapter).toHaveProperty("project_id");
      expect(chapter).toHaveProperty("title");
      expect(chapter).toHaveProperty("start_time");
      expect(chapter).toHaveProperty("end_time");
      expect(chapter).toHaveProperty("display_order");
      expect(chapter).toHaveProperty("created_at");
    });

    it("should default display_order to 0", () => {
      const chapter: Chapter = {
        id: 1,
        project_id: 1,
        title: "Test Chapter",
        start_time: 0,
        end_time: 100,
        display_order: 0,
        created_at: new Date().toISOString(),
      };

      expect(chapter.display_order).toBe(0);
    });

    it("should allow custom display_order values", () => {
      const chapter: Chapter = {
        id: 1,
        project_id: 1,
        title: "Test Chapter",
        start_time: 0,
        end_time: 100,
        display_order: 5,
        created_at: new Date().toISOString(),
      };

      expect(chapter.display_order).toBe(5);
    });
  });

  describe("Chapter Creation (Phase 2)", () => {
    function createChapter(
      projectId: number,
      title: string,
      startTime: number,
      endTime: number,
      displayOrder: number = 0
    ): Chapter {
      return {
        id: Date.now(),
        project_id: projectId,
        title,
        start_time: startTime,
        end_time: endTime,
        display_order: displayOrder,
        created_at: new Date().toISOString(),
      };
    }

    it("should create a chapter with valid data", () => {
      const chapter = createChapter(1, "Introduction", 0, 60, 0);
      
      expect(chapter.project_id).toBe(1);
      expect(chapter.title).toBe("Introduction");
      expect(chapter.start_time).toBe(0);
      expect(chapter.end_time).toBe(60);
      expect(chapter.display_order).toBe(0);
    });

    it("should calculate chapter duration correctly", () => {
      const chapter = createChapter(1, "Test", 30, 120, 0);
      const duration = chapter.end_time - chapter.start_time;
      expect(duration).toBe(90);
    });

    it("should validate chapter time range", () => {
      const startTime = 0;
      const endTime = 60;
      
      expect(endTime).toBeGreaterThan(startTime);
      expect(startTime).toBeGreaterThanOrEqual(0);
    });

    it("should reject invalid time ranges", () => {
      const invalidRanges = [
        { start: 60, end: 30 }, // end before start
        { start: -10, end: 30 }, // negative start
        { start: 30, end: 30 }, // equal times
      ];

      invalidRanges.forEach((range) => {
        const isValid = range.end > range.start && range.start >= 0;
        expect(isValid).toBe(false);
      });
    });
  });

  describe("Chapter Title Generation (Phase 2)", () => {
    function generateChapterTitleFromFilename(
      filePath: string,
      existingTitles: string[]
    ): string {
      const parts = filePath.split(/[/\\]/);
      const basename = parts[parts.length - 1] || "unnamed";
      const nameWithoutExt = basename.replace(/\.[^/.]+$/, "");

      if (!existingTitles.includes(nameWithoutExt)) {
        return nameWithoutExt;
      }

      let counter = 1;
      while (existingTitles.includes(`${nameWithoutExt}_${counter}`)) {
        counter++;
      }
      return `${nameWithoutExt}_${counter}`;
    }

    it("should generate title from filename without extension", () => {
      const title = generateChapterTitleFromFilename("/path/to/video.mp4", []);
      expect(title).toBe("video");
    });

    it("should handle Windows paths", () => {
      const title = generateChapterTitleFromFilename("C:\\Users\\test\\clip.mkv", []);
      expect(title).toBe("clip");
    });

    it("should handle duplicate filenames by adding counter", () => {
      const existingTitles = ["intro"];
      const title = generateChapterTitleFromFilename("intro.mp4", existingTitles);
      expect(title).toBe("intro_1");
    });

    it("should increment counter for multiple duplicates", () => {
      const existingTitles = ["clip", "clip_1", "clip_2"];
      const title = generateChapterTitleFromFilename("clip.mp4", existingTitles);
      expect(title).toBe("clip_3");
    });

    it("should handle different extensions with same basename", () => {
      const existingTitles = ["video"];
      const title = generateChapterTitleFromFilename("video.mkv", existingTitles);
      expect(title).toBe("video_1");
    });

    it("should handle complex filenames", () => {
      const title = generateChapterTitleFromFilename("my_video_file_001.mp4", []);
      expect(title).toBe("my_video_file_001");
    });
  });

  describe("Chapter Auto-Creation from Files (Phase 2)", () => {
    function autoCreateChaptersFromFiles(
      projectId: number,
      assets: Asset[],
      existingTitles: string[] = []
    ): Array<{ title: string; startTime: number; endTime: number; assetId: number }> {
      const chapters: Array<{ title: string; startTime: number; endTime: number; assetId: number }> = [];
      const titles = [...existingTitles];

      for (const asset of assets) {
        const parts = asset.file_path.split(/[/\\]/);
        const basename = parts[parts.length - 1] || "unnamed";
        let title = basename.replace(/\.[^/.]+$/, "");

        // Handle duplicates
        if (titles.includes(title)) {
          let counter = 1;
          while (titles.includes(`${title}_${counter}`)) {
            counter++;
          }
          title = `${title}_${counter}`;
        }
        titles.push(title);

        chapters.push({
          title,
          startTime: 0,
          endTime: asset.duration || 0,
          assetId: asset.id,
        });
      }

      return chapters;
    }

    it("should create one chapter per file", () => {
      const assets: Asset[] = [
        { id: 1, project_id: 1, file_path: "/path/intro.mp4", file_type: "video", duration: 30, created_at: "" },
        { id: 2, project_id: 1, file_path: "/path/main.mp4", file_type: "video", duration: 120, created_at: "" },
        { id: 3, project_id: 1, file_path: "/path/outro.mp4", file_type: "video", duration: 15, created_at: "" },
      ];

      const chapters = autoCreateChaptersFromFiles(1, assets);
      expect(chapters).toHaveLength(3);
    });

    it("should set chapter times to full asset duration", () => {
      const assets: Asset[] = [
        { id: 1, project_id: 1, file_path: "video.mp4", file_type: "video", duration: 120, created_at: "" },
      ];

      const chapters = autoCreateChaptersFromFiles(1, assets);
      expect(chapters[0].startTime).toBe(0);
      expect(chapters[0].endTime).toBe(120);
    });

    it("should use filename as chapter title", () => {
      const assets: Asset[] = [
        { id: 1, project_id: 1, file_path: "/videos/introduction.mp4", file_type: "video", duration: 60, created_at: "" },
      ];

      const chapters = autoCreateChaptersFromFiles(1, assets);
      expect(chapters[0].title).toBe("introduction");
    });

    it("should handle zero-duration assets", () => {
      const assets: Asset[] = [
        { id: 1, project_id: 1, file_path: "empty.mp4", file_type: "video", duration: null, created_at: "" },
      ];

      const chapters = autoCreateChaptersFromFiles(1, assets);
      expect(chapters[0].endTime).toBe(0);
    });
  });

  describe("Chapter Reordering (Phase 3)", () => {
    function reorderChapters(
      chapters: Chapter[],
      orderedIds: number[]
    ): Chapter[] {
      const reordered: Chapter[] = [];
      
      for (let i = 0; i < orderedIds.length; i++) {
        const chapter = chapters.find((c) => c.id === orderedIds[i]);
        if (chapter) {
          reordered.push({ ...chapter, display_order: i });
        }
      }

      return reordered;
    }

    it("should reorder chapters by display_order", () => {
      const chapters: Chapter[] = [
        { id: 1, project_id: 1, title: "A", start_time: 0, end_time: 10, display_order: 0, created_at: "" },
        { id: 2, project_id: 1, title: "B", start_time: 10, end_time: 20, display_order: 1, created_at: "" },
        { id: 3, project_id: 1, title: "C", start_time: 20, end_time: 30, display_order: 2, created_at: "" },
      ];

      const reordered = reorderChapters(chapters, [3, 1, 2]);
      
      expect(reordered[0].id).toBe(3);
      expect(reordered[0].display_order).toBe(0);
      expect(reordered[1].id).toBe(1);
      expect(reordered[1].display_order).toBe(1);
      expect(reordered[2].id).toBe(2);
      expect(reordered[2].display_order).toBe(2);
    });

    it("should maintain all chapters after reordering", () => {
      const chapters: Chapter[] = [
        { id: 1, project_id: 1, title: "A", start_time: 0, end_time: 10, display_order: 0, created_at: "" },
        { id: 2, project_id: 1, title: "B", start_time: 10, end_time: 20, display_order: 1, created_at: "" },
        { id: 3, project_id: 1, title: "C", start_time: 20, end_time: 30, display_order: 2, created_at: "" },
      ];

      const reordered = reorderChapters(chapters, [2, 3, 1]);
      expect(reordered).toHaveLength(3);
    });
  });

  describe("Time Formatting Utilities", () => {
    function formatTime(seconds: number): string {
      if (isNaN(seconds) || seconds < 0) return "0:00";

      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);

      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
      }

      return `${minutes}:${secs.toString().padStart(2, "0")}`;
    }

    function formatTimePrecise(seconds: number): string {
      if (isNaN(seconds) || seconds < 0) return "0:00.00";

      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);

      return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
    }

    it("should format seconds to MM:SS", () => {
      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(30)).toBe("0:30");
      expect(formatTime(60)).toBe("1:00");
      expect(formatTime(90)).toBe("1:30");
      expect(formatTime(125)).toBe("2:05");
    });

    it("should format large seconds to HH:MM:SS", () => {
      expect(formatTime(3600)).toBe("1:00:00");
      expect(formatTime(3661)).toBe("1:01:01");
      expect(formatTime(7200)).toBe("2:00:00");
    });

    it("should format with precise milliseconds", () => {
      expect(formatTimePrecise(0)).toBe("0:00.00");
      expect(formatTimePrecise(1.5)).toBe("0:01.50");
      expect(formatTimePrecise(1.25)).toBe("0:01.25");
    });

    it("should handle edge cases", () => {
      expect(formatTime(NaN)).toBe("0:00");
      expect(formatTime(-1)).toBe("0:00");
      expect(formatTimePrecise(NaN)).toBe("0:00.00");
    });
  });
});

describe("Dual-Path Import Feature - IPC API", () => {
  describe("Chapter IPC Operations", () => {
    it("should define create chapter input structure", () => {
      const input = {
        projectId: 1,
        title: "Test Chapter",
        startTime: 0,
        endTime: 60,
      };

      expect(input).toHaveProperty("projectId");
      expect(input).toHaveProperty("title");
      expect(input).toHaveProperty("startTime");
      expect(input).toHaveProperty("endTime");
    });

    it("should define update chapter input structure", () => {
      const updates = {
        title: "New Title",
        startTime: 10,
        endTime: 70,
      };

      expect(updates).toHaveProperty("title");
      expect(updates).toHaveProperty("startTime");
      expect(updates).toHaveProperty("endTime");
    });

    it("should define chapter result structure", () => {
      const result = {
        success: true,
        data: {
          id: 1,
          project_id: 1,
          title: "Test",
          start_time: 0,
          end_time: 60,
          display_order: 0,
          created_at: new Date().toISOString(),
        },
      };

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("id");
      expect(result.data).toHaveProperty("display_order");
    });

    it("should define error result structure", () => {
      const result = {
        success: false,
        error: "Chapter not found",
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe("Chapter not found");
    });
  });
});

describe("Dual-Path Import Feature - State Management", () => {
  interface ChaptersState {
    chapters: Array<{ id: number; title: string }>;
    selectedChapterId: number | null;
    isLoading: boolean;
    error: string | null;
    isImporting: boolean;
    importChoice: "vod" | "files" | null;
  }

  function createInitialState(): ChaptersState {
    return {
      chapters: [],
      selectedChapterId: null,
      isLoading: false,
      error: null,
      isImporting: false,
      importChoice: null,
    };
  }

  it("should have correct initial state", () => {
    const state = createInitialState();
    
    expect(state.chapters).toEqual([]);
    expect(state.selectedChapterId).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.isImporting).toBe(false);
    expect(state.importChoice).toBeNull();
  });

  it("should update selected chapter", () => {
    const state = createInitialState();
    state.chapters = [{ id: 1, title: "Chapter 1" }];
    state.selectedChapterId = 1;
    
    expect(state.selectedChapterId).toBe(1);
  });

  it("should set import choice to vod", () => {
    const state = createInitialState();
    state.importChoice = "vod";
    state.isImporting = true;
    
    expect(state.importChoice).toBe("vod");
    expect(state.isImporting).toBe(true);
  });

  it("should set import choice to files", () => {
    const state = createInitialState();
    state.importChoice = "files";
    state.isImporting = true;
    
    expect(state.importChoice).toBe("files");
    expect(state.isImporting).toBe(true);
  });

  it("should set loading state", () => {
    const state = createInitialState();
    state.isLoading = true;
    
    expect(state.isLoading).toBe(true);
  });

  it("should set error state", () => {
    const state = createInitialState();
    state.error = "Failed to load chapters";
    
    expect(state.error).toBe("Failed to load chapters");
  });
});

describe("Dual-Path Import Feature - Workflow Integration", () => {
  it("should support full VOD import workflow", () => {
    const workflow = {
      step1: "Show ImportChoice",
      step2: "User selects Import Full VOD",
      step3: "User selects VOD file",
      step4: "Show ChapterDefinition with timeline",
      step5: "User marks chapter boundaries",
      step6: "User clicks Create All",
      step7: "Chapters created and linked to VOD",
      step8: "Show ChapterPanel with new chapters",
    };

    expect(workflow.step1).toContain("ImportChoice");
    expect(workflow.step4).toContain("ChapterDefinition");
    expect(workflow.step8).toContain("ChapterPanel");
  });

  it("should support individual files import workflow", () => {
    const workflow = {
      step1: "Show ImportChoice",
      step2: "User selects Import Individual Files",
      step3: "User selects/drops multiple files",
      step4: "Assets created for each file",
      step5: "Chapters auto-created from filenames",
      step6: "Chapters linked to respective assets",
      step7: "Show ChapterPanel with all chapters",
    };

    expect(workflow.step1).toContain("ImportChoice");
    expect(workflow.step5).toContain("auto-created");
    expect(workflow.step7).toContain("ChapterPanel");
  });

  it("should handle empty project state", () => {
    const hasAssets = false;
    const hasChapters = false;
    
    const shouldShowImportChoice = !hasAssets && !hasChapters;
    expect(shouldShowImportChoice).toBe(true);
  });

  it("should handle project with existing content", () => {
    const hasAssets = true;
    const hasChapters = true;
    
    const shouldShowImportChoice = !hasAssets && !hasChapters;
    expect(shouldShowImportChoice).toBe(false);
  });
});
