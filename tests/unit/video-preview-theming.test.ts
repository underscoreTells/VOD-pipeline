import { render } from "svelte/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter, Clip } from "../../src/shared/types/database";
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

vi.mock("../../src/renderer/lib/components/chapter-preview-media.js", () => ({
  resolveChapterPreviewMediaChange: () => null,
}));

import ClipPreview from "../../src/renderer/lib/components/ClipPreview.svelte";
import ChapterPreview from "../../src/renderer/lib/components/ChapterPreview.svelte";

function createClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 101,
    project_id: 11,
    asset_id: 201,
    track_index: 0,
    start_time: 2,
    in_point: 12,
    out_point: 19,
    role: "setup",
    description: "Test clip",
    is_essential: true,
    created_at: "2026-04-21T00:00:00.000Z",
    ...overrides,
  };
}

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

function setClipPreviewState({
  clip = createClip(),
  chapter = createChapter(),
  asset = createAsset(),
}: {
  clip?: Clip;
  chapter?: Chapter;
  asset?: ProjectAsset;
} = {}): void {
  mocks.selectedClipsState.current = [clip];
  mocks.timelineState.clips = [clip];
  mocks.chaptersState.chapters = [chapter];
  mocks.chaptersState.selectedChapterId = chapter.id;
  mocks.projectDetail.assets = [asset];
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
  it("renders ClipPreview dock shells with the shared themeable surface", () => {
    setClipPreviewState();

    const { body } = render(ClipPreview);

    expect(body).toContain("player-dock-surface");
    expect(body).not.toContain("bg-[rgba(18,18,18,0.86)]");
    expect(body).not.toContain("border-white/8");
  });

  it("does not render the old hard-coded loop-off styling in ClipPreview markup", () => {
    setClipPreviewState();

    const { body } = render(ClipPreview);

    expect(body).not.toContain("border border-white/12 bg-black text-white hover:border-white/25 hover:bg-black/90");
  });

  it("uses theme tokens for the ClipPreview unavailable state", () => {
    setClipPreviewState({
      asset: createAsset({
        availability: {
          exists: false,
          issue: "missing_file",
          savedPath: "/tmp/missing.mp4",
          nearestExistingAncestor: "/tmp",
          checkedAt: "2026-04-21T00:00:00.000Z",
        },
      }),
    });

    const { body } = render(ClipPreview);

    expect(body).toContain("from-surface-raised to-surface-page");
    expect(body).not.toContain("from-[#1f1f1f]");
    expect(body).not.toContain("to-[#121212]");
  });

  it("renders ChapterPreview dock shells with the shared themeable surface", () => {
    const chapter = createChapter();
    const asset = createAsset();

    const { body } = render(ChapterPreview, {
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
