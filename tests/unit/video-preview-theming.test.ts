import { render } from "svelte/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter } from "../../src/shared/types/database";
import type { ProjectAsset } from "../../src/shared/contracts/ipc";

const mocks = vi.hoisted(() => ({
  selectedClipsState: {
    current: [],
  },
  timelineState: {
    clips: [],
    isPlaying: false,
    shuttleDirection: 0,
    shuttleSpeed: 1,
    playheadTime: 0,
  },
  chaptersState: {
    chapters: [],
    selectedChapterId: null,
  },
  projectDetail: {
    assets: [],
  },
  executeResizeClip: vi.fn(),
  executeUpdateClipTiming: vi.fn(),
  createProjectClip: vi.fn(),
  togglePlayback: vi.fn(),
  restoreTransport: vi.fn(),
  setPlayhead: vi.fn(),
  setPlaying: vi.fn(),
  stopShuttle: vi.fn(),
  clearSelection: vi.fn(),
  getChapterReverseProxy: vi.fn(),
}));

vi.mock("../../src/renderer/lib/state/timeline.svelte", () => ({
  timelineState: mocks.timelineState,
  getSelectedClips: () => mocks.selectedClipsState.current,
  getClipById: (id: number) => mocks.timelineState.clips.find((clip: { id: number }) => clip.id === id),
  snapshotTransport: () => ({
    isPlaying: false,
    shuttleDirection: 0,
    shuttleSpeed: 1,
  }),
  restoreTransport: mocks.restoreTransport,
  setPlayhead: mocks.setPlayhead,
  setPlaying: mocks.setPlaying,
  stopShuttle: mocks.stopShuttle,
  togglePlayback: mocks.togglePlayback,
}));

vi.mock("../../src/renderer/lib/state/chapters.svelte", () => ({
  chaptersState: mocks.chaptersState,
}));

vi.mock("../../src/renderer/lib/state/project-detail.svelte", () => ({
  projectDetail: mocks.projectDetail,
  executeResizeClip: mocks.executeResizeClip,
  executeUpdateClipTiming: mocks.executeUpdateClipTiming,
  createProjectClip: mocks.createProjectClip,
}));

vi.mock("../../src/renderer/lib/state/keyboard.svelte", () => ({
  formatTimecode: (seconds: number) => `tc:${seconds.toFixed(2)}`,
}));

vi.mock("../../src/renderer/lib/state/clip-builder.svelte", () => ({
  clipBuilderState: {},
  clearSelection: mocks.clearSelection,
  hasCompleteSelection: () => false,
}));

vi.mock("../../src/renderer/lib/api/chapters.js", () => ({
  getChapterReverseProxy: mocks.getChapterReverseProxy,
}));

vi.mock("../../src/renderer/lib/components/chapter-preview-media.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/renderer/lib/components/chapter-preview-media.js")>(),
  resolveChapterPreviewMediaChange: () => null,
}));

import ChapterEditorViewer from "../../src/renderer/lib/components/ChapterEditorViewer.svelte";

function createChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 301,
    project_id: 11,
    title: "Test chapter",
    start_time: 0,
    end_time: 120,
    display_order: 0,
    created_at: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

function createAsset(overrides: Partial<ProjectAsset> = {}): ProjectAsset {
  return {
    id: 201,
    project_id: 11,
    file_path: "/tmp/source.mp4",
    file_type: "video",
    duration: 120,
    metadata: { fps: 30 },
    created_at: "2026-04-21T00:00:00.000Z",
    availability: {
      exists: true,
      issue: null,
      savedPath: "/tmp/source.mp4",
      nearestExistingAncestor: null,
      checkedAt: "2026-04-21T00:00:00.000Z",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectedClipsState.current = [];
  mocks.timelineState.clips = [];
  mocks.timelineState.isPlaying = false;
  mocks.timelineState.playheadTime = 0;
  mocks.chaptersState.chapters = [];
  mocks.chaptersState.selectedChapterId = null;
  mocks.projectDetail.assets = [];
});

describe("video preview theming", () => {
  it("renders ChapterEditorViewer dock shells with the shared themeable surface", () => {
    const chapter = createChapter();
    const asset = createAsset();

    const { body } = render(ChapterEditorViewer, {
      props: {
        chapter,
        asset,
        clips: [],
      },
    });

    expect(body).toContain("player-dock-surface");
    expect(body).not.toContain("bg-[rgba(18,18,18,0.86)]");
    expect(body).not.toContain("border-white/8");
  });
});
